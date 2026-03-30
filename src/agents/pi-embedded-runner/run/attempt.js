let summarizeMessagePayload = function (msg) {
    const content = msg.content;
    if (typeof content === "string") {
      return { textChars: content.length, imageBlocks: 0 };
    }
    if (!Array.isArray(content)) {
      return { textChars: 0, imageBlocks: 0 };
    }
    let textChars = 0;
    let imageBlocks = 0;
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const typedBlock = block;
      if (typedBlock.type === "image") {
        imageBlocks++;
        continue;
      }
      if (typeof typedBlock.text === "string") {
        textChars += typedBlock.text.length;
      }
    }
    return { textChars, imageBlocks };
  },
  summarizeSessionContext = function (messages) {
    const roleCounts = new Map();
    let totalTextChars = 0;
    let totalImageBlocks = 0;
    let maxMessageTextChars = 0;
    for (const msg of messages) {
      const role = typeof msg.role === "string" ? msg.role : "unknown";
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      const payload = summarizeMessagePayload(msg);
      totalTextChars += payload.textChars;
      totalImageBlocks += payload.imageBlocks;
      if (payload.textChars > maxMessageTextChars) {
        maxMessageTextChars = payload.textChars;
      }
    }
    return {
      roleCounts:
        [...roleCounts.entries()]
          .toSorted((a, b) => a[0].localeCompare(b[0]))
          .map(([role, count]) => `${role}:${count}`)
          .join(",") || "none",
      totalTextChars,
      totalImageBlocks,
      maxMessageTextChars,
    };
  };
