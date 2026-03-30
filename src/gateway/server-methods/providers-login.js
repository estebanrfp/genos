import { resolveGenosOSAgentDir } from "../../agents/agent-paths.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { upsertAuthProfileWithLock } from "../../agents/auth-profiles/profiles.js";
import {
  hasCredentialsInProviders,
  updateProvidersInConfig,
} from "../../agents/auth-profiles/store.js";
import { readConfigFileSnapshotForWrite } from "../../config/config.js";
import { resolveMainSessionKeyFromConfig } from "../../config/sessions/main-session.js";
import {
  ErrorCodes,
  errorShape,
  validateProvidersLoginParams,
  validateProvidersLoginStatusParams,
  validateProvidersLoginCancelParams,
} from "../protocol/index.js";
import { __resetModelCatalogCacheForTest as resetModelCatalogCache } from "../server-model-catalog.js";
import { loadSessionEntry } from "../session-utils.js";
import { appendAssistantTranscriptMessage } from "./chat.js";
import { PROVIDER_REGISTRY } from "./providers-login-registry.js";

const LOG_PREFIX = "[providers-login]";

// ---------------------------------------------------------------------------
// Chat notification injection
// ---------------------------------------------------------------------------

/**
 * Inject a notification message into the active chat session and broadcast it.
 * @param {object} context  Gateway context (broadcast, nodeSendToSession)
 * @param {string} text     Message text
 */
function injectProviderChatNotification(context, text) {
  const sessionKey = resolveMainSessionKeyFromConfig();
  if (!sessionKey) {
    console.warn(`${LOG_PREFIX} no main session key — skipping chat inject`);
    return;
  }

  const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
  const sessionId = entry?.sessionId;
  if (!sessionId || !storePath) {
    console.warn(`${LOG_PREFIX} session not found for key ${sessionKey} — skipping chat inject`);
    return;
  }

  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const appended = appendAssistantTranscriptMessage({
    message: text,
    sessionId,
    storePath,
    sessionFile: entry?.sessionFile,
    agentId,
    createIfMissing: true,
  });

  if (!appended.ok) {
    console.warn(`${LOG_PREFIX} transcript append failed: ${appended.error ?? "unknown"}`);
    return;
  }

  const chatPayload = {
    runId: `inject-${appended.messageId}`,
    sessionKey,
    seq: 0,
    state: "final",
    message: appended.message,
  };
  context.broadcast("chat", chatPayload);
  if (typeof context.nodeSendToSession === "function") {
    context.nodeSendToSession(sessionKey, "chat", chatPayload);
  }
}

// ---------------------------------------------------------------------------
// Credential persistence
// ---------------------------------------------------------------------------

/**
 * Persist a provider credential using the active store format.
 * @param {string} provider
 * @param {string} profileId
 * @param {object} credential  e.g. { type: "api_key", provider, key } or { type: "token", provider, token }
 */
