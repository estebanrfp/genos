let resolveTokenProvider = function (raw) {
    const trimmed = raw?.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = normalizeProviderId(trimmed);
    if (normalized === "anthropic") {
      return "anthropic";
    }
    return "custom";
  },
  resolveDefaultTokenProfileId = function (provider) {
    return `${normalizeProviderId(provider)}:manual`;
  },
  credentialMode = function (credential) {
    if (credential.type === "api_key") {
      return "api_key";
    }
    if (credential.type === "token") {
      return "token";
    }
    return "oauth";
  };
import { confirm as clackConfirm, select as clackSelect, text as clackText } from "@clack/prompts";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { upsertAuthProfile } from "../../agents/auth-profiles.js";
import { normalizeProviderId } from "../../agents/model-selection.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { parseDurationMs } from "../../cli/parse-duration.js";
import { logConfigUpdated } from "../../config/logging.js";
import { resolvePluginProviders } from "../../plugins/providers.js";
import { stylePromptHint, stylePromptMessage } from "../../terminal/prompt-style.js";
import { createClackPrompter } from "../../wizard/clack-prompter.js";
import { applyAuthChoice } from "../auth-choice.apply.js";
import { validateAnthropicSetupToken } from "../auth-token.js";
import { isRemoteEnvironment } from "../oauth-env.js";
import { createVpsAwareOAuthHandlers } from "../oauth-flow.js";
import { applyAuthProfileConfig } from "../onboard-auth.js";
import { openUrl } from "../onboard-helpers.js";
import {
  applyDefaultModel,
  mergeConfigPatch,
  pickAuthMethod,
  resolveProviderMatch,
} from "../provider-auth-helpers.js";
import { loadValidConfigOrThrow, updateConfig } from "./shared.js";
const confirm = (params) =>
  clackConfirm({
    ...params,
    message: stylePromptMessage(params.message),
  });
const text = (params) =>
  clackText({
    ...params,
    message: stylePromptMessage(params.message),
  });
const select = (params) =>
  clackSelect({
    ...params,
    message: stylePromptMessage(params.message),
    options: params.options.map((opt) =>
      opt.hint === undefined ? opt : { ...opt, hint: stylePromptHint(opt.hint) },
    ),
  });
