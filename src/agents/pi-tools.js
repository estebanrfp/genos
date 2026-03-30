let isOpenAIProvider = function (provider) {
    const normalized = provider?.trim().toLowerCase();
    return normalized === "openai" || normalized === "openai-codex";
  },
  isApplyPatchAllowedForModel = function (params) {
    const allowModels = Array.isArray(params.allowModels) ? params.allowModels : [];
    if (allowModels.length === 0) {
      return true;
    }
    const modelId = params.modelId?.trim();
    if (!modelId) {
      return false;
    }
    const normalizedModelId = modelId.toLowerCase();
    const provider = params.modelProvider?.trim().toLowerCase();
    const normalizedFull =
      provider && !normalizedModelId.includes("/")
        ? `${provider}/${normalizedModelId}`
        : normalizedModelId;
    return allowModels.some((entry) => {
      const normalized = entry.trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      return normalized === normalizedModelId || normalized === normalizedFull;
    });
  },
  resolveExecConfig = function (params) {
    const cfg = params.cfg;
    const globalExec = cfg?.tools?.exec;
    const agentExec =
      cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.exec : undefined;
    return {
      host: agentExec?.host ?? globalExec?.host,
      security: agentExec?.security ?? globalExec?.security,
      ask: agentExec?.ask ?? globalExec?.ask,
      node: agentExec?.node ?? globalExec?.node,
      pathPrepend: agentExec?.pathPrepend ?? globalExec?.pathPrepend,
      safeBins: agentExec?.safeBins ?? globalExec?.safeBins,
      denyBins: agentExec?.denyBins ?? globalExec?.denyBins,
      backgroundMs: agentExec?.backgroundMs ?? globalExec?.backgroundMs,
      timeoutSec: agentExec?.timeoutSec ?? globalExec?.timeoutSec,
      approvalRunningNoticeMs:
        agentExec?.approvalRunningNoticeMs ?? globalExec?.approvalRunningNoticeMs,
      cleanupMs: agentExec?.cleanupMs ?? globalExec?.cleanupMs,
      notifyOnExit: agentExec?.notifyOnExit ?? globalExec?.notifyOnExit,
      notifyOnExitEmptySuccess:
        agentExec?.notifyOnExitEmptySuccess ?? globalExec?.notifyOnExitEmptySuccess,
      applyPatch: agentExec?.applyPatch ?? globalExec?.applyPatch,
    };
  },
  resolveFsConfig = function (params) {
    const cfg = params.cfg;
    const globalFs = cfg?.tools?.fs;
    const agentFs =
      cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.fs : undefined;
    return {
      workspaceOnly: agentFs?.workspaceOnly ?? globalFs?.workspaceOnly,
    };
  };