import fs from "node:fs/promises";
import os from "node:os";
import { streamSimple } from "@mariozechner/pi-ai";
import { createAgentSession, SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import { resolveHeartbeatPrompt } from "../../../auto-reply/heartbeat.js";
import { resolveChannelCapabilities } from "../../../config/channel-capabilities.js";
import { registerAgentRunContext } from "../../../infra/agent-events.js";
import { getMachineDisplayName } from "../../../infra/machine-name.js";
import { MAX_IMAGE_BYTES } from "../../../media/constants.js";
import { getMemorySearchManager } from "../../../memory/index.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import {
  isCronSessionKey,
  isSubagentSessionKey,
  normalizeAgentId,
} from "../../../routing/session-key.js";
import { resolveSignalReactionLevel } from "../../../signal/reaction-level.js";
import { resolveTelegramInlineButtonsScope } from "../../../telegram/inline-buttons.js";
import { resolveTelegramReactionLevel } from "../../../telegram/reaction-level.js";
import { buildTtsSystemPromptHint } from "../../../tts/tts.js";
import { resolveUserPath } from "../../../utils.js";
import { normalizeMessageChannel } from "../../../utils/message-channel.js";
import { isReasoningTagProvider } from "../../../utils/provider-utils.js";
import { resolveGenosOSAgentDir } from "../../agent-paths.js";
import { listAgentEntries, resolveSessionAgentIds } from "../../agent-scope.js";
import { createAnthropicPayloadLogger } from "../../anthropic-payload-log.js";
import { makeBootstrapWarn, resolveBootstrapContextForRun } from "../../bootstrap-files.js";
import { createCacheTrace } from "../../cache-trace.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolHints,
} from "../../channel-tools.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../defaults.js";
import { resolveGenosOSDocsPath } from "../../docs-path.js";
import { isTimeoutError } from "../../failover-error.js";
import { resolveImageSanitizationLimits } from "../../image-sanitization.js";
import { resolveModelAuthMode } from "../../model-auth.js";
import { resolveDefaultModelForAgent } from "../../model-selection.js";
import {
  isCloudCodeAssistFormatError,
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
  validateAnthropicTurns,
  validateGeminiTurns,
} from "../../pi-embedded-helpers.js";
import { subscribeEmbeddedPiSession } from "../../pi-embedded-subscribe.js";
import {
  ensurePiCompactionReserveTokens,
  resolveCompactionReserveTokensFloor,
} from "../../pi-settings.js";
import { toClientToolDefinitions } from "../../pi-tool-definition-adapter.js";
import { createGenosOSCodingTools, resolveToolLoopDetectionConfig } from "../../pi-tools.js";
import {
  applySemanticToolFilter,
  indexToolEmbeddings,
  hasToolEmbeddings,
} from "../../semantic-tool-filter.js";
import { repairSessionFileIfNeeded } from "../../session-file-repair.js";
import { guardSessionManager } from "../../session-tool-result-guard-wrapper.js";
import { sanitizeToolUseResultPairing } from "../../session-transcript-repair.js";
import {
  acquireSessionWriteLock,
  resolveSessionLockMaxHoldFromTimeout,
} from "../../session-write-lock.js";
import { detectRuntimeShell } from "../../shell-utils.js";
import {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  loadWorkspaceSkillEntries,
  resolveSkillsPromptForRun,
} from "../../skills.js";
import { buildSystemPromptParams } from "../../system-prompt-params.js";
import { buildSystemPromptReport } from "../../system-prompt-report.js";
import { resolveTranscriptPolicy } from "../../transcript-policy.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../../workspace.js";
import { isRunnerAbortError } from "../abort.js";
import { appendCacheTtlTimestamp, isCacheTtlEligibleProvider } from "../cache-ttl.js";
import { buildEmbeddedExtensionPaths } from "../extensions.js";
import { applyExtraParamsToAgent } from "../extra-params.js";
import {
  logToolSchemasForGoogle,
  sanitizeAntigravityThinkingBlocks,
  sanitizeSessionHistory,
  sanitizeToolsForGoogle,
} from "../google.js";
import { getDmHistoryLimitFromSessionKey, limitHistoryTurns } from "../history.js";
import { log } from "../logger.js";
import { buildModelAliasLines } from "../model.js";
import { clearActiveEmbeddedRun, setActiveEmbeddedRun } from "../runs.js";
import {
  ensureSessionFileDecrypted,
  prewarmSessionFile,
  trackSessionManagerAccess,
} from "../session-manager-cache.js";
import { prepareSessionManagerForRun } from "../session-manager-init.js";
import {
  applySystemPromptOverrideToSession,
  buildEmbeddedSystemPrompt,
  createSystemPromptOverride,
} from "../system-prompt.js";
import { installToolResultContextGuard } from "../tool-result-context-guard.js";
import { splitSdkTools } from "../tool-split.js";
import { describeUnknownError, mapThinkingLevel } from "../utils.js";
import { flushPendingToolResultsAfterIdle } from "../wait-for-idle-before-flush.js";
import {
  selectCompactionTimeoutSnapshot,
  shouldFlagCompactionTimeout,
} from "./compaction-timeout.js";
import { detectAndLoadPromptImages } from "./images.js";
import { prefetchMemoryContext } from "./memory-prefetch.js";
export function injectHistoryImagesIntoMessages(messages, historyImagesByIndex) {
  if (historyImagesByIndex.size === 0) {
    return false;
  }
  let didMutate = false;
  for (const [msgIndex, images] of historyImagesByIndex) {
    if (msgIndex < 0 || msgIndex >= messages.length) {
      continue;
    }
    const msg = messages[msgIndex];
    if (msg && msg.role === "user") {
      if (typeof msg.content === "string") {
        msg.content = [{ type: "text", text: msg.content }];
        didMutate = true;
      }
      if (Array.isArray(msg.content)) {
        const existingImageData = new Set(
          msg.content
            .filter(
              (c) =>
                c != null &&
                typeof c === "object" &&
                c.type === "image" &&
                typeof c.data === "string",
            )
            .map((c) => c.data),
        );
        for (const img of images) {
          if (!existingImageData.has(img.data)) {
            msg.content.push(img);
            didMutate = true;
          }
        }
      }
    }
  }
  return didMutate;
}
export async function runEmbeddedAttempt(params) {
  const resolvedWorkspace = resolveUserPath(params.workspaceDir);
  const prevCwd = process.cwd();
  const runAbortController = new AbortController();
  log.debug(
    `embedded run start: runId=${params.runId} sessionId=${params.sessionId} provider=${params.provider} model=${params.modelId} thinking=${params.thinkLevel} messageChannel=${params.messageChannel ?? params.messageProvider ?? "unknown"}`,
  );
  await fs.mkdir(resolvedWorkspace, { recursive: true });
  const effectiveWorkspace = resolvedWorkspace;
  await fs.mkdir(effectiveWorkspace, { recursive: true });
  let restoreSkillEnv;
  process.chdir(effectiveWorkspace);
  try {
    const shouldLoadSkillEntries = !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
    const skillEntries = shouldLoadSkillEntries
      ? loadWorkspaceSkillEntries(effectiveWorkspace)
      : [];
    restoreSkillEnv = params.skillsSnapshot
      ? applySkillEnvOverridesFromSnapshot({
          snapshot: params.skillsSnapshot,
          config: params.config,
        })
      : applySkillEnvOverrides({
          skills: skillEntries ?? [],
          config: params.config,
        });
    const skillsPrompt = resolveSkillsPromptForRun({
      skillsSnapshot: params.skillsSnapshot,
      entries: shouldLoadSkillEntries ? skillEntries : undefined,
      config: params.config,
      workspaceDir: effectiveWorkspace,
    });
    const sessionLabel = params.sessionKey ?? params.sessionId;
    const { bootstrapFiles: hookAdjustedBootstrapFiles, contextFiles } =
      await resolveBootstrapContextForRun({
        workspaceDir: effectiveWorkspace,
        config: params.config,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        warn: makeBootstrapWarn({ sessionLabel, warn: (message) => log.warn(message) }),
      });
    const workspaceNotes = hookAdjustedBootstrapFiles.some(
      (file) => file.name === DEFAULT_BOOTSTRAP_FILENAME && !file.missing,
    )
      ? ["Reminder: commit your changes in this workspace after edits."]
      : undefined;
    const agentDir = params.agentDir ?? resolveGenosOSAgentDir();
    const modelHasVision = params.model.input?.includes("image") ?? false;
    const boostSessionRef = { current: null };
    const toolsRaw = params.disableTools
      ? []
      : createGenosOSCodingTools({
          exec: {
            ...params.execOverrides,
            elevated: params.bashElevated,
          },
          boostSessionRef,
          messageProvider: params.messageChannel ?? params.messageProvider,
          agentAccountId: params.agentAccountId,
          messageTo: params.messageTo,
          messageThreadId: params.messageThreadId,
          groupId: params.groupId,
          groupChannel: params.groupChannel,
          groupSpace: params.groupSpace,
          spawnedBy: params.spawnedBy,
          senderId: params.senderId,
          senderName: params.senderName,
          senderUsername: params.senderUsername,
          senderE164: params.senderE164,
          senderIsOwner: params.senderIsOwner,
          sessionKey: params.sessionKey ?? params.sessionId,
          agentDir,
          workspaceDir: effectiveWorkspace,
          config: params.config,
          abortSignal: runAbortController.signal,
          modelProvider: params.model.provider,
          modelId: params.modelId,
          modelContextWindowTokens: params.model.contextWindow,
          modelAuthMode: resolveModelAuthMode(params.model.provider, params.config),
          currentChannelId: params.currentChannelId,
          currentThreadTs: params.currentThreadTs,
          replyToMode: params.replyToMode,
          hasRepliedRef: params.hasRepliedRef,
          modelHasVision,
          requireExplicitMessageTarget:
            params.requireExplicitMessageTarget ?? isSubagentSessionKey(params.sessionKey),
          disableMessageTool: params.disableMessageTool,
        });
    // Semantic tool filter: index at first run, then filter by user intent
    if (!hasToolEmbeddings() && toolsRaw.length) {
      try {
        const { manager } = await getMemorySearchManager({
          cfg: params.config,
          agentId: params.agentId ?? "main",
        });
        if (manager?.provider) {
          await indexToolEmbeddings(toolsRaw, manager.provider);
        } else {
          log.info(
            `[tools] skip indexing: no embedding provider (manager=${!!manager}, provider=${!!manager?.provider})`,
          );
        }
      } catch (err) {
        log.warn(`[tools] indexing failed: ${err.message}`);
      }
    }
    let toolsFiltered = toolsRaw;
    if (hasToolEmbeddings() && params.prompt) {
      try {
        const { manager } = await getMemorySearchManager({
          cfg: params.config,
          agentId: params.agentId ?? "main",
        });
        const queryVec = manager ? await manager.embedQuery(params.prompt).catch(() => null) : null;
        if (queryVec) {
          const before = toolsFiltered.length;
          toolsFiltered = applySemanticToolFilter(toolsFiltered, queryVec);
          log.info(`[tools] semantic filter: ${before} → ${toolsFiltered.length} tools`);
        }
      } catch (err) {
        log.warn(`[tools] filter failed: ${err.message}`);
      }
    }
    const tools = sanitizeToolsForGoogle({ tools: toolsFiltered, provider: params.provider });
    logToolSchemasForGoogle({ tools, provider: params.provider });
    const machineName = await getMachineDisplayName();
    const runtimeChannel = normalizeMessageChannel(params.messageChannel ?? params.messageProvider);
    let runtimeCapabilities = runtimeChannel
      ? (resolveChannelCapabilities({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        }) ?? [])
      : undefined;
    if (runtimeChannel === "telegram" && params.config) {
      const inlineButtonsScope = resolveTelegramInlineButtonsScope({
        cfg: params.config,
        accountId: params.agentAccountId ?? undefined,
      });
      if (inlineButtonsScope !== "off") {
        if (!runtimeCapabilities) {
          runtimeCapabilities = [];
        }
        if (
          !runtimeCapabilities.some((cap) => String(cap).trim().toLowerCase() === "inlinebuttons")
        ) {
          runtimeCapabilities.push("inlineButtons");
        }
      }
    }
    const reactionGuidance =
      runtimeChannel && params.config
        ? (() => {
            if (runtimeChannel === "telegram") {
              const resolved = resolveTelegramReactionLevel({
                cfg: params.config,
                accountId: params.agentAccountId ?? undefined,
              });
              const level = resolved.agentReactionGuidance;
              return level ? { level, channel: "Telegram" } : undefined;
            }
            if (runtimeChannel === "signal") {
              const resolved = resolveSignalReactionLevel({
                cfg: params.config,
                accountId: params.agentAccountId ?? undefined,
              });
              const level = resolved.agentReactionGuidance;
              return level ? { level, channel: "Signal" } : undefined;
            }
            return;
          })()
        : undefined;
    const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
      sessionKey: params.sessionKey,
      config: params.config,
    });
    const reasoningTagHint = isReasoningTagProvider(params.provider);
    const channelActions = runtimeChannel
      ? listChannelSupportedActions({
          cfg: params.config,
          channel: runtimeChannel,
        })
      : undefined;
    const messageToolHints = runtimeChannel
      ? resolveChannelMessageToolHints({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        })
      : undefined;
    const defaultModelRef = resolveDefaultModelForAgent({
      cfg: params.config ?? {},
      agentId: sessionAgentId,
    });
    const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
    const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
      config: params.config,
      agentId: sessionAgentId,
      workspaceDir: effectiveWorkspace,
      cwd: process.cwd(),
      runtime: {
        host: machineName,
        os: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        model: `${params.provider}/${params.modelId}`,
        defaultModel: defaultModelLabel,
        shell: detectRuntimeShell(),
        channel: runtimeChannel,
        capabilities: runtimeCapabilities,
        channelActions,
      },
    });
    const isDefaultAgent = sessionAgentId === defaultAgentId;
    const promptMode =
      isSubagentSessionKey(params.sessionKey) || isCronSessionKey(params.sessionKey)
        ? "minimal"
        : "full";
    const docsPath = await resolveGenosOSDocsPath({
      workspaceDir: effectiveWorkspace,
      argv1: process.argv[1],
      cwd: process.cwd(),
      moduleUrl: import.meta.url,
    });
    const ttsHint = params.config ? buildTtsSystemPromptHint(params.config) : undefined;
    // Build specialist agents hint for early system prompt injection
    let specialistAgentsHint;
    if (isDefaultAgent) {
      const otherAgents = listAgentEntries(params.config).filter(
        (a) => a.id && a.id !== sessionAgentId,
      );
      if (otherAgents.length > 0) {
        const agentLines = otherAgents.map((a) => `- ${a.name ?? a.id} (agent:${a.id}:main)`);
        specialistAgentsHint = [
          "## Specialist Agents (mandatory)",
          "BEFORE using web_fetch, web_search, or any analysis tool: check this list.",
          "If a specialist matches the task, delegate via sessions_send to their main session. Do NOT do it yourself.",
          "",
          ...agentLines,
        ].join("\n");
        log.info(`[specialist-agents] injected ${otherAgents.length} agents into system prompt`);
      }
    }
    const appendPrompt = buildEmbeddedSystemPrompt({
      workspaceDir: effectiveWorkspace,
      defaultThinkLevel: params.thinkLevel,
      reasoningLevel: params.reasoningLevel ?? "off",
      extraSystemPrompt: params.extraSystemPrompt,
      ownerNumbers: params.ownerNumbers,
      reasoningTagHint,
      heartbeatPrompt: isDefaultAgent
        ? resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt)
        : undefined,
      skillsPrompt,
      docsPath: docsPath ?? undefined,
      ttsHint,
      workspaceNotes,
      reactionGuidance,
      promptMode,
      runtimeInfo,
      messageToolHints,
      tools,
      modelAliasLines: buildModelAliasLines(params.config),
      userTimezone,
      userTime,
      userTimeFormat,
      contextFiles,
      memoryCitationsMode: params.config?.memory?.citations,
      specialistAgentsHint,
    });
    const systemPromptReport = buildSystemPromptReport({
      source: "run",
      generatedAt: Date.now(),
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      provider: params.provider,
      model: params.modelId,
      workspaceDir: effectiveWorkspace,
      bootstrapMaxChars: resolveBootstrapMaxChars(params.config),
      bootstrapTotalMaxChars: resolveBootstrapTotalMaxChars(params.config),
      sandbox: { mode: "none", sandboxed: false },
      systemPrompt: appendPrompt,
      bootstrapFiles: hookAdjustedBootstrapFiles,
      injectedFiles: contextFiles,
      skillsPrompt,
      tools,
    });
    const systemPromptOverride = createSystemPromptOverride(appendPrompt);
    const systemPromptText = systemPromptOverride();
    const sessionLock = await acquireSessionWriteLock({
      sessionFile: params.sessionFile,
      maxHoldMs: resolveSessionLockMaxHoldFromTimeout({
        timeoutMs: params.timeoutMs,
      }),
    });
    let sessionManager;
    let session;
    let removeToolResultContextGuard;
    try {
      await repairSessionFileIfNeeded({
        sessionFile: params.sessionFile,
        warn: (message) => log.warn(message),
      });
      const hadSessionFile = await fs
        .stat(params.sessionFile)
        .then(() => true)
        .catch(() => false);
      const transcriptPolicy = resolveTranscriptPolicy({
        modelApi: params.model?.api,
        provider: params.provider,
        modelId: params.modelId,
      });
      ensureSessionFileDecrypted(params.sessionFile);
      await prewarmSessionFile(params.sessionFile);
      sessionManager = guardSessionManager(SessionManager.open(params.sessionFile), {
        agentId: sessionAgentId,
        sessionKey: params.sessionKey,
        inputProvenance: params.inputProvenance,
        allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
      });
      trackSessionManagerAccess(params.sessionFile);
      await prepareSessionManagerForRun({
        sessionManager,
        sessionFile: params.sessionFile,
        hadSessionFile,
        sessionId: params.sessionId,
        cwd: effectiveWorkspace,
      });
      const settingsManager = SettingsManager.create(effectiveWorkspace, agentDir);
      ensurePiCompactionReserveTokens({
        settingsManager,
        minReserveTokens: resolveCompactionReserveTokensFloor(params.config),
      });
      buildEmbeddedExtensionPaths({
        cfg: params.config,
        sessionManager,
        provider: params.provider,
        modelId: params.modelId,
        model: params.model,
      });
      const hookRunner = getGlobalHookRunner();
      const { builtInTools, customTools } = splitSdkTools({
        tools,
        sandboxEnabled: false,
      });
      let clientToolCallDetected = null;
      const clientToolLoopDetection = resolveToolLoopDetectionConfig({
        cfg: params.config,
        agentId: sessionAgentId,
      });
      const clientToolDefs = params.clientTools
        ? toClientToolDefinitions(
            params.clientTools,
            (toolName, toolParams) => {
              clientToolCallDetected = { name: toolName, params: toolParams };
            },
            {
              agentId: sessionAgentId,
              sessionKey: params.sessionKey,
              loopDetection: clientToolLoopDetection,
            },
          )
        : [];
      const allCustomTools = [...customTools, ...clientToolDefs];
      ({ session } = await createAgentSession({
        cwd: resolvedWorkspace,
        agentDir,
        authStorage: params.authStorage,
        modelRegistry: params.modelRegistry,
        model: params.model,
        thinkingLevel: mapThinkingLevel(params.thinkLevel),
        tools: builtInTools,
        customTools: allCustomTools,
        sessionManager,
        settingsManager,
      }));
      applySystemPromptOverrideToSession(session, systemPromptText);
      if (!session) {
        throw new Error("Embedded agent session missing");
      }
      const activeSession = session;
      boostSessionRef.current = activeSession;
      removeToolResultContextGuard = installToolResultContextGuard({
        agent: activeSession.agent,
        contextWindowTokens: Math.max(
          1,
          Math.floor(
            params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
          ),
        ),
      });
      const cacheTrace = createCacheTrace({
        cfg: params.config,
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });
      const anthropicPayloadLogger = createAnthropicPayloadLogger({
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });
      activeSession.agent.streamFn = streamSimple;
      applyExtraParamsToAgent(
        activeSession.agent,
        params.config,
        params.provider,
        params.modelId,
        params.streamParams,
      );
      if (cacheTrace) {
        cacheTrace.recordStage("session:loaded", {
          messages: activeSession.messages,
          system: systemPromptText,
          note: "after session create",
        });
        activeSession.agent.streamFn = cacheTrace.wrapStreamFn(activeSession.agent.streamFn);
      }
      if (anthropicPayloadLogger) {
        activeSession.agent.streamFn = anthropicPayloadLogger.wrapStreamFn(
          activeSession.agent.streamFn,
        );
      }
      try {
        const prior = await sanitizeSessionHistory({
          messages: activeSession.messages,
          modelApi: params.model.api,
          modelId: params.modelId,
          provider: params.provider,
          config: params.config,
          sessionManager,
          sessionId: params.sessionId,
          policy: transcriptPolicy,
        });
        cacheTrace?.recordStage("session:sanitized", { messages: prior });
        const validatedGemini = transcriptPolicy.validateGeminiTurns
          ? validateGeminiTurns(prior)
          : prior;
        const validated = transcriptPolicy.validateAnthropicTurns
          ? validateAnthropicTurns(validatedGemini)
          : validatedGemini;
        const truncated = limitHistoryTurns(
          validated,
          getDmHistoryLimitFromSessionKey(params.sessionKey, params.config),
        );
        const limited = transcriptPolicy.repairToolUseResultPairing
          ? sanitizeToolUseResultPairing(truncated)
          : truncated;
        cacheTrace?.recordStage("session:limited", { messages: limited });
        if (limited.length > 0) {
          activeSession.agent.replaceMessages(limited);
        }
      } catch (err) {
        await flushPendingToolResultsAfterIdle({
          agent: activeSession?.agent,
          sessionManager,
        });
        activeSession.dispose();
        throw err;
      }
      let aborted = Boolean(params.abortSignal?.aborted);
      let timedOut = false;
      let timedOutDuringCompaction = false;
      const getAbortReason = (signal) => ("reason" in signal ? signal.reason : undefined);
      const makeTimeoutAbortReason = () => {
        const err = new Error("request timed out");
        err.name = "TimeoutError";
        return err;
      };
      const makeAbortError = (signal) => {
        const reason = getAbortReason(signal);
        const err = reason ? new Error("aborted", { cause: reason }) : new Error("aborted");
        err.name = "AbortError";
        return err;
      };
      const abortRun = (isTimeout = false, reason) => {
        aborted = true;
        if (isTimeout) {
          timedOut = true;
        }
        if (isTimeout) {
          runAbortController.abort(reason ?? makeTimeoutAbortReason());
        } else {
          runAbortController.abort(reason);
        }
        activeSession.abort();
      };
      const abortable = (promise) => {
        const signal = runAbortController.signal;
        if (signal.aborted) {
          return Promise.reject(makeAbortError(signal));
        }
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(makeAbortError(signal));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          promise.then(
            (value) => {
              signal.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (err) => {
              signal.removeEventListener("abort", onAbort);
              reject(err);
            },
          );
        });
      };
      const subscription = subscribeEmbeddedPiSession({
        session: activeSession,
        runId: params.runId,
        hookRunner: getGlobalHookRunner() ?? undefined,
        verboseLevel: params.verboseLevel,
        reasoningMode: params.reasoningLevel ?? "off",
        toolResultFormat: params.toolResultFormat,
        shouldEmitToolResult: params.shouldEmitToolResult,
        shouldEmitToolOutput: params.shouldEmitToolOutput,
        onToolResult: params.onToolResult,
        onReasoningStream: params.onReasoningStream,
        onReasoningEnd: params.onReasoningEnd,
        onBlockReply: params.onBlockReply,
        onBlockReplyFlush: params.onBlockReplyFlush,
        blockReplyBreak: params.blockReplyBreak,
        blockReplyChunking: params.blockReplyChunking,
        onPartialReply: params.onPartialReply,
        onAssistantMessageStart: params.onAssistantMessageStart,
        onAgentEvent: params.onAgentEvent,
        enforceFinalTag: params.enforceFinalTag,
        config: params.config,
        sessionKey: params.sessionKey ?? params.sessionId,
      });
      const {
        assistantTexts,
        toolMetas,
        unsubscribe,
        waitForCompactionRetry,
        getMessagingToolSentTexts,
        getMessagingToolSentMediaUrls,
        getMessagingToolSentTargets,
        getSuccessfulCronAdds,
        didSendViaMessagingTool,
        getLastToolError,
        getUsageTotals,
        getCompactionCount,
      } = subscription;
      const queueHandle = {
        queueMessage: async (text) => {
          await activeSession.steer(text);
        },
        isStreaming: () => activeSession.isStreaming,
        isCompacting: () => subscription.isCompacting(),
        abort: abortRun,
      };
      setActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);
      let abortWarnTimer;
      const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;
      const abortTimer = setTimeout(
        () => {
          if (!isProbeSession) {
            log.warn(
              `embedded run timeout: runId=${params.runId} sessionId=${params.sessionId} timeoutMs=${params.timeoutMs}`,
            );
          }
          if (
            shouldFlagCompactionTimeout({
              isTimeout: true,
              isCompactionPendingOrRetrying: subscription.isCompacting(),
              isCompactionInFlight: activeSession.isCompacting,
            })
          ) {
            timedOutDuringCompaction = true;
          }
          abortRun(true);
          if (!abortWarnTimer) {
            abortWarnTimer = setTimeout(() => {
              if (!activeSession.isStreaming) {
                return;
              }
              if (!isProbeSession) {
                log.warn(
                  `embedded run abort still streaming: runId=${params.runId} sessionId=${params.sessionId}`,
                );
              }
            }, 1e4);
          }
        },
        Math.max(1, params.timeoutMs),
      );
      let messagesSnapshot = [];
      let sessionIdUsed = activeSession.sessionId;
      const onAbort = () => {
        const reason = params.abortSignal ? getAbortReason(params.abortSignal) : undefined;
        const timeout = reason ? isTimeoutError(reason) : false;
        if (
          shouldFlagCompactionTimeout({
            isTimeout: timeout,
            isCompactionPendingOrRetrying: subscription.isCompacting(),
            isCompactionInFlight: activeSession.isCompacting,
          })
        ) {
          timedOutDuringCompaction = true;
        }
        abortRun(timeout, reason);
      };
      if (params.abortSignal) {
        if (params.abortSignal.aborted) {
          onAbort();
        } else {
          params.abortSignal.addEventListener("abort", onAbort, {
            once: true,
          });
        }
      }
      const hookAgentId =
        typeof params.agentId === "string" && params.agentId.trim()
          ? normalizeAgentId(params.agentId)
          : resolveSessionAgentIds({
              sessionKey: params.sessionKey,
              config: params.config,
            }).sessionAgentId;
      let promptError = null;
      let promptErrorSource = null;
      let memoryPrefetch = { context: null, chunks: 0, searchMs: 0 };
      try {
        const promptStartedAt = Date.now();
        let effectivePrompt = params.prompt;
        const hookCtx = {
          agentId: hookAgentId,
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          workspaceDir: params.workspaceDir,
          messageProvider: params.messageProvider ?? undefined,
        };
        const promptBuildResult = hookRunner?.hasHooks("before_prompt_build")
          ? await hookRunner
              .runBeforePromptBuild(
                {
                  prompt: params.prompt,
                  messages: activeSession.messages,
                },
                hookCtx,
              )
              .catch((hookErr) => {
                log.warn(`before_prompt_build hook failed: ${String(hookErr)}`);
                return;
              })
          : undefined;
        const legacyResult = hookRunner?.hasHooks("before_agent_start")
          ? await hookRunner
              .runBeforeAgentStart(
                {
                  prompt: params.prompt,
                  messages: activeSession.messages,
                },
                hookCtx,
              )
              .catch((hookErr) => {
                log.warn(
                  `before_agent_start hook (legacy prompt build path) failed: ${String(hookErr)}`,
                );
                return;
              })
          : undefined;
        const hookResult = {
          systemPrompt: promptBuildResult?.systemPrompt ?? legacyResult?.systemPrompt,
          prependContext: [promptBuildResult?.prependContext, legacyResult?.prependContext]
            .filter((value) => Boolean(value))
            .join("\n\n"),
        };
        memoryPrefetch = await prefetchMemoryContext({
          prompt: params.prompt,
          config: params.config,
          sessionKey: params.sessionKey,
        }).catch((err) => {
          log.warn(`memory-prefetch: unexpected error — ${String(err)}`);
          return { context: null, chunks: 0, searchMs: 0 };
        });
        if (memoryPrefetch.chunks > 0) {
          registerAgentRunContext(params.runId, {
            memoryPrefetchChunks: memoryPrefetch.chunks,
          });
        }
        {
          const allPrependParts = [hookResult?.prependContext, memoryPrefetch.context].filter(
            Boolean,
          );
          if (allPrependParts.length > 0) {
            const combined = allPrependParts.join("\n\n");
            effectivePrompt = `${combined}\n\n${params.prompt}`;
            log.debug(
              `prepended context to prompt (${combined.length} chars, memoryChunks=${memoryPrefetch.chunks}, memoryMs=${memoryPrefetch.searchMs})`,
            );
          }
        }
        log.debug(`embedded run prompt start: runId=${params.runId} sessionId=${params.sessionId}`);
        cacheTrace?.recordStage("prompt:before", {
          prompt: effectivePrompt,
          messages: activeSession.messages,
        });
        const leafEntry = sessionManager.getLeafEntry();
        if (leafEntry?.type === "message" && leafEntry.message.role === "user") {
          if (leafEntry.parentId) {
            sessionManager.branch(leafEntry.parentId);
          } else {
            sessionManager.resetLeaf();
          }
          const sessionContext = sessionManager.buildSessionContext();
          const sanitizedOrphan = transcriptPolicy.normalizeAntigravityThinkingBlocks
            ? sanitizeAntigravityThinkingBlocks(sessionContext.messages)
            : sessionContext.messages;
          activeSession.agent.replaceMessages(sanitizedOrphan);
          log.warn(
            `Removed orphaned user message (leftover from a previous failed run). Session repaired and retrying. If the response hangs, use /abort or /reset. runId=${params.runId} sessionId=${params.sessionId}`,
          );
        }
        try {
          const imageResult = await detectAndLoadPromptImages({
            prompt: effectivePrompt,
            workspaceDir: effectiveWorkspace,
            model: params.model,
            existingImages: params.images,
            historyMessages: activeSession.messages,
            maxBytes: MAX_IMAGE_BYTES,
            maxDimensionPx: resolveImageSanitizationLimits(params.config).maxDimensionPx,
            sandbox: undefined,
          });
          const didMutate = injectHistoryImagesIntoMessages(
            activeSession.messages,
            imageResult.historyImagesByIndex,
          );
          if (didMutate) {
            activeSession.agent.replaceMessages(activeSession.messages);
          }
          cacheTrace?.recordStage("prompt:images", {
            prompt: effectivePrompt,
            messages: activeSession.messages,
            note: `images: prompt=${imageResult.images.length} history=${imageResult.historyImagesByIndex.size}`,
          });
          if (log.isEnabled("debug")) {
            const msgCount = activeSession.messages.length;
            const systemLen = systemPromptText?.length ?? 0;
            const promptLen = effectivePrompt.length;
            const sessionSummary = summarizeSessionContext(activeSession.messages);
            log.debug(
              `[context-diag] pre-prompt: sessionKey=${params.sessionKey ?? params.sessionId} messages=${msgCount} roleCounts=${sessionSummary.roleCounts} historyTextChars=${sessionSummary.totalTextChars} maxMessageTextChars=${sessionSummary.maxMessageTextChars} historyImageBlocks=${sessionSummary.totalImageBlocks} systemPromptChars=${systemLen} promptChars=${promptLen} promptImages=${imageResult.images.length} historyImageMessages=${imageResult.historyImagesByIndex.size} provider=${params.provider}/${params.modelId} sessionFile=${params.sessionFile}`,
            );
          }
          if (hookRunner?.hasHooks("llm_input")) {
            hookRunner
              .runLlmInput(
                {
                  runId: params.runId,
                  sessionId: params.sessionId,
                  provider: params.provider,
                  model: params.modelId,
                  systemPrompt: systemPromptText,
                  prompt: effectivePrompt,
                  historyMessages: activeSession.messages,
                  imagesCount: imageResult.images.length,
                },
                {
                  agentId: hookAgentId,
                  sessionKey: params.sessionKey,
                  sessionId: params.sessionId,
                  workspaceDir: params.workspaceDir,
                  messageProvider: params.messageProvider ?? undefined,
                },
              )
              .catch((err) => {
                log.warn(`llm_input hook failed: ${String(err)}`);
              });
          }
          if (imageResult.images.length > 0) {
            await abortable(activeSession.prompt(effectivePrompt, { images: imageResult.images }));
          } else {
            await abortable(activeSession.prompt(effectivePrompt));
          }
        } catch (err) {
          promptError = err;
          promptErrorSource = "prompt";
        } finally {
          log.debug(
            `embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`,
          );
        }
        const wasCompactingBefore = activeSession.isCompacting;
        const snapshot = activeSession.messages.slice();
        const wasCompactingAfter = activeSession.isCompacting;
        const preCompactionSnapshot = wasCompactingBefore || wasCompactingAfter ? null : snapshot;
        const preCompactionSessionId = activeSession.sessionId;
        try {
          await abortable(waitForCompactionRetry());
        } catch (err) {
          if (isRunnerAbortError(err)) {
            if (!promptError) {
              promptError = err;
              promptErrorSource = "compaction";
            }
            if (!isProbeSession) {
              log.debug(
                `compaction wait aborted: runId=${params.runId} sessionId=${params.sessionId}`,
              );
            }
          } else {
            throw err;
          }
        }
        if (!timedOutDuringCompaction) {
          const shouldTrackCacheTtl =
            params.config?.agents?.defaults?.contextPruning?.mode === "cache-ttl" &&
            isCacheTtlEligibleProvider(params.provider, params.modelId);
          if (shouldTrackCacheTtl) {
            appendCacheTtlTimestamp(sessionManager, {
              timestamp: Date.now(),
              provider: params.provider,
              modelId: params.modelId,
            });
          }
        }
        const snapshotSelection = selectCompactionTimeoutSnapshot({
          timedOutDuringCompaction,
          preCompactionSnapshot,
          preCompactionSessionId,
          currentSnapshot: activeSession.messages.slice(),
          currentSessionId: activeSession.sessionId,
        });
        if (timedOutDuringCompaction) {
          if (!isProbeSession) {
            log.warn(
              `using ${snapshotSelection.source} snapshot: timed out during compaction runId=${params.runId} sessionId=${params.sessionId}`,
            );
          }
        }
        messagesSnapshot = snapshotSelection.messagesSnapshot;
        sessionIdUsed = snapshotSelection.sessionIdUsed;
        if (promptError && promptErrorSource === "prompt") {
          try {
            sessionManager.appendCustomEntry("genosos:prompt-error", {
              timestamp: Date.now(),
              runId: params.runId,
              sessionId: params.sessionId,
              provider: params.provider,
              model: params.modelId,
              api: params.model.api,
              error: describeUnknownError(promptError),
            });
          } catch (entryErr) {
            log.warn(`failed to persist prompt error entry: ${String(entryErr)}`);
          }
        }
        cacheTrace?.recordStage("session:after", {
          messages: messagesSnapshot,
          note: timedOutDuringCompaction
            ? "compaction timeout"
            : promptError
              ? "prompt error"
              : undefined,
        });
        anthropicPayloadLogger?.recordUsage(messagesSnapshot, promptError);
        if (hookRunner?.hasHooks("agent_end")) {
          hookRunner
            .runAgentEnd(
              {
                messages: messagesSnapshot,
                success: !aborted && !promptError,
                error: promptError ? describeUnknownError(promptError) : undefined,
                durationMs: Date.now() - promptStartedAt,
              },
              {
                agentId: hookAgentId,
                sessionKey: params.sessionKey,
                sessionId: params.sessionId,
                workspaceDir: params.workspaceDir,
                messageProvider: params.messageProvider ?? undefined,
              },
            )
            .catch((err) => {
              log.warn(`agent_end hook failed: ${err}`);
            });
        }
      } finally {
        clearTimeout(abortTimer);
        if (abortWarnTimer) {
          clearTimeout(abortWarnTimer);
        }
        if (!isProbeSession && (aborted || timedOut) && !timedOutDuringCompaction) {
          log.debug(
            `run cleanup: runId=${params.runId} sessionId=${params.sessionId} aborted=${aborted} timedOut=${timedOut}`,
          );
        }
        try {
          unsubscribe();
        } catch (err) {
          log.error(
            `CRITICAL: unsubscribe failed, possible resource leak: runId=${params.runId} ${String(err)}`,
          );
        }
        clearActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);
        params.abortSignal?.removeEventListener?.("abort", onAbort);
      }
      const lastAssistant = messagesSnapshot
        .slice()
        .toReversed()
        .find((m) => m.role === "assistant");
      const toolMetasNormalized = toolMetas
        .filter((entry) => typeof entry.toolName === "string" && entry.toolName.trim().length > 0)
        .map((entry) => ({ toolName: entry.toolName, meta: entry.meta }));
      if (hookRunner?.hasHooks("llm_output")) {
        hookRunner
          .runLlmOutput(
            {
              runId: params.runId,
              sessionId: params.sessionId,
              provider: params.provider,
              model: params.modelId,
              assistantTexts,
              lastAssistant,
              usage: getUsageTotals(),
            },
            {
              agentId: hookAgentId,
              sessionKey: params.sessionKey,
              sessionId: params.sessionId,
              workspaceDir: params.workspaceDir,
              messageProvider: params.messageProvider ?? undefined,
            },
          )
          .catch((err) => {
            log.warn(`llm_output hook failed: ${String(err)}`);
          });
      }
      return {
        aborted,
        timedOut,
        timedOutDuringCompaction,
        promptError,
        sessionIdUsed,
        systemPromptReport,
        messagesSnapshot,
        assistantTexts,
        toolMetas: toolMetasNormalized,
        lastAssistant,
        lastToolError: getLastToolError?.(),
        didSendViaMessagingTool: didSendViaMessagingTool(),
        messagingToolSentTexts: getMessagingToolSentTexts(),
        messagingToolSentMediaUrls: getMessagingToolSentMediaUrls(),
        messagingToolSentTargets: getMessagingToolSentTargets(),
        successfulCronAdds: getSuccessfulCronAdds(),
        cloudCodeAssistFormatError: Boolean(
          lastAssistant?.errorMessage && isCloudCodeAssistFormatError(lastAssistant.errorMessage),
        ),
        attemptUsage: getUsageTotals(),
        compactionCount: getCompactionCount(),
        clientToolCall: clientToolCallDetected ?? undefined,
        memoryPrefetch:
          memoryPrefetch.chunks > 0
            ? { chunks: memoryPrefetch.chunks, searchMs: memoryPrefetch.searchMs }
            : undefined,
      };
    } finally {
      removeToolResultContextGuard?.();
      await flushPendingToolResultsAfterIdle({
        agent: session?.agent,
        sessionManager,
      });
      session?.dispose();
      await sessionLock.release();
    }
  } finally {
    restoreSkillEnv?.();
    process.chdir(prevCwd);
  }
}
