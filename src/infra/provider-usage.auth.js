let parseGoogleToken = function (apiKey) {
    if (!apiKey) {
      return null;
    }
    try {
      const parsed = JSON.parse(apiKey);
      if (parsed && typeof parsed.token === "string") {
        return { token: parsed.token };
      }
    } catch {}
    return null;
  },
  resolveZaiApiKey = function () {
    const envDirect =
      normalizeSecretInput(process.env.ZAI_API_KEY) ||
      normalizeSecretInput(process.env.Z_AI_API_KEY);
    if (envDirect) {
      return envDirect;
    }
    const envResolved = resolveEnvApiKey("zai");
    if (envResolved?.apiKey) {
      return envResolved.apiKey;
    }
    const cfg = loadConfig();
    const key = getCustomProviderApiKey(cfg, "zai") || getCustomProviderApiKey(cfg, "z-ai");
    if (key) {
      return key;
    }
    const store = ensureAuthProfileStore();
    const apiProfile = [
      ...listProfilesForProvider(store, "zai"),
      ...listProfilesForProvider(store, "z-ai"),
    ].find((id) => store.profiles[id]?.type === "api_key");
    if (apiProfile) {
      const cred = store.profiles[apiProfile];
      if (cred?.type === "api_key" && normalizeSecretInput(cred.key)) {
        return normalizeSecretInput(cred.key);
      }
    }
    try {
      const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
      if (!fs.existsSync(authPath)) {
        return;
      }
      const data = JSON.parse(fs.readFileSync(authPath, "utf-8"));
      return data["z-ai"]?.access || data.zai?.access;
    } catch {
      return;
    }
  },
  resolveMinimaxApiKey = function () {
    return resolveProviderApiKeyFromConfigAndStore({
      providerId: "minimax",
      envDirect: [process.env.MINIMAX_CODE_PLAN_KEY, process.env.MINIMAX_API_KEY],
    });
  },
  resolveXiaomiApiKey = function () {
    return resolveProviderApiKeyFromConfigAndStore({
      providerId: "xiaomi",
      envDirect: [process.env.XIAOMI_API_KEY],
    });
  },
  resolveProviderApiKeyFromConfigAndStore = function (params) {
    const envDirect = params.envDirect.map(normalizeSecretInput).find(Boolean);
    if (envDirect) {
      return envDirect;
    }
    const envResolved = resolveEnvApiKey(params.providerId);
    if (envResolved?.apiKey) {
      return envResolved.apiKey;
    }
    const cfg = loadConfig();
    const key = getCustomProviderApiKey(cfg, params.providerId);
    if (key) {
      return key;
    }
    const store = ensureAuthProfileStore();
    const apiProfile = listProfilesForProvider(store, params.providerId).find((id) => {
      const cred = store.profiles[id];
      return cred?.type === "api_key" || cred?.type === "token";
    });
    if (!apiProfile) {
      return;
    }
    const cred = store.profiles[apiProfile];
    if (cred?.type === "api_key") {
      return normalizeSecretInput(cred.key);
    }
    if (cred?.type === "token") {
      return normalizeSecretInput(cred.token);
    }
    return;
  },
  resolveOAuthProviders = function (agentDir) {
    const store = ensureAuthProfileStore(agentDir, {
      allowKeychainPrompt: false,
    });
    const cfg = loadConfig();
    const providers = [
      "anthropic",
      "github-copilot",
      "google-gemini-cli",
      "google-antigravity",
      "openai-codex",
    ];
    const isOAuthLikeCredential = (id) => {
      const cred = store.profiles[id];
      return cred?.type === "oauth" || cred?.type === "token";
    };
    return providers.filter((provider) => {
      const profiles = listProfilesForProvider(store, provider).filter(isOAuthLikeCredential);
      if (profiles.length > 0) {
        return true;
      }
      const normalized = normalizeProviderId(provider);
      const configuredProfiles = Object.entries(cfg.auth?.profiles ?? {})
        .filter(([, profile]) => normalizeProviderId(profile.provider) === normalized)
        .map(([id]) => id)
        .filter(isOAuthLikeCredential);
      return configuredProfiles.length > 0;
    });
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dedupeProfileIds,
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveApiKeyForProfile,
  resolveAuthProfileOrder,
} from "../agents/auth-profiles.js";
import { getCustomProviderApiKey, resolveEnvApiKey } from "../agents/model-auth.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { loadConfig } from "../config/config.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";
async function resolveOAuthToken(params) {
  const cfg = loadConfig();
  const store = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  const order = resolveAuthProfileOrder({
    cfg,
    store,
    provider: params.provider,
  });
  const deduped = dedupeProfileIds(order);
  for (const profileId of deduped) {
    const cred = store.profiles[profileId];
    if (!cred || (cred.type !== "oauth" && cred.type !== "token")) {
      continue;
    }
    try {
      const resolved = await resolveApiKeyForProfile({
        cfg: undefined,
        store,
        profileId,
        agentDir: params.agentDir,
      });
      if (!resolved?.apiKey) {
        continue;
      }
      let token = resolved.apiKey;
      if (params.provider === "google-gemini-cli" || params.provider === "google-antigravity") {
        const parsed = parseGoogleToken(resolved.apiKey);
        token = parsed?.token ?? resolved.apiKey;
      }
      return {
        provider: params.provider,
        token,
        accountId: cred.type === "oauth" && "accountId" in cred ? cred.accountId : undefined,
      };
    } catch {}
  }
  return null;
}
export async function resolveProviderAuths(params) {
  if (params.auth) {
    return params.auth;
  }
  const oauthProviders = resolveOAuthProviders(params.agentDir);
  const auths = [];
  for (const provider of params.providers) {
    if (provider === "zai") {
      const apiKey = resolveZaiApiKey();
      if (apiKey) {
        auths.push({ provider, token: apiKey });
      }
      continue;
    }
    if (provider === "minimax") {
      const apiKey = resolveMinimaxApiKey();
      if (apiKey) {
        auths.push({ provider, token: apiKey });
      }
      continue;
    }
    if (provider === "xiaomi") {
      const apiKey = resolveXiaomiApiKey();
      if (apiKey) {
        auths.push({ provider, token: apiKey });
      }
      continue;
    }
    if (!oauthProviders.includes(provider)) {
      continue;
    }
    const auth = await resolveOAuthToken({
      provider,
      agentDir: params.agentDir,
    });
    if (auth) {
      auths.push(auth);
    }
  }
  return auths;
}