async function saveProviderCredential(provider, profileId, credential) {
  const { snapshot } = await readConfigFileSnapshotForWrite();
  const cfg = snapshot.config ?? {};
  const hasLegacy = Object.keys(cfg.auth?.profiles ?? {}).length > 0;
  const useProviders = hasCredentialsInProviders(cfg) || !hasLegacy;

  if (useProviders) {
    await updateProvidersInConfig((store) => {
      store.profiles[profileId] = credential;
      store.order ??= {};
      store.order[provider] ??= [];
      if (!store.order[provider].includes(profileId)) {
        store.order[provider].push(profileId);
      }
      return true;
    });
  } else {
    const agentDir = resolveGenosOSAgentDir();
    await upsertAuthProfileWithLock({ agentDir, profileId, credential });
  }

  resetModelCatalogCache();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capitalize provider name for display. */
const displayName = (name) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * Build a CLI command suggestion for providers that require interactive console login.
 * @param {string} provider
 * @param {object} registryEntry
 * @returns {{message: string, command: string}}
 */
const buildCliSuggestion = (provider, registryEntry) => {
  const command = registryEntry.cli ?? `genosos onboard --auth-choice ${provider}`;
  return {
    message:
      `Provider "${provider}" requires interactive login. Run this in a terminal:\n\n` +
      `  ${command}\n\n` +
      `The console wizard handles browser OAuth, device codes, and paste fallbacks.`,
    command,
  };
};

// ---------------------------------------------------------------------------
// API Key flow
// ---------------------------------------------------------------------------

/**
 * Handle API key login — validates, saves credential, injects chat notification.
 * @param {object} params  RPC params
 * @param {Function} respond
 * @param {object} context  Gateway context
 * @param {object} registryEntry  Provider registry entry
 */
async function handleApiKeyFlow(params, respond, context, registryEntry) {
  const provider = params.provider;
  const credType = registryEntry.type ?? "api_key";
  const value = credType === "token" ? params.token : params.apiKey;

  if (!value?.trim()) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `${credType === "token" ? "token" : "apiKey"} required for provider "${provider}"`,
      ),
    );
    return;
  }

  const trimmed = value.trim();
  const profileId = params.profileId?.trim() || `${provider}:default`;

  const credential =
    credType === "token"
      ? { type: "token", provider, token: trimmed }
      : { type: "api_key", provider, key: trimmed };

  try {
    await saveProviderCredential(provider, profileId, credential);
    console.log(`${LOG_PREFIX} ${provider} credential saved as ${profileId}`);
  } catch (err) {
    console.warn(`${LOG_PREFIX} credential save failed: ${err?.message ?? err}`);
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, `credential save failed: ${err?.message ?? err}`),
    );
    return;
  }

  try {
    injectProviderChatNotification(
      context,
      `${displayName(provider)} connected — credential saved as \`${profileId}\`.`,
    );
  } catch (notifyErr) {
    console.warn(`${LOG_PREFIX} chat notification failed: ${notifyErr?.message ?? notifyErr}`);
  }

  respond(true, { status: "authorized", profileId }, undefined);
}

// ---------------------------------------------------------------------------
// RPC Handlers
// ---------------------------------------------------------------------------

/**
 * Start provider login — API key providers are handled directly, interactive providers return a CLI command.
 * @param {{params: object, respond: Function, context: object}} ctx
 */
const handleProvidersLogin = async ({ params, respond, context }) => {
  if (!validateProvidersLoginParams(params)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid providers.login params"),
    );
    return;
  }

  const provider = params.provider?.trim()?.toLowerCase();
  if (!provider) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider required"));
    return;
  }

  const registryEntry = PROVIDER_REGISTRY[provider];
  if (!registryEntry) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `unknown provider "${provider}" — use providers.list to see available providers`,
      ),
    );
    return;
  }

  const { flow } = registryEntry;

  if (flow === "api-key") {
    await handleApiKeyFlow({ ...params, provider }, respond, context, registryEntry);
    return;
  }

  // Device flow and browser OAuth → suggest CLI command
  if (flow === "device" || flow === "browser-oauth") {
    const suggestion = buildCliSuggestion(provider, registryEntry);
    respond(true, { status: "use-cli", ...suggestion }, undefined);
    return;
  }

  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unsupported flow "${flow}"`));
};

/**
 * Check status of an active login session (kept for backward compat with copilot wrapper).
 * @param {{params: object, respond: Function}} ctx
 */
const handleProvidersLoginStatus = ({ params, respond }) => {
  if (!validateProvidersLoginStatusParams(params)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionId required"));
    return;
  }
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
};

/**
 * Cancel an active login session (kept for backward compat with copilot wrapper).
 * @param {{params: object, respond: Function}} ctx
 */
const handleProvidersLoginCancel = ({ params, respond }) => {
  if (!validateProvidersLoginCancelParams(params)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionId required"));
    return;
  }
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
};

export const providersLoginHandlers = {
  "providers.login": handleProvidersLogin,
  "providers.login.status": handleProvidersLoginStatus,
  "providers.login.cancel": handleProvidersLoginCancel,
};

export { saveProviderCredential, injectProviderChatNotification };