import {
  codingTools,
  createEditTool,
  createReadTool,
  createWriteTool,
  readTool,
} from "@mariozechner/pi-coding-agent";
import { logWarn } from "../logger.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveGatewayMessageChannel } from "../utils/message-channel.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { createApplyPatchTool } from "./apply-patch.js";
import { createExecTool, createProcessTool } from "./bash-tools.js";
import { createSecuredBashTool } from "./bash-tools.secured-bash.js";
import { listChannelAgentTools } from "./channel-tools.js";
import { createGenosOSTools } from "./genosos-tools.js";
import { resolveImageSanitizationLimits } from "./image-sanitization.js";
import { wrapToolWithAbortSignal } from "./pi-tools.abort.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import {
  isToolAllowedByPolicies,
  resolveChannelRestrictions,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
} from "./pi-tools.policy.js";
import {
  assertRequiredParams,
  createGenosOSReadTool,
  createGenosOSWriteTool,
  createGenosOSEditTool,
  createSecureWriteOperations,
  createSecureEditOperations,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "./pi-tools.read.js";
import { cleanToolSchemaForGemini, normalizeToolParameters } from "./pi-tools.schema.js";
import { getSubagentDepthFromSessionStore } from "./subagent-depth.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
} from "./tool-policy-pipeline.js";
import {
  applyOwnerOnlyToolPolicy,
  collectExplicitAllowlist,
  mergeAlsoAllowPolicy,
  resolveToolProfilePolicy,
} from "./tool-policy.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";
export function resolveToolLoopDetectionConfig(params) {
  const global = params.cfg?.tools?.loopDetection;
  const agent =
    params.agentId && params.cfg
      ? resolveAgentConfig(params.cfg, params.agentId)?.tools?.loopDetection
      : undefined;
  if (!agent) {
    return global;
  }
  if (!global) {
    return agent;
  }
  return {
    ...global,
    ...agent,
    detectors: {
      ...global.detectors,
      ...agent.detectors,
    },
  };
}
export const __testing = {
  cleanToolSchemaForGemini,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
  assertRequiredParams,
};
export function createGenosOSCodingTools(options) {
  const execToolName = "exec";
  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  });
  const groupPolicy = resolveGroupToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    spawnedBy: options?.spawnedBy,
    messageProvider: options?.messageProvider,
    groupId: options?.groupId,
    groupChannel: options?.groupChannel,
    groupSpace: options?.groupSpace,
    accountId: options?.agentAccountId,
    senderId: options?.senderId,
    senderName: options?.senderName,
    senderUsername: options?.senderUsername,
    senderE164: options?.senderE164,
  });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);
  const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  const scopeKey =
    options?.exec?.scopeKey ?? options?.sessionKey ?? (agentId ? `agent:${agentId}` : undefined);
  const subagentPolicy =
    isSubagentSessionKey(options?.sessionKey) && options?.sessionKey
      ? resolveSubagentToolPolicy(
          options.config,
          getSubagentDepthFromSessionStore(options.sessionKey, { cfg: options.config }),
        )
      : undefined;
  const allowBackground = isToolAllowedByPolicies("process", [
    profilePolicyWithAlsoAllow,
    providerProfilePolicyWithAlsoAllow,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    groupPolicy,
    subagentPolicy,
  ]);
  const execConfig = resolveExecConfig({ cfg: options?.config, agentId });
  const fsConfig = resolveFsConfig({ cfg: options?.config, agentId });
  const workspaceRoot = resolveWorkspaceRoot(options?.workspaceDir);
  const workspaceOnly = fsConfig.workspaceOnly === true;
  const applyPatchConfig = execConfig.applyPatch;
  const applyPatchWorkspaceOnly = workspaceOnly || applyPatchConfig?.workspaceOnly !== false;
  const applyPatchEnabled =
    !!applyPatchConfig?.enabled &&
    isOpenAIProvider(options?.modelProvider) &&
    isApplyPatchAllowedForModel({
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      allowModels: applyPatchConfig?.allowModels,
    });
  const imageSanitization = resolveImageSanitizationLimits(options?.config);
  const base = codingTools.flatMap((tool) => {
    if (tool.name === readTool.name) {
      const freshReadTool = createReadTool(workspaceRoot);
      const wrapped = createGenosOSReadTool(freshReadTool, {
        modelContextWindowTokens: options?.modelContextWindowTokens,
        imageSanitization,
      });
      return [wrapped];
    }
    if (tool.name === execToolName) {
      return [];
    }
    if (tool.name === "bash") {
      return [
        createSecuredBashTool(workspaceRoot, {
          denyBins: options?.exec?.denyBins ?? execConfig.denyBins,
        }),
      ];
    }
    if (tool.name === "write") {
      const wrapped = createGenosOSWriteTool(
        createWriteTool(workspaceRoot, { operations: createSecureWriteOperations(workspaceRoot) }),
        { workspaceRoot, agentId },
      );
      return [wrapped];
    }
    if (tool.name === "edit") {
      const wrapped = createGenosOSEditTool(
        createEditTool(workspaceRoot, { operations: createSecureEditOperations(workspaceRoot) }),
        { workspaceRoot, agentId },
      );
      return [wrapped];
    }
    return [tool];
  });
  const { cleanupMs: cleanupMsOverride, ...execDefaults } = options?.exec ?? {};
  const execTool = createExecTool({
    ...execDefaults,
    host: options?.exec?.host ?? execConfig.host,
    security: options?.exec?.security ?? execConfig.security,
    ask: options?.exec?.ask ?? execConfig.ask,
    node: options?.exec?.node ?? execConfig.node,
    pathPrepend: options?.exec?.pathPrepend ?? execConfig.pathPrepend,
    safeBins: options?.exec?.safeBins ?? execConfig.safeBins,
    denyBins: options?.exec?.denyBins ?? execConfig.denyBins,
    agentId,
    cwd: workspaceRoot,
    allowBackground,
    scopeKey,
    sessionKey: options?.sessionKey,
    messageProvider: options?.messageProvider,
    backgroundMs: options?.exec?.backgroundMs ?? execConfig.backgroundMs,
    timeoutSec: options?.exec?.timeoutSec ?? execConfig.timeoutSec,
    approvalRunningNoticeMs:
      options?.exec?.approvalRunningNoticeMs ?? execConfig.approvalRunningNoticeMs,
    notifyOnExit: options?.exec?.notifyOnExit ?? execConfig.notifyOnExit,
    notifyOnExitEmptySuccess:
      options?.exec?.notifyOnExitEmptySuccess ?? execConfig.notifyOnExitEmptySuccess,
  });
  const processTool = createProcessTool({
    cleanupMs: cleanupMsOverride ?? execConfig.cleanupMs,
    scopeKey,
  });
  const applyPatchTool = !applyPatchEnabled
    ? null
    : createApplyPatchTool({
        cwd: workspaceRoot,
        workspaceOnly: applyPatchWorkspaceOnly,
      });
  const tools = [
    ...base,
    ...(applyPatchTool ? [applyPatchTool] : []),
    execTool,
    processTool,
    ...listChannelAgentTools({ cfg: options?.config }),
    ...createGenosOSTools({
      sandboxBrowserBridgeUrl: undefined,
      allowHostBrowserControl: true,
      agentSessionKey: options?.sessionKey,
      agentChannel: resolveGatewayMessageChannel(options?.messageProvider),
      agentAccountId: options?.agentAccountId,
      agentTo: options?.messageTo,
      agentThreadId: options?.messageThreadId,
      agentGroupId: options?.groupId ?? null,
      agentGroupChannel: options?.groupChannel ?? null,
      agentGroupSpace: options?.groupSpace ?? null,
      agentDir: options?.agentDir,
      workspaceDir: workspaceRoot,
      sandboxed: false,
      config: options?.config,
      modelProvider: options?.modelProvider,
      boostSessionRef: options?.boostSessionRef,
      pluginToolAllowlist: collectExplicitAllowlist([
        profilePolicy,
        providerProfilePolicy,
        globalPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        groupPolicy,
        subagentPolicy,
      ]),
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      replyToMode: options?.replyToMode,
      hasRepliedRef: options?.hasRepliedRef,
      modelHasVision: options?.modelHasVision,
      requireExplicitMessageTarget: options?.requireExplicitMessageTarget,
      disableMessageTool: options?.disableMessageTool,
      requesterAgentIdOverride: agentId,
    }),
  ];
  const channelPolicy = resolveChannelRestrictions({
    config: options?.config,
    agentId,
    messageProvider: options?.messageProvider,
  });
  const senderIsOwner = options?.senderIsOwner === true;
  const toolsByAuthorization = applyOwnerOnlyToolPolicy(tools, senderIsOwner);
  const subagentFiltered = applyToolPolicyPipeline({
    tools: toolsByAuthorization,
    toolMeta: (tool) => getPluginToolMeta(tool),
    warn: logWarn,
    steps: [
      ...buildDefaultToolPolicyPipelineSteps({
        profilePolicy: profilePolicyWithAlsoAllow,
        profile,
        providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
        providerProfile,
        globalPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        groupPolicy,
        agentId,
      }),
      { policy: channelPolicy, label: "channel restrictions" },
      { policy: subagentPolicy, label: "subagent tools.allow" },
    ],
  });
  const normalized = subagentFiltered.map((tool) =>
    normalizeToolParameters(tool, { modelProvider: options?.modelProvider }),
  );
  const withHooks = normalized.map((tool) =>
    wrapToolWithBeforeToolCallHook(tool, {
      agentId,
      sessionKey: options?.sessionKey,
      loopDetection: resolveToolLoopDetectionConfig({ cfg: options?.config, agentId }),
    }),
  );
  const withAbort = options?.abortSignal
    ? withHooks.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
    : withHooks;
  return withAbort;
}
