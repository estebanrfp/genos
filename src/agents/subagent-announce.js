let buildCompletionDeliveryMessage = function (params) {
    const findingsText = params.findings.trim();
    const hasFindings = findingsText.length > 0 && findingsText !== "(no output)";
    const header = `\u2705 Subagent ${params.subagentName} finished`;
    if (!hasFindings) {
      return header;
    }
    return `${header}\n\n${findingsText}`;
  },
  summarizeDeliveryError = function (error) {
    if (error instanceof Error) {
      return error.message || "error";
    }
    if (typeof error === "string") {
      return error;
    }
    if (error === undefined || error === null) {
      return "unknown error";
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "error";
    }
  },
  extractToolResultText = function (content) {
    if (typeof content === "string") {
      return sanitizeTextContent(content);
    }
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const obj = content;
      if (typeof obj.text === "string") {
        return sanitizeTextContent(obj.text);
      }
      if (typeof obj.output === "string") {
        return sanitizeTextContent(obj.output);
      }
      if (typeof obj.content === "string") {
        return sanitizeTextContent(obj.content);
      }
      if (typeof obj.result === "string") {
        return sanitizeTextContent(obj.result);
      }
      if (typeof obj.error === "string") {
        return sanitizeTextContent(obj.error);
      }
      if (typeof obj.summary === "string") {
        return sanitizeTextContent(obj.summary);
      }
    }
    if (!Array.isArray(content)) {
      return "";
    }
    const joined = extractTextFromChatContent(content, {
      sanitizeText: sanitizeTextContent,
      normalizeText: (text) => text,
      joinWith: "\n",
    });
    return joined?.trim() ?? "";
  },
  extractInlineTextContent = function (content) {
    if (!Array.isArray(content)) {
      return "";
    }
    return (
      extractTextFromChatContent(content, {
        sanitizeText: sanitizeTextContent,
        normalizeText: (text) => text.trim(),
        joinWith: "",
      }) ?? ""
    );
  },
  extractSubagentOutputText = function (message) {
    if (!message || typeof message !== "object") {
      return "";
    }
    const role = message.role;
    const content = message.content;
    if (role === "assistant") {
      const assistantText = extractAssistantText(message);
      if (assistantText) {
        return assistantText;
      }
      if (typeof content === "string") {
        return sanitizeTextContent(content);
      }
      if (Array.isArray(content)) {
        return extractInlineTextContent(content);
      }
      return "";
    }
    if (role === "toolResult" || role === "tool") {
      return extractToolResultText(message.content);
    }
    if (typeof content === "string") {
      return sanitizeTextContent(content);
    }
    if (Array.isArray(content)) {
      return extractInlineTextContent(content);
    }
    return "";
  },
  formatDurationShort = function (valueMs) {
    if (!valueMs || !Number.isFinite(valueMs) || valueMs <= 0) {
      return "n/a";
    }
    const totalSeconds = Math.round(valueMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m${seconds}s`;
    }
    return `${seconds}s`;
  },
  formatTokenCount = function (value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return "0";
    }
    if (value >= 1e6) {
      return `${(value / 1e6).toFixed(1)}m`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return String(Math.round(value));
  },
  resolveAnnounceOrigin = function (entry, requesterOrigin) {
    const normalizedRequester = normalizeDeliveryContext(requesterOrigin);
    const normalizedEntry = deliveryContextFromSession(entry);
    if (normalizedRequester?.channel && !isDeliverableMessageChannel(normalizedRequester.channel)) {
      return mergeDeliveryContext(
        {
          accountId: normalizedRequester.accountId,
          threadId: normalizedRequester.threadId,
        },
        normalizedEntry,
      );
    }
    return mergeDeliveryContext(normalizedRequester, normalizedEntry);
  },
  resolveRequesterStoreKey = function (cfg, requesterSessionKey) {
    const raw = requesterSessionKey.trim();
    if (!raw) {
      return raw;
    }
    if (raw === "global" || raw === "unknown") {
      return raw;
    }
    if (raw.startsWith("agent:")) {
      return raw;
    }
    const mainKey = normalizeMainKey(cfg.session?.mainKey);
    if (raw === "main" || raw === mainKey) {
      return resolveMainSessionKey(cfg);
    }
    const agentId = resolveAgentIdFromSessionKey(raw);
    return `agent:${agentId}:${raw}`;
  },
  loadRequesterSessionEntry = function (requesterSessionKey) {
    const cfg = loadConfig();
    const canonicalKey = resolveRequesterStoreKey(cfg, requesterSessionKey);
    const agentId = resolveAgentIdFromSessionKey(canonicalKey);
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const store = loadSessionStore(storePath);
    const entry = store[canonicalKey];
    return { cfg, entry, canonicalKey };
  },
  queueOutcomeToDeliveryResult = function (outcome) {
    if (outcome === "steered") {
      return {
        delivered: true,
        path: "steered",
      };
    }
    if (outcome === "queued") {
      return {
        delivered: true,
        path: "queued",
      };
    }
    return {
      delivered: false,
      path: "none",
    };
  },
  loadSessionEntryByKey = function (sessionKey) {
    const cfg = loadConfig();
    const agentId = resolveAgentIdFromSessionKey(sessionKey);
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const store = loadSessionStore(storePath);
    return store[sessionKey];
  },
  buildAnnounceReplyInstruction = function (params) {
    if (params.expectsCompletionMessage) {
      return `A ${params.announceType} completed. Give the user a brief one-line acknowledgment in your own voice. NEVER expose session keys, stats, tokens, runtime, sessionId, or any system internals.`;
    }
    if (params.remainingActiveSubagentRuns > 0) {
      const activeRunsLabel = params.remainingActiveSubagentRuns === 1 ? "run" : "runs";
      return `There are still ${params.remainingActiveSubagentRuns} active subagent ${activeRunsLabel}. If part of the same workflow, wait for remaining results. If unrelated, give a brief one-line acknowledgment. NEVER expose system internals.`;
    }
    if (params.requesterIsSubagent) {
      return `Summarize the result in one concise line for your parent agent. NEVER expose session keys, stats, tokens, or system internals. Reply ONLY: ${SILENT_REPLY_TOKEN} if duplicate or no update needed.`;
    }
    return `Give the user a brief one-line acknowledgment of the result in your own voice. NEVER expose session keys, stats, tokens, runtime, sessionId, or any system internals. Do NOT copy or paraphrase the system message. Reply ONLY: ${SILENT_REPLY_TOKEN} if this exact result was already delivered.`;
  };
import { resolveQueueSettings } from "../auto-reply/reply/queue.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveMainSessionKey,
  resolveStorePath,
} from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { normalizeMainKey } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { extractTextFromChatContent } from "../shared/chat-content.js";
import {
  deliveryContextFromSession,
  mergeDeliveryContext,
  normalizeDeliveryContext,
} from "../utils/delivery-context.js";
import { isDeliverableMessageChannel } from "../utils/message-channel.js";
import {
  buildAnnounceIdFromChildRun,
  buildAnnounceIdempotencyKey,
  resolveQueueAnnounceId,
} from "./announce-idempotency.js";
import {
  isEmbeddedPiRunActive,
  queueEmbeddedPiMessage,
  waitForEmbeddedPiRunEnd,
} from "./pi-embedded.js";
import { enqueueAnnounce } from "./subagent-announce-queue.js";
import { getSubagentDepthFromSessionStore } from "./subagent-depth.js";
import { sanitizeTextContent, extractAssistantText } from "./tools/sessions-helpers.js";
async function readLatestSubagentOutput(sessionKey) {
  const history = await callGateway({
    method: "chat.history",
    params: { sessionKey, limit: 50 },
  });
  const messages = Array.isArray(history?.messages) ? history.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const text = extractSubagentOutputText(msg);
    if (text) {
      return text;
    }
  }
  return;
}
async function readLatestSubagentOutputWithRetry(params) {
  const RETRY_INTERVAL_MS = 100;
  const deadline = Date.now() + Math.max(0, Math.min(params.maxWaitMs, 15000));
  let result;
  while (Date.now() < deadline) {
    result = await readLatestSubagentOutput(params.sessionKey);
    if (result?.trim()) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
  return result;
}
async function buildCompactAnnounceStatsLine(params) {
  const cfg = loadConfig();
  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  let entry = loadSessionStore(storePath)[params.sessionKey];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hasTokenData =
      typeof entry?.inputTokens === "number" ||
      typeof entry?.outputTokens === "number" ||
      typeof entry?.totalTokens === "number";
    if (hasTokenData) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    entry = loadSessionStore(storePath)[params.sessionKey];
  }
  const input = typeof entry?.inputTokens === "number" ? entry.inputTokens : 0;
  const output = typeof entry?.outputTokens === "number" ? entry.outputTokens : 0;
  const ioTotal = input + output;
  const promptCache = typeof entry?.totalTokens === "number" ? entry.totalTokens : undefined;
  const runtimeMs =
    typeof params.startedAt === "number" && typeof params.endedAt === "number"
      ? Math.max(0, params.endedAt - params.startedAt)
      : undefined;
  const parts = [
    `runtime ${formatDurationShort(runtimeMs)}`,
    `tokens ${formatTokenCount(ioTotal)} (in ${formatTokenCount(input)} / out ${formatTokenCount(output)})`,
  ];
  if (typeof promptCache === "number" && promptCache > ioTotal) {
    parts.push(`prompt/cache ${formatTokenCount(promptCache)}`);
  }
  return `Stats: ${parts.join(" \u2022 ")}`;
}
async function sendAnnounce(item) {
  const requesterDepth = getSubagentDepthFromSessionStore(item.sessionKey);
  const requesterIsSubagent = requesterDepth >= 1;
  const origin = item.origin;
  const threadId =
    origin?.threadId != null && origin.threadId !== "" ? String(origin.threadId) : undefined;
  const idempotencyKey = buildAnnounceIdempotencyKey(
    resolveQueueAnnounceId({
      announceId: item.announceId,
      sessionKey: item.sessionKey,
      enqueuedAt: item.enqueuedAt,
    }),
  );
  await callGateway({
    method: "agent",
    params: {
      sessionKey: item.sessionKey,
      message: item.prompt,
      channel: requesterIsSubagent ? undefined : origin?.channel,
      accountId: requesterIsSubagent ? undefined : origin?.accountId,
      to: requesterIsSubagent ? undefined : origin?.to,
      threadId: requesterIsSubagent ? undefined : threadId,
      deliver: !requesterIsSubagent,
      idempotencyKey,
    },
    timeoutMs: 15000,
  });
}
async function maybeQueueSubagentAnnounce(params) {
  const { cfg, entry } = loadRequesterSessionEntry(params.requesterSessionKey);
  const canonicalKey = resolveRequesterStoreKey(cfg, params.requesterSessionKey);
  const sessionId = entry?.sessionId;
  if (!sessionId) {
    return "none";
  }
  const queueSettings = resolveQueueSettings({
    cfg,
    channel: entry?.channel ?? entry?.lastChannel,
    sessionEntry: entry,
  });
  const isActive = isEmbeddedPiRunActive(sessionId);
  const shouldSteer = queueSettings.mode === "steer" || queueSettings.mode === "steer-backlog";
  if (shouldSteer) {
    const steered = queueEmbeddedPiMessage(sessionId, params.triggerMessage);
    if (steered) {
      return "steered";
    }
  }
  const shouldFollowup =
    queueSettings.mode === "followup" ||
    queueSettings.mode === "collect" ||
    queueSettings.mode === "steer-backlog" ||
    queueSettings.mode === "interrupt";
  if (isActive && (shouldFollowup || queueSettings.mode === "steer")) {
    const origin = resolveAnnounceOrigin(entry, params.requesterOrigin);
    enqueueAnnounce({
      key: canonicalKey,
      item: {
        announceId: params.announceId,
        prompt: params.triggerMessage,
        summaryLine: params.summaryLine,
        enqueuedAt: Date.now(),
        sessionKey: canonicalKey,
        origin,
      },
      settings: queueSettings,
      send: sendAnnounce,
    });
    return "queued";
  }
  return "none";
}
async function sendSubagentAnnounceDirectly(params) {
  const cfg = loadConfig();
  const canonicalRequesterSessionKey = resolveRequesterStoreKey(
    cfg,
    params.targetRequesterSessionKey,
  );
  try {
    const completionDirectOrigin = normalizeDeliveryContext(params.completionDirectOrigin);
    const completionChannelRaw =
      typeof completionDirectOrigin?.channel === "string"
        ? completionDirectOrigin.channel.trim()
        : "";
    const completionChannel =
      completionChannelRaw && isDeliverableMessageChannel(completionChannelRaw)
        ? completionChannelRaw
        : "";
    const completionTo =
      typeof completionDirectOrigin?.to === "string" ? completionDirectOrigin.to.trim() : "";
    const hasCompletionDirectTarget =
      !params.requesterIsSubagent && Boolean(completionChannel) && Boolean(completionTo);
    if (
      params.expectsCompletionMessage &&
      hasCompletionDirectTarget &&
      params.completionMessage?.trim()
    ) {
      const completionThreadId =
        completionDirectOrigin?.threadId != null && completionDirectOrigin.threadId !== ""
          ? String(completionDirectOrigin.threadId)
          : undefined;
      await callGateway({
        method: "send",
        params: {
          channel: completionChannel,
          to: completionTo,
          accountId: completionDirectOrigin?.accountId,
          threadId: completionThreadId,
          sessionKey: canonicalRequesterSessionKey,
          message: params.completionMessage,
          idempotencyKey: params.directIdempotencyKey,
        },
        timeoutMs: 15000,
      });
      return {
        delivered: true,
        path: "direct",
      };
    }
    const directOrigin = normalizeDeliveryContext(params.directOrigin);
    const threadId =
      directOrigin?.threadId != null && directOrigin.threadId !== ""
        ? String(directOrigin.threadId)
        : undefined;
    await callGateway({
      method: "agent",
      params: {
        sessionKey: canonicalRequesterSessionKey,
        message: params.triggerMessage,
        deliver: !params.requesterIsSubagent,
        channel: params.requesterIsSubagent ? undefined : directOrigin?.channel,
        accountId: params.requesterIsSubagent ? undefined : directOrigin?.accountId,
        to: params.requesterIsSubagent ? undefined : directOrigin?.to,
        threadId: params.requesterIsSubagent ? undefined : threadId,
        idempotencyKey: params.directIdempotencyKey,
      },
      expectFinal: true,
      timeoutMs: 15000,
    });
    return {
      delivered: true,
      path: "direct",
    };
  } catch (err) {
    return {
      delivered: false,
      path: "direct",
      error: summarizeDeliveryError(err),
    };
  }
}
async function deliverSubagentAnnouncement(params) {
  if (!params.expectsCompletionMessage) {
    const queueOutcome = await maybeQueueSubagentAnnounce({
      requesterSessionKey: params.requesterSessionKey,
      announceId: params.announceId,
      triggerMessage: params.triggerMessage,
      summaryLine: params.summaryLine,
      requesterOrigin: params.requesterOrigin,
    });
    const queued = queueOutcomeToDeliveryResult(queueOutcome);
    if (queued.delivered) {
      return queued;
    }
  }
  const direct = await sendSubagentAnnounceDirectly({
    targetRequesterSessionKey: params.targetRequesterSessionKey,
    triggerMessage: params.triggerMessage,
    completionMessage: params.completionMessage,
    directIdempotencyKey: params.directIdempotencyKey,
    completionDirectOrigin: params.completionDirectOrigin,
    directOrigin: params.directOrigin,
    requesterIsSubagent: params.requesterIsSubagent,
    expectsCompletionMessage: params.expectsCompletionMessage,
  });
  if (direct.delivered || !params.expectsCompletionMessage) {
    return direct;
  }
  const queueOutcome = await maybeQueueSubagentAnnounce({
    requesterSessionKey: params.requesterSessionKey,
    announceId: params.announceId,
    triggerMessage: params.triggerMessage,
    summaryLine: params.summaryLine,
    requesterOrigin: params.requesterOrigin,
  });
  if (queueOutcome === "steered" || queueOutcome === "queued") {
    return queueOutcomeToDeliveryResult(queueOutcome);
  }
  return direct;
}
export function buildSubagentSystemPrompt(params) {
  const taskText =
    typeof params.task === "string" && params.task.trim()
      ? params.task.replace(/\s+/g, " ").trim()
      : "{{TASK_DESCRIPTION}}";
  const childDepth = typeof params.childDepth === "number" ? params.childDepth : 1;
  const maxSpawnDepth = typeof params.maxSpawnDepth === "number" ? params.maxSpawnDepth : 1;
  const canSpawn = childDepth < maxSpawnDepth;
  const parentLabel = childDepth >= 2 ? "parent orchestrator" : "main agent";
  const lines = [
    "# Subagent Context",
    "",
    `You are a **subagent** spawned by the ${parentLabel} for a specific task.`,
    "",
    "## Your Role",
    `- You were created to handle: ${taskText}`,
    "- Complete this task. That's your entire purpose.",
    `- You are NOT the ${parentLabel}. Don't try to be.`,
    "",
    "## Rules",
    "1. **Stay focused** - Do your assigned task, nothing else",
    `2. **Complete the task** - Your final message will be automatically reported to the ${parentLabel}`,
    "3. **Don't initiate** - No heartbeats, no proactive actions, no side quests",
    "4. **Be ephemeral** - You may be terminated after task completion. That's fine.",
    "5. **Trust push-based completion** - Descendant results are auto-announced back to you; do not busy-poll for status.",
    "6. **Recover from compacted/truncated tool output** - If you see `[compacted: tool output removed to free context]` or `[truncated: output exceeded context limit]`, assume prior output was reduced. Re-read only what you need using smaller chunks (`read` with offset/limit, or targeted `rg`/`head`/`tail`) instead of full-file `cat`.",
    "",
    "## Output Format",
    "When complete, your final response should include:",
    `- What you accomplished or found`,
    `- Any relevant details the ${parentLabel} should know`,
    "- Keep it concise but informative",
    "",
    "## What You DON'T Do",
    `- NO user conversations (that's ${parentLabel}'s job)`,
    "- NO external messages (email, tweets, etc.) unless explicitly tasked with a specific recipient/channel",
    "- NO cron jobs or persistent state",
    `- NO pretending to be the ${parentLabel}`,
    `- Only use the \`message\` tool when explicitly instructed to contact a specific external recipient; otherwise return plain text and let the ${parentLabel} deliver it`,
    "",
  ];
  if (canSpawn) {
    lines.push(
      "## Sub-Agent Spawning",
      "You CAN spawn your own sub-agents for parallel or complex work using `sessions_spawn`.",
      "Use the `subagents` tool to steer, kill, or do an on-demand status check for your spawned sub-agents.",
      "Your sub-agents will announce their results back to you automatically (not to the main agent).",
      "Default workflow: spawn work, continue orchestrating, and wait for auto-announced completions.",
      "Do NOT repeatedly poll `subagents list` in a loop unless you are actively debugging or intervening.",
      "Coordinate their work and synthesize results before reporting back.",
      "",
      "### Session Lifecycle (keep parameter)",
      "When spawning, decide whether the session should persist:",
      "- `keep: true` — ongoing companion, identity, or long-lived relationship (you will send follow-ups later)",
      "- `keep: false` (default) — one-shot task, lookup, or transient work (auto-deleted on completion)",
      "Ask yourself: will I need this session again? If not, omit keep (defaults to auto-delete).",
      "",
    );
  } else if (childDepth >= 2) {
    lines.push(
      "## Sub-Agent Spawning",
      "You are a leaf worker and CANNOT spawn further sub-agents. Focus on your assigned task.",
      "",
    );
  }
  lines.push(
    "## Session Context",
    ...[
      params.label ? `- Label: ${params.label}` : undefined,
      params.requesterSessionKey
        ? `- Requester session: ${params.requesterSessionKey}.`
        : undefined,
      params.requesterOrigin?.channel
        ? `- Requester channel: ${params.requesterOrigin.channel}.`
        : undefined,
      `- Your session: ${params.childSessionKey}.`,
    ].filter((line) => line !== undefined),
    "",
  );
  return lines.join("\n");
}
export async function runSubagentAnnounceFlow(params) {
  let didAnnounce = false;
  const expectsCompletionMessage = params.expectsCompletionMessage === true;
  let shouldDeleteChildSession = params.cleanup === "delete";
  try {
    let targetRequesterSessionKey = params.requesterSessionKey;
    let targetRequesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
    const childSessionId = (() => {
      const entry = loadSessionEntryByKey(params.childSessionKey);
      return typeof entry?.sessionId === "string" && entry.sessionId.trim()
        ? entry.sessionId.trim()
        : undefined;
    })();
    const settleTimeoutMs = Math.min(Math.max(params.timeoutMs, 1), 120000);
    let reply = params.roundOneReply;
    let outcome = params.outcome;
    if (!expectsCompletionMessage && childSessionId && isEmbeddedPiRunActive(childSessionId)) {
      const settled = await waitForEmbeddedPiRunEnd(childSessionId, settleTimeoutMs);
      if (!settled && isEmbeddedPiRunActive(childSessionId)) {
        shouldDeleteChildSession = false;
        return false;
      }
    }
    if (!reply && params.waitForCompletion !== false) {
      const waitMs = settleTimeoutMs;
      const wait = await callGateway({
        method: "agent.wait",
        params: {
          runId: params.childRunId,
          timeoutMs: waitMs,
        },
        timeoutMs: waitMs + 2000,
      });
      const waitError = typeof wait?.error === "string" ? wait.error : undefined;
      if (wait?.status === "timeout") {
        outcome = { status: "timeout" };
      } else if (wait?.status === "error") {
        outcome = { status: "error", error: waitError };
      } else if (wait?.status === "ok") {
        outcome = { status: "ok" };
      }
      if (typeof wait?.startedAt === "number" && !params.startedAt) {
        params.startedAt = wait.startedAt;
      }
      if (typeof wait?.endedAt === "number" && !params.endedAt) {
        params.endedAt = wait.endedAt;
      }
      if (wait?.status === "timeout") {
        if (!outcome) {
          outcome = { status: "timeout" };
        }
      }
      reply = await readLatestSubagentOutput(params.childSessionKey);
    }
    if (!reply) {
      reply = await readLatestSubagentOutput(params.childSessionKey);
    }
    if (!reply?.trim()) {
      reply = await readLatestSubagentOutputWithRetry({
        sessionKey: params.childSessionKey,
        maxWaitMs: params.timeoutMs,
      });
    }
    if (
      !expectsCompletionMessage &&
      !reply?.trim() &&
      childSessionId &&
      isEmbeddedPiRunActive(childSessionId)
    ) {
      shouldDeleteChildSession = false;
      return false;
    }
    if (!outcome) {
      outcome = { status: "unknown" };
    }
    let activeChildDescendantRuns = 0;
    try {
      const { countActiveDescendantRuns } = await import("./subagent-registry.js");
      activeChildDescendantRuns = Math.max(0, countActiveDescendantRuns(params.childSessionKey));
    } catch {}
    if (!expectsCompletionMessage && activeChildDescendantRuns > 0) {
      shouldDeleteChildSession = false;
      return false;
    }
    const statusLabel =
      outcome.status === "ok"
        ? "completed successfully"
        : outcome.status === "timeout"
          ? "timed out"
          : outcome.status === "error"
            ? `failed: ${outcome.error || "unknown error"}`
            : "finished with unknown status";
    const announceType = params.announceType ?? "subagent task";
    const taskLabel = params.label || params.task || "task";
    const subagentName = resolveAgentIdFromSessionKey(params.childSessionKey);
    const announceSessionId = childSessionId || params.childSessionKey || "unknown";
    const findings = reply || "(no output)";
    let completionMessage = "";
    let triggerMessage = "";
    let requesterDepth = getSubagentDepthFromSessionStore(targetRequesterSessionKey);
    let requesterIsSubagent = !expectsCompletionMessage && requesterDepth >= 1;
    if (requesterIsSubagent) {
      const { isSubagentSessionRunActive, resolveRequesterForChildSession } =
        await import("./subagent-registry.js");
      if (!isSubagentSessionRunActive(targetRequesterSessionKey)) {
        const parentSessionEntry = loadSessionEntryByKey(targetRequesterSessionKey);
        const parentSessionAlive =
          parentSessionEntry &&
          typeof parentSessionEntry.sessionId === "string" &&
          parentSessionEntry.sessionId.trim();
        if (!parentSessionAlive) {
          const fallback = resolveRequesterForChildSession(targetRequesterSessionKey);
          if (!fallback?.requesterSessionKey) {
            shouldDeleteChildSession = false;
            return false;
          }
          targetRequesterSessionKey = fallback.requesterSessionKey;
          targetRequesterOrigin =
            normalizeDeliveryContext(fallback.requesterOrigin) ?? targetRequesterOrigin;
          requesterDepth = getSubagentDepthFromSessionStore(targetRequesterSessionKey);
          requesterIsSubagent = requesterDepth >= 1;
        }
      }
    }
    let remainingActiveSubagentRuns = 0;
    try {
      const { countActiveDescendantRuns } = await import("./subagent-registry.js");
      remainingActiveSubagentRuns = Math.max(
        0,
        countActiveDescendantRuns(targetRequesterSessionKey),
      );
    } catch {}
    const replyInstruction = buildAnnounceReplyInstruction({
      remainingActiveSubagentRuns,
      requesterIsSubagent,
      announceType,
      expectsCompletionMessage,
    });
    const statsLine = await buildCompactAnnounceStatsLine({
      sessionKey: params.childSessionKey,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
    });
    completionMessage = buildCompletionDeliveryMessage({
      findings,
      subagentName,
    });
    const internalSummaryMessage = [
      `[System Message] [sessionId: ${announceSessionId}] A ${announceType} "${taskLabel}" just ${statusLabel}.`,
      `[sessionKey: ${params.childSessionKey}]`,
      "",
      "Result:",
      findings,
      "",
      statsLine,
      "",
      `To continue this conversation, use sessions_send with sessionKey: "${params.childSessionKey}" or label: "${taskLabel}". Do NOT spawn a new session for follow-ups.`,
    ].join("\n");
    triggerMessage = [internalSummaryMessage, "", replyInstruction].join("\n");
    const announceId = buildAnnounceIdFromChildRun({
      childSessionKey: params.childSessionKey,
      childRunId: params.childRunId,
    });
    let directOrigin = targetRequesterOrigin;
    if (!requesterIsSubagent) {
      const { entry } = loadRequesterSessionEntry(targetRequesterSessionKey);
      directOrigin = resolveAnnounceOrigin(entry, targetRequesterOrigin);
    }
    const directIdempotencyKey = buildAnnounceIdempotencyKey(announceId);
    const delivery = await deliverSubagentAnnouncement({
      requesterSessionKey: targetRequesterSessionKey,
      announceId,
      triggerMessage,
      completionMessage,
      summaryLine: taskLabel,
      requesterOrigin: targetRequesterOrigin,
      completionDirectOrigin: targetRequesterOrigin,
      directOrigin,
      targetRequesterSessionKey,
      requesterIsSubagent,
      expectsCompletionMessage,
      directIdempotencyKey,
    });
    didAnnounce = delivery.delivered;
    if (!delivery.delivered && delivery.path === "direct" && delivery.error) {
      defaultRuntime.error?.(
        `Subagent completion direct announce failed for run ${params.childRunId}: ${delivery.error}`,
      );
    }
  } catch (err) {
    defaultRuntime.error?.(`Subagent announce failed: ${String(err)}`);
  } finally {
    if (params.label) {
      try {
        await callGateway({
          method: "sessions.patch",
          params: { key: params.childSessionKey, label: params.label },
          timeoutMs: 1e4,
        });
      } catch {}
    }
    if (shouldDeleteChildSession) {
      try {
        await callGateway({
          method: "sessions.delete",
          params: { key: params.childSessionKey, deleteTranscript: true },
          timeoutMs: 1e4,
        });
      } catch {}
    }
  }
  return didAnnounce;
}
