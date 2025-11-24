/**
 * Rewrite the summary field of the last compaction entry in a session JSONL file.
 * @param {string} sessionFile - Path to the JSONL session file
 * @param {string} newSummary - TOON-encoded summary to replace the Markdown original
 */
let rewriteLastCompactionSummary = function (sessionFile, newSummary) {
    try {
      const raw = readFileSync(sessionFile, "utf-8");
      const lines = raw.trimEnd().split("\n");
      // Find last compaction entry from the end
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) {
          continue;
        }
        try {
          const entry = JSON.parse(line);
          if (entry.type === "compaction") {
            entry.summary = newSummary;
            lines[i] = JSON.stringify(entry);
            writeFileSync(sessionFile, lines.join("\n") + "\n");
            return;
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch (err) {
      log.warn(`Failed to rewrite compaction summary to TOON: ${err}`);
    }
  },
  createCompactionDiagId = function () {
    return `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  },
  getMessageTextChars = function (msg) {
    const content = msg.content;
    if (typeof content === "string") {
      return content.length;
    }
    if (!Array.isArray(content)) {
      return 0;
    }
    let total = 0;
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const text = block.text;
      if (typeof text === "string") {
        total += text.length;
      }
    }
    return total;
  },
  resolveMessageToolLabel = function (msg) {
    const candidate = msg.toolName ?? msg.name ?? msg.tool;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
  },
  summarizeCompactionMessages = function (messages) {
    let historyTextChars = 0;
    let toolResultChars = 0;
    const contributors = [];
    let estTokens = 0;
    let tokenEstimationFailed = false;
    for (const msg of messages) {
      const role = typeof msg.role === "string" ? msg.role : "unknown";
      const chars = getMessageTextChars(msg);
      historyTextChars += chars;
      if (role === "toolResult") {
        toolResultChars += chars;
      }
      contributors.push({ role, chars, tool: resolveMessageToolLabel(msg) });
      if (!tokenEstimationFailed) {
        try {
          estTokens += estimateTokens(msg);
        } catch {
          tokenEstimationFailed = true;
        }
      }
    }
    return {
      messages: messages.length,
      historyTextChars,
      toolResultChars,
      estTokens: tokenEstimationFailed ? undefined : estTokens,
      contributors: contributors.toSorted((a, b) => b.chars - a.chars).slice(0, 3),
    };
  },
  classifyCompactionReason = function (reason) {
    const text = (reason ?? "").trim().toLowerCase();
    if (!text) {
      return "unknown";
    }
    if (text.includes("nothing to compact")) {
      return "no_compactable_entries";
    }
    if (text.includes("below threshold")) {
      return "below_threshold";
    }
    if (text.includes("already compacted")) {
      return "already_compacted_recently";
    }
    if (text.includes("guard")) {
      return "guard_blocked";
    }
    if (text.includes("summary")) {
      return "summary_failed";
    }
    if (text.includes("timed out") || text.includes("timeout")) {
      return "timeout";
    }
    if (
      text.includes("400") ||
      text.includes("401") ||
      text.includes("403") ||
      text.includes("429")
    ) {
      return "provider_error_4xx";
    }
    if (
      text.includes("500") ||
      text.includes("502") ||
      text.includes("503") ||
      text.includes("504")
    ) {
      return "provider_error_5xx";
    }
    return "unknown";
  };
import { readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import {
  createAgentSession,
  estimateTokens,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { resolveHeartbeatPrompt } from "../../auto-reply/heartbeat.js";
import { resolveChannelCapabilities } from "../../config/channel-capabilities.js";
import { getMachineDisplayName } from "../../infra/machine-name.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { enqueueCommandInLane } from "../../process/command-queue.js";
import { isCronSessionKey, isSubagentSessionKey } from "../../routing/session-key.js";
import { extractAgentId } from "../../sessions/session-key-utils.js";
import { resolveSignalReactionLevel } from "../../signal/reaction-level.js";
import { resolveTelegramInlineButtonsScope } from "../../telegram/inline-buttons.js";
import { resolveTelegramReactionLevel } from "../../telegram/reaction-level.js";
import { buildTtsSystemPromptHint } from "../../tts/tts.js";
import { resolveUserPath } from "../../utils.js";
import { normalizeMessageChannel } from "../../utils/message-channel.js";
import { isReasoningTagProvider } from "../../utils/provider-utils.js";
import { resolveGenosOSAgentDir } from "../agent-paths.js";
import { listAgentEntries, resolveSessionAgentIds } from "../agent-scope.js";
import { makeBootstrapWarn, resolveBootstrapContextForRun } from "../bootstrap-files.js";
import { listChannelSupportedActions, resolveChannelMessageToolHints } from "../channel-tools.js";
import { buildStructuredCompactionInstructions } from "../compaction-instructions.js";
import { formatUserTime, resolveUserTimeFormat, resolveUserTimezone } from "../date-time.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../defaults.js";
import { resolveGenosOSDocsPath } from "../docs-path.js";
import { getApiKeyForModel, resolveModelAuthMode } from "../model-auth.js";
import { ensureGenosOSModelsJson } from "../models-config.js";
import {
  ensureSessionHeader,
  validateAnthropicTurns,
  validateGeminiTurns,
} from "../pi-embedded-helpers.js";
import { convertBootstrapToToon } from "../pi-embedded-helpers/md-to-toon.js";
import {
  ensurePiCompactionReserveTokens,
  resolveCompactionReserveTokensFloor,
} from "../pi-settings.js";
import { createGenosOSCodingTools } from "../pi-tools.js";
import { repairSessionFileIfNeeded } from "../session-file-repair.js";
import { guardSessionManager } from "../session-tool-result-guard-wrapper.js";
import { sanitizeToolUseResultPairing } from "../session-transcript-repair.js";
import {
  acquireSessionWriteLock,
  resolveSessionLockMaxHoldFromTimeout,
} from "../session-write-lock.js";
import { detectRuntimeShell } from "../shell-utils.js";
import {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  loadWorkspaceSkillEntries,
  resolveSkillsPromptForRun,
} from "../skills.js";
import { resolveTranscriptPolicy } from "../transcript-policy.js";
import {
  compactWithSafetyTimeout,
  EMBEDDED_COMPACTION_TIMEOUT_MS,
} from "./compaction-safety-timeout.js";
import { buildEmbeddedExtensionPaths } from "./extensions.js";
import {
  logToolSchemasForGoogle,
  sanitizeSessionHistory,
  sanitizeToolsForGoogle,
} from "./google.js";
import { getDmHistoryLimitFromSessionKey, limitHistoryTurns } from "./history.js";
import { resolveGlobalLane, resolveSessionLane } from "./lanes.js";
import { log } from "./logger.js";
import { buildModelAliasLines, resolveModel } from "./model.js";
import {
  ensureSessionFileDecrypted,
  prewarmSessionFile,
  trackSessionManagerAccess,
} from "./session-manager-cache.js";
import {
  applySystemPromptOverrideToSession,
  buildEmbeddedSystemPrompt,
  createSystemPromptOverride,
} from "./system-prompt.js";
import { splitSdkTools } from "./tool-split.js";
import { describeUnknownError, mapThinkingLevel } from "./utils.js";
import { flushPendingToolResultsAfterIdle } from "./wait-for-idle-before-flush.js";
export async function compactEmbeddedPiSessionDirect(params) {
  const startedAt = Date.now();
  const diagId = params.diagId?.trim() || createCompactionDiagId();
  const trigger = params.trigger ?? "manual";
  const attempt = params.attempt ?? 1;
  const maxAttempts = params.maxAttempts ?? 1;
  const runId = params.runId ?? params.sessionId;
  const resolvedWorkspace = resolveUserPath(params.workspaceDir);
  const prevCwd = process.cwd();
  const provider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
  const modelId = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fail = (reason) => {
    log.warn(
      `[compaction-diag] end runId=${runId} sessionKey=${params.sessionKey ?? params.sessionId} diagId=${diagId} trigger=${trigger} provider=${provider}/${modelId} attempt=${attempt} maxAttempts=${maxAttempts} outcome=failed reason=${classifyCompactionReason(reason)} durationMs=${Date.now() - startedAt}`,
    );
    return {
      ok: false,
      compacted: false,
      reason,
    };
  };
  const agentDir = params.agentDir ?? resolveGenosOSAgentDir();
  await ensureGenosOSModelsJson(params.config, agentDir);
  const { model, error, authStorage, modelRegistry } = resolveModel(
    provider,
    modelId,
    agentDir,
    params.config,
  );
  if (!model) {
    const reason = error ?? `Unknown model: ${provider}/${modelId}`;
    return fail(reason);
  }
  try {
    const apiKeyInfo = await getApiKeyForModel({
      model,
      cfg: params.config,
      profileId: params.authProfileId,
      agentDir,
    });
    if (!apiKeyInfo.apiKey) {
      if (apiKeyInfo.mode !== "aws-sdk") {
        throw new Error(
          `No API key resolved for provider "${model.provider}" (auth mode: ${apiKeyInfo.mode}).`,
        );
      }
    } else if (model.provider === "github-copilot") {
      const { resolveCopilotApiToken } = await import("../../providers/github-copilot-token.js");
      const copilotToken = await resolveCopilotApiToken({
        githubToken: apiKeyInfo.apiKey,
      });
      authStorage.setRuntimeApiKey(model.provider, copilotToken.token);
    } else {
      authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey);
    }
  } catch (err) {
    const reason = describeUnknownError(err);
    return fail(reason);
  }
  await fs.mkdir(resolvedWorkspace, { recursive: true });
  const effectiveWorkspace = resolvedWorkspace;
  await fs.mkdir(effectiveWorkspace, { recursive: true });
  await ensureSessionHeader({
    sessionFile: params.sessionFile,
    sessionId: params.sessionId,
    cwd: effectiveWorkspace,
  });
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
    const { contextFiles } = await resolveBootstrapContextForRun({
      workspaceDir: effectiveWorkspace,
      config: params.config,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      warn: makeBootstrapWarn({ sessionLabel, warn: (message) => log.warn(message) }),
    });
    const runAbortController = new AbortController();
    const toolsRaw = createGenosOSCodingTools({
      exec: {
        elevated: params.bashElevated,
      },
      messageProvider: params.messageChannel ?? params.messageProvider,
      agentAccountId: params.agentAccountId,
      sessionKey: params.sessionKey ?? params.sessionId,
      groupId: params.groupId,
      groupChannel: params.groupChannel,
      groupSpace: params.groupSpace,
      spawnedBy: params.spawnedBy,
      senderIsOwner: params.senderIsOwner,
      agentDir,
      workspaceDir: effectiveWorkspace,
      config: params.config,
      abortSignal: runAbortController.signal,
      modelProvider: model.provider,
      modelId,
      modelContextWindowTokens: model.contextWindow,
      modelAuthMode: resolveModelAuthMode(model.provider, params.config),
    });
    const tools = sanitizeToolsForGoogle({ tools: toolsRaw, provider });
    logToolSchemasForGoogle({ tools, provider });
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
    const runtimeInfo = {
      host: machineName,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version,
      model: `${provider}/${modelId}`,
      shell: detectRuntimeShell(),
      channel: runtimeChannel,
      capabilities: runtimeCapabilities,
      channelActions,
    };
    const reasoningTagHint = isReasoningTagProvider(provider);
    const userTimezone = resolveUserTimezone(params.config?.agents?.defaults?.userTimezone);
    const userTimeFormat = resolveUserTimeFormat(params.config?.agents?.defaults?.timeFormat);
    const userTime = formatUserTime(new Date(), userTimezone, userTimeFormat);
    const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
      sessionKey: params.sessionKey,
      config: params.config,
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
      promptMode,
      runtimeInfo,
      reactionGuidance,
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
    const systemPromptOverride = createSystemPromptOverride(appendPrompt);
    const sessionLock = await acquireSessionWriteLock({
      sessionFile: params.sessionFile,
      maxHoldMs: resolveSessionLockMaxHoldFromTimeout({
        timeoutMs: EMBEDDED_COMPACTION_TIMEOUT_MS,
      }),
    });
    try {
      await repairSessionFileIfNeeded({
        sessionFile: params.sessionFile,
        warn: (message) => log.warn(message),
      });
      ensureSessionFileDecrypted(params.sessionFile);
      await prewarmSessionFile(params.sessionFile);
      const transcriptPolicy = resolveTranscriptPolicy({
        modelApi: model.api,
        provider,
        modelId,
      });
      const sessionManager = guardSessionManager(SessionManager.open(params.sessionFile), {
        agentId: sessionAgentId,
        sessionKey: params.sessionKey,
        allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
      });
      trackSessionManagerAccess(params.sessionFile);
      const settingsManager = SettingsManager.create(effectiveWorkspace, agentDir);
      ensurePiCompactionReserveTokens({
        settingsManager,
        minReserveTokens: resolveCompactionReserveTokensFloor(params.config),
      });
      // Manual /compact: minimize keepRecentTokens so the user can compact whenever they want
      if (params.trigger === "manual") {
        settingsManager.applyOverrides({
          compaction: { keepRecentTokens: 0 },
        });
      }
      buildEmbeddedExtensionPaths({
        cfg: params.config,
        sessionManager,
        provider,
        modelId,
        model,
      });
      const { builtInTools, customTools } = splitSdkTools({
        tools,
        sandboxEnabled: false,
      });
      const { session } = await createAgentSession({
        cwd: resolvedWorkspace,
        agentDir,
        authStorage,
        modelRegistry,
        model,
        thinkingLevel: mapThinkingLevel(params.thinkLevel),
        tools: builtInTools,
        customTools,
        sessionManager,
        settingsManager,
      });
      applySystemPromptOverrideToSession(session, systemPromptOverride());
      try {
        const prior = await sanitizeSessionHistory({
          messages: session.messages,
          modelApi: model.api,
          modelId,
          provider,
          config: params.config,
          sessionManager,
          sessionId: params.sessionId,
          policy: transcriptPolicy,
        });
        const validatedGemini = transcriptPolicy.validateGeminiTurns
          ? validateGeminiTurns(prior)
          : prior;
        const validated = transcriptPolicy.validateAnthropicTurns
          ? validateAnthropicTurns(validatedGemini)
          : validatedGemini;
        const preCompactionMessages = [...session.messages];
        const truncated = limitHistoryTurns(
          validated,
          getDmHistoryLimitFromSessionKey(params.sessionKey, params.config),
        );
        const limited = transcriptPolicy.repairToolUseResultPairing
          ? sanitizeToolUseResultPairing(truncated)
          : truncated;
        if (limited.length > 0) {
          session.agent.replaceMessages(limited);
        }
        const hookRunner = getGlobalHookRunner();
        const hookCtx = {
          agentId: extractAgentId(params.sessionKey),
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          workspaceDir: params.workspaceDir,
          messageProvider: params.messageChannel ?? params.messageProvider,
        };
        if (hookRunner?.hasHooks("before_compaction")) {
          hookRunner
            .runBeforeCompaction(
              {
                messageCount: preCompactionMessages.length,
                compactingCount: limited.length,
                messages: preCompactionMessages,
                sessionFile: params.sessionFile,
              },
              hookCtx,
            )
            .catch((hookErr) => {
              log.warn(`before_compaction hook failed: ${String(hookErr)}`);
            });
        }
        let estimatedTokensBefore;
        try {
          estimatedTokensBefore = 0;
          for (const message of session.messages) {
            estimatedTokensBefore += estimateTokens(message);
          }
        } catch {
          estimatedTokensBefore = undefined;
        }
        const diagEnabled = log.isEnabled("debug");
        const preMetrics = diagEnabled ? summarizeCompactionMessages(session.messages) : undefined;
        if (diagEnabled && preMetrics) {
          log.debug(
            `[compaction-diag] start runId=${runId} sessionKey=${params.sessionKey ?? params.sessionId} diagId=${diagId} trigger=${trigger} provider=${provider}/${modelId} attempt=${attempt} maxAttempts=${maxAttempts} pre.messages=${preMetrics.messages} pre.historyTextChars=${preMetrics.historyTextChars} pre.toolResultChars=${preMetrics.toolResultChars} pre.estTokens=${preMetrics.estTokens ?? "unknown"}`,
          );
          log.debug(
            `[compaction-diag] contributors diagId=${diagId} top=${JSON.stringify(preMetrics.contributors)}`,
          );
        }
        const compactStartedAt = Date.now();
        const compactionInstructions =
          params.customInstructions ?? buildStructuredCompactionInstructions(params.config);
        const result = await compactWithSafetyTimeout(() =>
          session.compact(compactionInstructions),
        );
        // Post-process: convert Markdown summary to TOON for token efficiency
        if (result.summary) {
          const originalSummary = result.summary;
          const toonSummary = convertBootstrapToToon(result.summary);
          if (toonSummary && toonSummary !== result.summary) {
            result.summary = toonSummary;
            rewriteLastCompactionSummary(params.sessionFile, toonSummary);
          }
          // Write both versions for inspection
          const debugDir = resolveUserPath("~/.genosv1/debug");
          fs.mkdir(debugDir, { recursive: true })
            .then(() => {
              const ts = Date.now();
              fs.writeFile(`${debugDir}/compaction-${ts}-before.md`, originalSummary, "utf-8");
              fs.writeFile(
                `${debugDir}/compaction-${ts}-after.toon`,
                toonSummary ?? originalSummary,
                "utf-8",
              );
            })
            .catch(() => {});
        }
        const effectiveTokensBefore = result.tokensBefore || estimatedTokensBefore;
        let tokensAfter;
        try {
          tokensAfter = 0;
          for (const message of session.messages) {
            tokensAfter += estimateTokens(message);
          }
          if (effectiveTokensBefore && tokensAfter > effectiveTokensBefore) {
            tokensAfter = undefined;
          }
        } catch {
          tokensAfter = undefined;
        }
        if (hookRunner?.hasHooks("after_compaction")) {
          hookRunner
            .runAfterCompaction(
              {
                messageCount: session.messages.length,
                tokenCount: tokensAfter,
                compactedCount: limited.length - session.messages.length,
                sessionFile: params.sessionFile,
              },
              hookCtx,
            )
            .catch((hookErr) => {
              log.warn(`after_compaction hook failed: ${hookErr}`);
            });
        }
        const postMetrics = diagEnabled ? summarizeCompactionMessages(session.messages) : undefined;
        if (diagEnabled && preMetrics && postMetrics) {
          log.debug(
            `[compaction-diag] end runId=${runId} sessionKey=${params.sessionKey ?? params.sessionId} diagId=${diagId} trigger=${trigger} provider=${provider}/${modelId} attempt=${attempt} maxAttempts=${maxAttempts} outcome=compacted reason=none durationMs=${Date.now() - compactStartedAt} retrying=false post.messages=${postMetrics.messages} post.historyTextChars=${postMetrics.historyTextChars} post.toolResultChars=${postMetrics.toolResultChars} post.estTokens=${postMetrics.estTokens ?? "unknown"} delta.messages=${postMetrics.messages - preMetrics.messages} delta.historyTextChars=${postMetrics.historyTextChars - preMetrics.historyTextChars} delta.toolResultChars=${postMetrics.toolResultChars - preMetrics.toolResultChars} delta.estTokens=${typeof preMetrics.estTokens === "number" && typeof postMetrics.estTokens === "number" ? postMetrics.estTokens - preMetrics.estTokens : "unknown"}`,
          );
        }
        return {
          ok: true,
          compacted: true,
          result: {
            summary: result.summary,
            firstKeptEntryId: result.firstKeptEntryId,
            tokensBefore: effectiveTokensBefore,
            tokensAfter,
            details: result.details,
          },
        };
      } finally {
        await flushPendingToolResultsAfterIdle({
          agent: session?.agent,
          sessionManager,
        });
        session.dispose();
      }
    } finally {
      await sessionLock.release();
    }
  } catch (err) {
    const reason = describeUnknownError(err);
    return fail(reason);
  } finally {
    restoreSkillEnv?.();
    process.chdir(prevCwd);
  }
}
export async function compactEmbeddedPiSession(params) {
  const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);
  const enqueueGlobal =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(globalLane, task, opts));
  return enqueueCommandInLane(sessionLane, () =>
    enqueueGlobal(async () => compactEmbeddedPiSessionDirect(params)),
  );
}