export async function modelsAuthSetupTokenCommand(opts, runtime) {
  const provider = resolveTokenProvider(opts.provider ?? "anthropic");
  if (provider !== "anthropic") {
    throw new Error("Only --provider anthropic is supported for setup-token.");
  }
  if (!process.stdin.isTTY) {
    throw new Error("setup-token requires an interactive TTY.");
  }
  if (!opts.yes) {
    const proceed = await confirm({
      message: "Have you run `claude setup-token` and copied the token?",
      initialValue: true,
    });
    if (!proceed) {
      return;
    }
  }
  const tokenInput = await text({
    message: "Paste Anthropic setup-token",
    validate: (value) => validateAnthropicSetupToken(String(value ?? "")),
  });
  const token = String(tokenInput ?? "").trim();
  const profileId = resolveDefaultTokenProfileId(provider);
  upsertAuthProfile({
    profileId,
    credential: {
      type: "token",
      provider,
      token,
    },
  });
  await updateConfig((cfg) =>
    applyAuthProfileConfig(cfg, {
      profileId,
      provider,
      mode: "token",
    }),
  );
  logConfigUpdated(runtime);
  runtime.log(`Auth profile: ${profileId} (${provider}/token)`);
}
export async function modelsAuthPasteTokenCommand(opts, runtime) {
  const rawProvider = opts.provider?.trim();
  if (!rawProvider) {
    throw new Error("Missing --provider.");
  }
  const provider = normalizeProviderId(rawProvider);
  const profileId = opts.profileId?.trim() || resolveDefaultTokenProfileId(provider);
  const tokenInput = await text({
    message: `Paste token for ${provider}`,
    validate: (value) => (value?.trim() ? undefined : "Required"),
  });
  const token = String(tokenInput ?? "").trim();
  const expires =
    opts.expiresIn?.trim() && opts.expiresIn.trim().length > 0
      ? Date.now() + parseDurationMs(String(opts.expiresIn ?? "").trim(), { defaultUnit: "d" })
      : undefined;
  upsertAuthProfile({
    profileId,
    credential: {
      type: "token",
      provider,
      token,
      ...(expires ? { expires } : {}),
    },
  });
  await updateConfig((cfg) => applyAuthProfileConfig(cfg, { profileId, provider, mode: "token" }));
  logConfigUpdated(runtime);
  runtime.log(`Auth profile: ${profileId} (${provider}/token)`);
}
export async function modelsAuthAddCommand(_opts, runtime) {
  const provider = await select({
    message: "Token provider",
    options: [
      { value: "anthropic", label: "anthropic" },
      { value: "custom", label: "custom (type provider id)" },
    ],
  });
  const providerId =
    provider === "custom"
      ? normalizeProviderId(
          String(
            await text({
              message: "Provider id",
              validate: (value) => (value?.trim() ? undefined : "Required"),
            }),
          ),
        )
      : provider;
  const method = await select({
    message: "Token method",
    options: [
      ...(providerId === "anthropic"
        ? [
            {
              value: "setup-token",
              label: "setup-token (claude)",
              hint: "Paste a setup-token from `claude setup-token`",
            },
          ]
        : []),
      { value: "paste", label: "paste token" },
    ],
  });
  if (method === "setup-token") {
    await modelsAuthSetupTokenCommand({ provider: providerId }, runtime);
    return;
  }
  const profileIdDefault = resolveDefaultTokenProfileId(providerId);
  const profileId = String(
    await text({
      message: "Profile id",
      initialValue: profileIdDefault,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();
  const wantsExpiry = await confirm({
    message: "Does this token expire?",
    initialValue: false,
  });
  const expiresIn = wantsExpiry
    ? String(
        await text({
          message: "Expires in (duration)",
          initialValue: "365d",
          validate: (value) => {
            try {
              parseDurationMs(String(value ?? ""), { defaultUnit: "d" });
              return;
            } catch {
              return "Invalid duration (e.g. 365d, 12h, 30m)";
            }
          },
        }),
      ).trim()
    : undefined;
  await modelsAuthPasteTokenCommand({ provider: providerId, profileId, expiresIn }, runtime);
}
export function resolveRequestedLoginProviderOrThrow(providers, rawProvider) {
  const requested = rawProvider?.trim();
  if (!requested) {
    return null;
  }
  const matched = resolveProviderMatch(providers, requested);
  if (matched) {
    return matched;
  }
  const available = providers
    .map((provider) => provider.id)
    .filter(Boolean)
    .toSorted((a, b) => a.localeCompare(b));
  const availableText = available.length > 0 ? available.join(", ") : "(none)";
  throw new Error(
    `Unknown provider "${requested}". Loaded providers: ${availableText}. Verify plugins via \`${formatCliCommand("genosos plugins list --json")}\`.`,
  );
}
export async function modelsAuthLoginCommand(opts, runtime) {
  if (!process.stdin.isTTY) {
    throw new Error("models auth login requires an interactive TTY.");
  }
  const config = await loadValidConfigOrThrow();
  const defaultAgentId = resolveDefaultAgentId(config);
  const agentDir = resolveAgentDir(config, defaultAgentId);
  const workspaceDir =
    resolveAgentWorkspaceDir(config, defaultAgentId) ?? resolveDefaultAgentWorkspaceDir();
  const providers = resolvePluginProviders({ config, workspaceDir });
  const prompter = createClackPrompter();

  // Fallback: if --provider matches an onboarding auth choice (e.g. github-copilot, chutes),
  // delegate to applyAuthChoice which handles all hardcoded flows.
  const requested = opts.provider?.trim();
  if (requested) {
    const matchedPlugin = resolveProviderMatch(providers, requested);
    if (!matchedPlugin) {
      const result = await applyAuthChoice({
        authChoice: requested,
        config,
        prompter,
        runtime,
        setDefaultModel: opts.setDefault,
      });
      if (result.config !== config) {
        await updateConfig(() => result.config);
        logConfigUpdated(runtime);
      }
      return;
    }
  }

  if (providers.length === 0) {
    throw new Error(
      `No provider plugins found. Install one via \`${formatCliCommand("genosos plugins install")}\`.`,
    );
  }
  const requestedProvider = resolveRequestedLoginProviderOrThrow(providers, opts.provider);
  const selectedProvider =
    requestedProvider ??
    (await prompter
      .select({
        message: "Select a provider",
        options: providers.map((provider) => ({
          value: provider.id,
          label: provider.label,
          hint: provider.docsPath ? `Docs: ${provider.docsPath}` : undefined,
        })),
      })
      .then((id) => resolveProviderMatch(providers, String(id))));
  if (!selectedProvider) {
    throw new Error("Unknown provider. Use --provider <id> to pick a provider plugin.");
  }
  const chosenMethod =
    pickAuthMethod(selectedProvider, opts.method) ??
    (selectedProvider.auth.length === 1
      ? selectedProvider.auth[0]
      : await prompter
          .select({
            message: `Auth method for ${selectedProvider.label}`,
            options: selectedProvider.auth.map((method) => ({
              value: method.id,
              label: method.label,
              hint: method.hint,
            })),
          })
          .then((id) => selectedProvider.auth.find((method) => method.id === String(id))));
  if (!chosenMethod) {
    throw new Error("Unknown auth method. Use --method <id> to select one.");
  }
  const isRemote = isRemoteEnvironment();
  const result = await chosenMethod.run({
    config,
    agentDir,
    workspaceDir,
    prompter,
    runtime,
    isRemote,
    openUrl: async (url) => {
      await openUrl(url);
    },
    oauth: {
      createVpsAwareHandlers: (params) => createVpsAwareOAuthHandlers(params),
    },
  });
  for (const profile of result.profiles) {
    upsertAuthProfile({
      profileId: profile.profileId,
      credential: profile.credential,
      agentDir,
    });
  }
  await updateConfig((cfg) => {
    let next = cfg;
    if (result.configPatch) {
      next = mergeConfigPatch(next, result.configPatch);
    }
    for (const profile of result.profiles) {
      next = applyAuthProfileConfig(next, {
        profileId: profile.profileId,
        provider: profile.credential.provider,
        mode: credentialMode(profile.credential),
      });
    }
    if (opts.setDefault && result.defaultModel) {
      next = applyDefaultModel(next, result.defaultModel);
    }
    return next;
  });
  logConfigUpdated(runtime);
  for (const profile of result.profiles) {
    runtime.log(
      `Auth profile: ${profile.profileId} (${profile.credential.provider}/${credentialMode(profile.credential)})`,
    );
  }
  if (result.defaultModel) {
    runtime.log(
      opts.setDefault
        ? `Default model set to ${result.defaultModel}`
        : `Default model available: ${result.defaultModel} (use --set-default to apply)`,
    );
  }
  if (result.notes && result.notes.length > 0) {
    await prompter.note(result.notes.join("\n"), "Provider notes");
  }
}
