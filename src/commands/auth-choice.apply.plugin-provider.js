import { resolveGenosOSAgentDir } from "../agents/agent-paths.js";
import {
  resolveDefaultAgentId,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
} from "../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { enablePluginInConfig } from "../plugins/enable.js";
import { resolvePluginProviders } from "../plugins/providers.js";
import { isRemoteEnvironment } from "./oauth-env.js";
import { createVpsAwareOAuthHandlers } from "./oauth-flow.js";
import { saveCredentialFormatAware } from "./onboard-auth.js";
import { applyCredentialToConfig } from "./onboard-auth.js";
import { openUrl } from "./onboard-helpers.js";
import {
  applyDefaultModel,
  mergeConfigPatch,
  pickAuthMethod,
  resolveProviderMatch,
} from "./provider-auth-helpers.js";
export async function applyAuthChoicePluginProvider(params, options) {
  if (params.authChoice !== options.authChoice) {
    return null;
  }
  const enableResult = enablePluginInConfig(params.config, options.pluginId);
  let nextConfig = enableResult.config;
  if (!enableResult.enabled) {
    await params.prompter.note(
      `${options.label} plugin is disabled (${enableResult.reason ?? "blocked"}).`,
      options.label,
    );
    return { config: nextConfig };
  }
  const agentId = params.agentId ?? resolveDefaultAgentId(nextConfig);
  const defaultAgentId = resolveDefaultAgentId(nextConfig);
  const agentDir =
    params.agentDir ??
    (agentId === defaultAgentId ? resolveGenosOSAgentDir() : resolveAgentDir(nextConfig, agentId));
  const workspaceDir =
    resolveAgentWorkspaceDir(nextConfig, agentId) ?? resolveDefaultAgentWorkspaceDir();
  const providers = resolvePluginProviders({ config: nextConfig, workspaceDir });
  const provider = resolveProviderMatch(providers, options.providerId);
  if (!provider) {
    await params.prompter.note(
      `${options.label} auth plugin is not available. Enable it and re-run the wizard.`,
      options.label,
    );
    return { config: nextConfig };
  }
  const method = pickAuthMethod(provider, options.methodId) ?? provider.auth[0];
  if (!method) {
    await params.prompter.note(`${options.label} auth method missing.`, options.label);
    return { config: nextConfig };
  }
  const isRemote = isRemoteEnvironment();
  const result = await method.run({
    config: nextConfig,
    agentDir,
    workspaceDir,
    prompter: params.prompter,
    runtime: params.runtime,
    isRemote,
    openUrl: async (url) => {
      await openUrl(url);
    },
    oauth: {
      createVpsAwareHandlers: (opts) => createVpsAwareOAuthHandlers(opts),
    },
  });
  if (result.configPatch) {
    nextConfig = mergeConfigPatch(nextConfig, result.configPatch);
  }
  for (const profile of result.profiles) {
    await saveCredentialFormatAware({
      profileId: profile.profileId,
      credential: profile.credential,
      agentDir,
    });
    nextConfig = await applyCredentialToConfig(nextConfig, {
      profileId: profile.profileId,
      provider: profile.credential.provider,
      mode: profile.credential.type === "token" ? "token" : profile.credential.type,
      ...("email" in profile.credential && profile.credential.email
        ? { email: profile.credential.email }
        : {}),
    });
  }
  let agentModelOverride;
  if (result.defaultModel) {
    if (params.setDefaultModel) {
      nextConfig = applyDefaultModel(nextConfig, result.defaultModel);
      await params.prompter.note(`Default model set to ${result.defaultModel}`, "Model configured");
    } else if (params.agentId) {
      agentModelOverride = result.defaultModel;
      await params.prompter.note(
        `Default model set to ${result.defaultModel} for agent "${params.agentId}".`,
        "Model configured",
      );
    }
  }
  if (result.notes && result.notes.length > 0) {
    await params.prompter.note(result.notes.join("\n"), "Provider notes");
  }
  return { config: nextConfig, agentModelOverride };
}
