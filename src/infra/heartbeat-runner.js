let hasExplicitHeartbeatAgents = function (cfg) {
    const list = cfg.agents?.list ?? [];
    return list.some((entry) => Boolean(entry?.heartbeat));
  },
  resolveHeartbeatConfig = function (cfg, agentId) {
    const defaults = cfg.agents?.defaults?.heartbeat;
    if (!agentId) {
      return defaults;
    }
    const overrides = resolveAgentConfig(cfg, agentId)?.heartbeat;
    if (!defaults && !overrides) {
      return overrides;
    }
    return { ...defaults, ...overrides };
  },
  resolveHeartbeatAgents = function (cfg) {
    const list = cfg.agents?.list ?? [];
    if (hasExplicitHeartbeatAgents(cfg)) {
      return list
        .filter((entry) => entry?.heartbeat)
        .map((entry) => {
          const id = normalizeAgentId(entry.id);
          return { agentId: id, heartbeat: resolveHeartbeatConfig(cfg, id) };
        })
        .filter((entry) => entry.agentId);
    }
    const fallbackId = resolveDefaultAgentId(cfg);
    return [{ agentId: fallbackId, heartbeat: resolveHeartbeatConfig(cfg, fallbackId) }];
  },
  resolveHeartbeatAckMaxChars = function (cfg, heartbeat) {
    return Math.max(
      0,
      heartbeat?.ackMaxChars ??
        cfg.agents?.defaults?.heartbeat?.ackMaxChars ??
        DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
    );
  },
  resolveHeartbeatSession = function (cfg, agentId, heartbeat, forcedSessionKey) {
    const sessionCfg = cfg.session;
    const scope = sessionCfg?.scope ?? "per-sender";
    const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
    const mainSessionKey =
      scope === "global" ? "global" : resolveAgentMainSessionKey({ cfg, agentId: resolvedAgentId });
    const storeAgentId = scope === "global" ? resolveDefaultAgentId(cfg) : resolvedAgentId;
    const storePath = resolveStorePath(sessionCfg?.store, {
      agentId: storeAgentId,
    });
    const store = loadSessionStore(storePath);
    const mainEntry = store[mainSessionKey];
    if (scope === "global") {
      return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
    }
    const forced = forcedSessionKey?.trim();
    if (forced) {
      const forcedCandidate = toAgentStoreSessionKey({
        agentId: resolvedAgentId,
        requestKey: forced,
        mainKey: cfg.session?.mainKey,
      });
      const forcedCanonical = canonicalizeMainSessionAlias({
        cfg,
        agentId: resolvedAgentId,
        sessionKey: forcedCandidate,
      });
      if (forcedCanonical !== "global") {
        const sessionAgentId = resolveAgentIdFromSessionKey(forcedCanonical);
        if (sessionAgentId === normalizeAgentId(resolvedAgentId)) {
          return {
            sessionKey: forcedCanonical,
            storePath,
            store,
            entry: store[forcedCanonical],
          };
        }
      }
    }
    const trimmed = heartbeat?.session?.trim() ?? "";
    if (!trimmed) {
      return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === "main" || normalized === "global") {
      return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
    }
    const candidate = toAgentStoreSessionKey({
      agentId: resolvedAgentId,
      requestKey: trimmed,
      mainKey: cfg.session?.mainKey,
    });
    const canonical = canonicalizeMainSessionAlias({
      cfg,
      agentId: resolvedAgentId,
      sessionKey: candidate,
    });
    if (canonical !== "global") {
      const sessionAgentId = resolveAgentIdFromSessionKey(canonical);
      if (sessionAgentId === normalizeAgentId(resolvedAgentId)) {
        return {
          sessionKey: canonical,
          storePath,
          store,
          entry: store[canonical],
        };
      }
    }
    return { sessionKey: mainSessionKey, storePath, store, entry: mainEntry };
  },
  resolveHeartbeatReasoningPayloads = function (replyResult) {
    const payloads = Array.isArray(replyResult) ? replyResult : replyResult ? [replyResult] : [];
    return payloads.filter((payload) => {
      const text = typeof payload.text === "string" ? payload.text : "";
      return text.trimStart().startsWith("Reasoning:");
    });
  },
  stripLeadingHeartbeatResponsePrefix = function (text, responsePrefix) {
    const normalizedPrefix = responsePrefix?.trim();
    if (!normalizedPrefix) {
      return text;
    }
    const prefixPattern = new RegExp(
      `^${escapeRegExp(normalizedPrefix)}(?=$|\\s|[\\p{P}\\p{S}])\\s*`,
      "iu",
    );
    return text.replace(prefixPattern, "");
  },
  normalizeHeartbeatReply = function (payload, responsePrefix, ackMaxChars) {
    const rawText = typeof payload.text === "string" ? payload.text : "";
    const textForStrip = stripLeadingHeartbeatResponsePrefix(rawText, responsePrefix);
    const stripped = stripHeartbeatToken(textForStrip, {
      mode: "heartbeat",
      maxAckChars: ackMaxChars,
    });
    const hasMedia = Boolean(payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0);
    if (stripped.shouldSkip && !hasMedia) {
      return {
        shouldSkip: true,
        text: "",
        hasMedia,
      };
    }
    let finalText = stripped.text;
    if (responsePrefix && finalText && !finalText.startsWith(responsePrefix)) {
      finalText = `${responsePrefix} ${finalText}`;
    }
    return { shouldSkip: false, text: finalText, hasMedia };
  },
  resolveHeartbeatReasonFlags = function (reason) {
    const reasonKind = resolveHeartbeatReasonKind(reason);
    return {
      isExecEventReason: reasonKind === "exec-event",
      isCronEventReason: reasonKind === "cron",
      isWakeReason: reasonKind === "wake" || reasonKind === "hook",
    };
  };
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { appendCronStyleCurrentTimeLine } from "../agents/current-time.js";
import { resolveEffectiveMessagesConfig } from "../agents/identity.js";
import { DEFAULT_HEARTBEAT_FILENAME } from "../agents/workspace.js";
import { resolveHeartbeatReplyPayload } from "../auto-reply/heartbeat-reply-payload.js";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_EVERY,
  isHeartbeatContentEffectivelyEmpty,
  resolveHeartbeatPrompt as resolveHeartbeatPromptText,
  stripHeartbeatToken,
} from "../auto-reply/heartbeat.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import { HEARTBEAT_TOKEN } from "../auto-reply/tokens.js";
import { getChannelPlugin } from "../channels/plugins/index.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { loadConfig } from "../config/config.js";
import {
  canonicalizeMainSessionAlias,
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveAgentMainSessionKey,
  resolveSessionFilePath,
  resolveStorePath,
  saveSessionStore,
  updateSessionStore,
} from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getQueueSize } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";
import { normalizeAgentId, toAgentStoreSessionKey } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { escapeRegExp } from "../utils.js";
import { formatErrorMessage } from "./errors.js";
import { isWithinActiveHours } from "./heartbeat-active-hours.js";
import {
  buildCronEventPrompt,
  isCronSystemEvent,
  isExecCompletionEvent,
} from "./heartbeat-events-filter.js";
import { emitHeartbeatEvent, resolveIndicatorType } from "./heartbeat-events.js";
import { resolveHeartbeatReasonKind } from "./heartbeat-reason.js";
import { resolveHeartbeatVisibility } from "./heartbeat-visibility.js";
import { requestHeartbeatNow, setHeartbeatWakeHandler } from "./heartbeat-wake.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import {
  resolveHeartbeatDeliveryTarget,
  resolveHeartbeatSenderContext,
} from "./outbound/targets.js";
import { peekSystemEventEntries } from "./system-events.js";
const log = createSubsystemLogger("gateway/heartbeat");
let heartbeatsEnabled = true;
export function setHeartbeatsEnabled(enabled) {
  heartbeatsEnabled = enabled;
}
const DEFAULT_HEARTBEAT_TARGET = "last";
const EXEC_EVENT_PROMPT =
  "An async command you ran earlier has completed. The result is shown in the system messages above. Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. If it failed, explain what went wrong.";

export { isCronSystemEvent };
export function isHeartbeatEnabledForAgent(cfg, agentId) {
  const resolvedAgentId = normalizeAgentId(agentId ?? resolveDefaultAgentId(cfg));
  const list = cfg.agents?.list ?? [];
  const hasExplicit = hasExplicitHeartbeatAgents(cfg);
  if (hasExplicit) {
    return list.some(
      (entry) => Boolean(entry?.heartbeat) && normalizeAgentId(entry?.id) === resolvedAgentId,
    );
  }
  return resolvedAgentId === resolveDefaultAgentId(cfg);
}
export function resolveHeartbeatSummaryForAgent(cfg, agentId) {
  const defaults = cfg.agents?.defaults?.heartbeat;
  const overrides = agentId ? resolveAgentConfig(cfg, agentId)?.heartbeat : undefined;
  const enabled = isHeartbeatEnabledForAgent(cfg, agentId);
  if (!enabled) {
    return {
      enabled: false,
      every: "disabled",
      everyMs: null,
      prompt: resolveHeartbeatPromptText(defaults?.prompt),
      target: defaults?.target ?? DEFAULT_HEARTBEAT_TARGET,
      model: defaults?.model,
      ackMaxChars: Math.max(0, defaults?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS),
    };
  }
  const merged = defaults || overrides ? { ...defaults, ...overrides } : undefined;
  const every = merged?.every ?? defaults?.every ?? overrides?.every ?? DEFAULT_HEARTBEAT_EVERY;
  const everyMs = resolveHeartbeatIntervalMs(cfg, undefined, merged);
  const prompt = resolveHeartbeatPromptText(
    merged?.prompt ?? defaults?.prompt ?? overrides?.prompt,
  );
  const target =
    merged?.target ?? defaults?.target ?? overrides?.target ?? DEFAULT_HEARTBEAT_TARGET;
  const model = merged?.model ?? defaults?.model ?? overrides?.model;
  const ackMaxChars = Math.max(
    0,
    merged?.ackMaxChars ??
      defaults?.ackMaxChars ??
      overrides?.ackMaxChars ??
      DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );
  return {
    enabled: true,
    every,
    everyMs,
    prompt,
    target,
    model,
    ackMaxChars,
  };
}
export function resolveHeartbeatIntervalMs(cfg, overrideEvery, heartbeat) {
  const raw =
    overrideEvery ??
    heartbeat?.every ??
    cfg.agents?.defaults?.heartbeat?.every ??
    DEFAULT_HEARTBEAT_EVERY;
  if (!raw) {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }
  let ms;
  try {
    ms = parseDurationMs(trimmed, { defaultUnit: "m" });
  } catch {
    return null;
  }
  if (ms <= 0) {
    return null;
  }
  return ms;
}
export function resolveHeartbeatPrompt(cfg, heartbeat) {
  return resolveHeartbeatPromptText(heartbeat?.prompt ?? cfg.agents?.defaults?.heartbeat?.prompt);
}
async function restoreHeartbeatUpdatedAt(params) {
  const { storePath, sessionKey, updatedAt } = params;
  if (typeof updatedAt !== "number") {
    return;
  }
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) {
    return;
  }
  const nextUpdatedAt = Math.max(entry.updatedAt ?? 0, updatedAt);
  if (entry.updatedAt === nextUpdatedAt) {
    return;
  }
  await updateSessionStore(storePath, (nextStore) => {
    const nextEntry = nextStore[sessionKey] ?? entry;
    if (!nextEntry) {
      return;
    }
    const resolvedUpdatedAt = Math.max(nextEntry.updatedAt ?? 0, updatedAt);
    if (nextEntry.updatedAt === resolvedUpdatedAt) {
      return;
    }
    nextStore[sessionKey] = { ...nextEntry, updatedAt: resolvedUpdatedAt };
  });
}
async function pruneHeartbeatTranscript(params) {
  const { transcriptPath, preHeartbeatSize } = params;
  if (!transcriptPath || typeof preHeartbeatSize !== "number" || preHeartbeatSize < 0) {
    return;
  }
  try {
    const stat = await fs.stat(transcriptPath);
    if (stat.size > preHeartbeatSize) {
      await fs.truncate(transcriptPath, preHeartbeatSize);
    }
  } catch {}
}
async function captureTranscriptState(params) {
  const { storePath, sessionKey, agentId } = params;
  try {
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey];
    if (!entry?.sessionId) {
      return {};
    }
    const transcriptPath = resolveSessionFilePath(entry.sessionId, entry, {
      agentId,
      sessionsDir: path.dirname(storePath),
    });
    const stat = await fs.stat(transcriptPath);
    return { transcriptPath, preHeartbeatSize: stat.size };
  } catch {
    return {};
  }
}
async function resolveHeartbeatPreflight(params) {
  const reasonFlags = resolveHeartbeatReasonFlags(params.reason);
  const session = resolveHeartbeatSession(
    params.cfg,
    params.agentId,
    params.heartbeat,
    params.forcedSessionKey,
  );
  const pendingEventEntries = peekSystemEventEntries(session.sessionKey);
  const hasTaggedCronEvents = pendingEventEntries.some((event) =>
    event.contextKey?.startsWith("cron:"),
  );
  const shouldInspectPendingEvents =
    reasonFlags.isExecEventReason || reasonFlags.isCronEventReason || hasTaggedCronEvents;
  const shouldBypassFileGates =
    reasonFlags.isExecEventReason ||
    reasonFlags.isCronEventReason ||
    reasonFlags.isWakeReason ||
    hasTaggedCronEvents;
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const heartbeatFilePath = path.join(workspaceDir, DEFAULT_HEARTBEAT_FILENAME);
  try {
    const heartbeatFileContent = await fs.readFile(heartbeatFilePath, "utf-8");
    if (isHeartbeatContentEffectivelyEmpty(heartbeatFileContent) && !shouldBypassFileGates) {
      return {
        ...reasonFlags,
        session,
        pendingEventEntries,
        hasTaggedCronEvents,
        shouldInspectPendingEvents,
        skipReason: "empty-heartbeat-file",
      };
    }
  } catch (err) {
    if (err?.code === "ENOENT" && !shouldBypassFileGates) {
      return {
        ...reasonFlags,
        session,
        pendingEventEntries,
        hasTaggedCronEvents,
        shouldInspectPendingEvents,
        skipReason: "no-heartbeat-file",
      };
    }
  }
  return {
    ...reasonFlags,
    session,
    pendingEventEntries,
    hasTaggedCronEvents,
    shouldInspectPendingEvents,
  };
}
export async function runHeartbeatOnce(opts) {
  const cfg = opts.cfg ?? loadConfig();
  const agentId = normalizeAgentId(opts.agentId ?? resolveDefaultAgentId(cfg));
  const heartbeat = opts.heartbeat ?? resolveHeartbeatConfig(cfg, agentId);
  if (!heartbeatsEnabled) {
    return { status: "skipped", reason: "disabled" };
  }
  if (!isHeartbeatEnabledForAgent(cfg, agentId)) {
    return { status: "skipped", reason: "disabled" };
  }
  if (!resolveHeartbeatIntervalMs(cfg, undefined, heartbeat)) {
    return { status: "skipped", reason: "disabled" };
  }
  const startedAt = opts.deps?.nowMs?.() ?? Date.now();
  if (!isWithinActiveHours(cfg, heartbeat, startedAt)) {
    return { status: "skipped", reason: "quiet-hours" };
  }
  const queueSize = (opts.deps?.getQueueSize ?? getQueueSize)(CommandLane.Main);
  if (queueSize > 0) {
    return { status: "skipped", reason: "requests-in-flight" };
  }
  const preflight = await resolveHeartbeatPreflight({
    cfg,
    agentId,
    heartbeat,
    forcedSessionKey: opts.sessionKey,
    reason: opts.reason,
  });
  if (preflight.skipReason) {
    emitHeartbeatEvent({
      status: "skipped",
      reason: preflight.skipReason,
      durationMs: Date.now() - startedAt,
    });
    return { status: "skipped", reason: preflight.skipReason };
  }
  const { entry, sessionKey, storePath } = preflight.session;
  const { isCronEventReason, pendingEventEntries } = preflight;
  const previousUpdatedAt = entry?.updatedAt;
  const delivery = resolveHeartbeatDeliveryTarget({ cfg, entry, heartbeat });
  const heartbeatAccountId = heartbeat?.accountId?.trim();
  if (delivery.reason === "unknown-account") {
    log.warn("heartbeat: unknown accountId", {
      accountId: delivery.accountId ?? heartbeatAccountId ?? null,
      target: heartbeat?.target ?? "last",
    });
  } else if (heartbeatAccountId) {
    log.info("heartbeat: using explicit accountId", {
      accountId: delivery.accountId ?? heartbeatAccountId,
      target: heartbeat?.target ?? "last",
      channel: delivery.channel,
    });
  }
  const visibility =
    delivery.channel !== "none"
      ? resolveHeartbeatVisibility({
          cfg,
          channel: delivery.channel,
          accountId: delivery.accountId,
        })
      : { showOk: false, showAlerts: true, useIndicator: true };
  const { sender } = resolveHeartbeatSenderContext({ cfg, entry, delivery });
  const responsePrefix = resolveEffectiveMessagesConfig(cfg, agentId, {
    channel: delivery.channel !== "none" ? delivery.channel : undefined,
    accountId: delivery.accountId,
  }).responsePrefix;
  const shouldInspectPendingEvents = preflight.shouldInspectPendingEvents;
  const pendingEvents = shouldInspectPendingEvents
    ? pendingEventEntries.map((event) => event.text)
    : [];
  const cronEvents = pendingEventEntries
    .filter(
      (event) =>
        (isCronEventReason || event.contextKey?.startsWith("cron:")) &&
        isCronSystemEvent(event.text),
    )
    .map((event) => event.text);
  const hasExecCompletion = pendingEvents.some(isExecCompletionEvent);
  const hasCronEvents = cronEvents.length > 0;
  const prompt = hasExecCompletion
    ? EXEC_EVENT_PROMPT
    : hasCronEvents
      ? buildCronEventPrompt(cronEvents)
      : resolveHeartbeatPrompt(cfg, heartbeat);
  const isOwnSession = sessionKey !== resolveAgentMainSessionKey({ cfg, agentId });
  const heartbeatSender = isOwnSession ? "heartbeat" : sender;
  const ctx = {
    Body: appendCronStyleCurrentTimeLine(prompt, cfg, startedAt),
    From: heartbeatSender,
    To: heartbeatSender,
    Provider: hasExecCompletion ? "exec-event" : hasCronEvents ? "cron-event" : "heartbeat",
    SessionKey: sessionKey,
  };
  if (!visibility.showAlerts && !visibility.showOk && !visibility.useIndicator) {
    emitHeartbeatEvent({
      status: "skipped",
      reason: "alerts-disabled",
      durationMs: Date.now() - startedAt,
      channel: delivery.channel !== "none" ? delivery.channel : undefined,
      accountId: delivery.accountId,
    });
    return { status: "skipped", reason: "alerts-disabled" };
  }
  const heartbeatOkText = responsePrefix ? `${responsePrefix} ${HEARTBEAT_TOKEN}` : HEARTBEAT_TOKEN;
  const canAttemptHeartbeatOk = Boolean(
    visibility.showOk && delivery.channel !== "none" && delivery.to,
  );
  const maybeSendHeartbeatOk = async () => {
    if (!canAttemptHeartbeatOk || delivery.channel === "none" || !delivery.to) {
      return false;
    }
    const heartbeatPlugin = getChannelPlugin(delivery.channel);
    if (heartbeatPlugin?.heartbeat?.checkReady) {
      const readiness = await heartbeatPlugin.heartbeat.checkReady({
        cfg,
        accountId: delivery.accountId,
        deps: opts.deps,
      });
      if (!readiness.ok) {
        return false;
      }
    }
    await deliverOutboundPayloads({
      cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: delivery.accountId,
      threadId: delivery.threadId,
      payloads: [{ text: heartbeatOkText }],
      agentId,
      deps: opts.deps,
    });
    return true;
  };
  try {
    const transcriptState = await captureTranscriptState({
      storePath,
      sessionKey,
      agentId,
    });
    const heartbeatModelOverride = heartbeat?.model?.trim() || undefined;
    const suppressToolErrorWarnings = heartbeat?.suppressToolErrorWarnings === true;
    const replyOpts = heartbeatModelOverride
      ? { isHeartbeat: true, heartbeatModelOverride, suppressToolErrorWarnings }
      : { isHeartbeat: true, suppressToolErrorWarnings };
    const replyResult = await getReplyFromConfig(ctx, replyOpts, cfg);
    if (isOwnSession) {
      updateSessionStore(storePath, sessionKey, (current) => ({
        ...current,
        displayName: "Heartbeat",
        label: "Heartbeat",
      })).catch(() => {});
    }
    const replyPayload = resolveHeartbeatReplyPayload(replyResult);
    const includeReasoning = heartbeat?.includeReasoning === true;
    const reasoningPayloads = includeReasoning
      ? resolveHeartbeatReasoningPayloads(replyResult).filter((payload) => payload !== replyPayload)
      : [];
    if (
      !replyPayload ||
      (!replyPayload.text && !replyPayload.mediaUrl && !replyPayload.mediaUrls?.length)
    ) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      if (!isOwnSession) {
        await pruneHeartbeatTranscript(transcriptState);
      }
      const okSent = await maybeSendHeartbeatOk();
      emitHeartbeatEvent({
        status: "ok-empty",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
        silent: !okSent,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("ok-empty") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }
    const ackMaxChars = resolveHeartbeatAckMaxChars(cfg, heartbeat);
    const normalized = normalizeHeartbeatReply(replyPayload, responsePrefix, ackMaxChars);
    const execFallbackText =
      hasExecCompletion && !normalized.text.trim() && replyPayload.text?.trim()
        ? replyPayload.text.trim()
        : null;
    if (execFallbackText) {
      normalized.text = execFallbackText;
      normalized.shouldSkip = false;
    }
    const shouldSkipMain = normalized.shouldSkip && !normalized.hasMedia && !hasExecCompletion;
    if (shouldSkipMain && reasoningPayloads.length === 0) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      if (!isOwnSession) {
        await pruneHeartbeatTranscript(transcriptState);
      }
      const okSent = await maybeSendHeartbeatOk();
      emitHeartbeatEvent({
        status: "ok-token",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
        silent: !okSent,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("ok-token") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }
    const mediaUrls =
      replyPayload.mediaUrls ?? (replyPayload.mediaUrl ? [replyPayload.mediaUrl] : []);
    const prevHeartbeatText =
      typeof entry?.lastHeartbeatText === "string" ? entry.lastHeartbeatText : "";
    const prevHeartbeatAt =
      typeof entry?.lastHeartbeatSentAt === "number" ? entry.lastHeartbeatSentAt : undefined;
    const isDuplicateMain =
      !shouldSkipMain &&
      !mediaUrls.length &&
      Boolean(prevHeartbeatText.trim()) &&
      normalized.text.trim() === prevHeartbeatText.trim() &&
      typeof prevHeartbeatAt === "number" &&
      startedAt - prevHeartbeatAt < 86400000;
    if (isDuplicateMain) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      if (!isOwnSession) {
        await pruneHeartbeatTranscript(transcriptState);
      }
      emitHeartbeatEvent({
        status: "skipped",
        reason: "duplicate",
        preview: normalized.text.slice(0, 200),
        durationMs: Date.now() - startedAt,
        hasMedia: false,
        channel: delivery.channel !== "none" ? delivery.channel : undefined,
        accountId: delivery.accountId,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }
    const previewText = shouldSkipMain
      ? reasoningPayloads
          .map((payload) => payload.text)
          .filter((text) => Boolean(text?.trim()))
          .join("\n")
      : normalized.text;
    if (delivery.channel === "none" || !delivery.to) {
      const skipReason = delivery.reason ?? "no-target";
      log.info(`heartbeat: delivery skipped (${skipReason})`);
      emitHeartbeatEvent({
        status: "skipped",
        reason: skipReason,
        preview: previewText?.slice(0, 200),
        durationMs: Date.now() - startedAt,
        hasMedia: mediaUrls.length > 0,
        accountId: delivery.accountId,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }
    if (!visibility.showAlerts) {
      log.info("heartbeat: delivery skipped (alerts-disabled)");
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      emitHeartbeatEvent({
        status: "skipped",
        reason: "alerts-disabled",
        preview: previewText?.slice(0, 200),
        durationMs: Date.now() - startedAt,
        channel: delivery.channel,
        hasMedia: mediaUrls.length > 0,
        accountId: delivery.accountId,
        indicatorType: visibility.useIndicator ? resolveIndicatorType("sent") : undefined,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }
    const deliveryAccountId = delivery.accountId;
    const heartbeatPlugin = getChannelPlugin(delivery.channel);
    if (heartbeatPlugin?.heartbeat?.checkReady) {
      const readiness = await heartbeatPlugin.heartbeat.checkReady({
        cfg,
        accountId: deliveryAccountId,
        deps: opts.deps,
      });
      if (!readiness.ok) {
        emitHeartbeatEvent({
          status: "skipped",
          reason: readiness.reason,
          preview: previewText?.slice(0, 200),
          durationMs: Date.now() - startedAt,
          hasMedia: mediaUrls.length > 0,
          channel: delivery.channel,
          accountId: delivery.accountId,
        });
        log.info("heartbeat: channel not ready", {
          channel: delivery.channel,
          reason: readiness.reason,
        });
        return { status: "skipped", reason: readiness.reason };
      }
    }
    await deliverOutboundPayloads({
      cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: deliveryAccountId,
      agentId,
      threadId: delivery.threadId,
      payloads: [
        ...reasoningPayloads,
        ...(shouldSkipMain
          ? []
          : [
              {
                text: normalized.text,
                mediaUrls,
              },
            ]),
      ],
      deps: opts.deps,
    });
    if (!shouldSkipMain && normalized.text.trim()) {
      const store = loadSessionStore(storePath);
      const current = store[sessionKey];
      if (current) {
        store[sessionKey] = {
          ...current,
          lastHeartbeatText: normalized.text,
          lastHeartbeatSentAt: startedAt,
        };
        await saveSessionStore(storePath, store);
      }
    }
    emitHeartbeatEvent({
      status: "sent",
      to: delivery.to,
      preview: previewText?.slice(0, 200),
      durationMs: Date.now() - startedAt,
      hasMedia: mediaUrls.length > 0,
      channel: delivery.channel,
      accountId: delivery.accountId,
      indicatorType: visibility.useIndicator ? resolveIndicatorType("sent") : undefined,
    });
    return { status: "ran", durationMs: Date.now() - startedAt };
  } catch (err) {
    const reason = formatErrorMessage(err);
    emitHeartbeatEvent({
      status: "failed",
      reason,
      durationMs: Date.now() - startedAt,
      channel: delivery.channel !== "none" ? delivery.channel : undefined,
      accountId: delivery.accountId,
      indicatorType: visibility.useIndicator ? resolveIndicatorType("failed") : undefined,
    });
    log.error(`heartbeat failed: ${reason}`, { error: reason });
    return { status: "failed", reason };
  }
}
export function startHeartbeatRunner(opts) {
  const runtime = opts.runtime ?? defaultRuntime;
  const runOnce = opts.runOnce ?? runHeartbeatOnce;
  const state = {
    cfg: opts.cfg ?? loadConfig(),
    runtime,
    agents: new Map(),
    timer: null,
    stopped: false,
  };
  let initialized = false;
  const resolveNextDue = (now, intervalMs, prevState) => {
    if (typeof prevState?.lastRunMs === "number") {
      return prevState.lastRunMs + intervalMs;
    }
    if (prevState && prevState.intervalMs === intervalMs && prevState.nextDueMs > now) {
      return prevState.nextDueMs;
    }
    return now + intervalMs;
  };
  const advanceAgentSchedule = (agent, now) => {
    agent.lastRunMs = now;
    agent.nextDueMs = now + agent.intervalMs;
  };
  const scheduleNext = () => {
    if (state.stopped) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.agents.size === 0) {
      return;
    }
    const now = Date.now();
    let nextDue = Number.POSITIVE_INFINITY;
    for (const agent of state.agents.values()) {
      if (agent.nextDueMs < nextDue) {
        nextDue = agent.nextDueMs;
      }
    }
    if (!Number.isFinite(nextDue)) {
      return;
    }
    const delay = Math.max(0, nextDue - now);
    state.timer = setTimeout(() => {
      state.timer = null;
      requestHeartbeatNow({ reason: "interval", coalesceMs: 0 });
    }, delay);
    state.timer.unref?.();
  };
  const updateConfig = (cfg) => {
    if (state.stopped) {
      return;
    }
    const now = Date.now();
    const prevAgents = state.agents;
    const prevEnabled = prevAgents.size > 0;
    const nextAgents = new Map();
    const intervals = [];
    for (const agent of resolveHeartbeatAgents(cfg)) {
      const intervalMs = resolveHeartbeatIntervalMs(cfg, undefined, agent.heartbeat);
      if (!intervalMs) {
        continue;
      }
      intervals.push(intervalMs);
      const prevState = prevAgents.get(agent.agentId);
      const nextDueMs = resolveNextDue(now, intervalMs, prevState);
      nextAgents.set(agent.agentId, {
        agentId: agent.agentId,
        heartbeat: agent.heartbeat,
        intervalMs,
        lastRunMs: prevState?.lastRunMs,
        nextDueMs,
      });
    }
    state.cfg = cfg;
    state.agents = nextAgents;
    const nextEnabled = nextAgents.size > 0;
    const formatStartedMsg = () => {
      const secs = Math.round(Math.min(...intervals) / 1000);
      let msg = `heartbeat: started (interval: ${secs}s)`;
      const ah = cfg.agents?.defaults?.heartbeat?.activeHours;
      if (ah?.start && ah?.end) {
        msg += `, active: ${ah.start}–${ah.end}${ah.timezone ? ` ${ah.timezone}` : ""}`;
      }
      return msg;
    };
    if (!initialized) {
      if (!nextEnabled) {
        log.info("heartbeat: disabled", { enabled: false });
      } else {
        log.info(formatStartedMsg());
      }
      initialized = true;
    } else if (prevEnabled !== nextEnabled) {
      if (!nextEnabled) {
        log.info("heartbeat: disabled", { enabled: false });
      } else {
        log.info(formatStartedMsg());
      }
    }
    scheduleNext();
  };
  const run = async (params) => {
    if (state.stopped) {
      return {
        status: "skipped",
        reason: "disabled",
      };
    }
    if (!heartbeatsEnabled) {
      return {
        status: "skipped",
        reason: "disabled",
      };
    }
    if (state.agents.size === 0) {
      return {
        status: "skipped",
        reason: "disabled",
      };
    }
    const reason = params?.reason ?? "unknown";
    const requestedAgentId = params?.agentId ? normalizeAgentId(params.agentId) : undefined;
    const requestedSessionKey = params?.sessionKey?.trim() || undefined;
    const isInterval = reason === "interval";
    const startedAt = Date.now();
    log.info(`heartbeat: running (reason: ${reason})`);
    const now = startedAt;
    let ran = false;
    if (requestedSessionKey || requestedAgentId) {
      const targetAgentId = requestedAgentId ?? resolveAgentIdFromSessionKey(requestedSessionKey);
      const targetAgent = state.agents.get(targetAgentId);
      if (!targetAgent) {
        scheduleNext();
        return { status: "skipped", reason: "disabled" };
      }
      try {
        const res = await runOnce({
          cfg: state.cfg,
          agentId: targetAgent.agentId,
          heartbeat: targetAgent.heartbeat,
          reason,
          sessionKey: requestedSessionKey,
          deps: { runtime: state.runtime },
        });
        if (res.status !== "skipped" || res.reason !== "disabled") {
          advanceAgentSchedule(targetAgent, now);
        }
        scheduleNext();
        const elapsed = Date.now() - startedAt;
        if (res.status === "ran") {
          log.info(`heartbeat: completed (${elapsed}ms)`);
          return { status: "ran", durationMs: elapsed };
        }
        log.info(`heartbeat: skipped (${res.reason}, ${elapsed}ms)`);
        return res;
      } catch (err) {
        const errMsg = formatErrorMessage(err);
        log.error(`heartbeat runner: targeted runOnce threw unexpectedly: ${errMsg}`, {
          error: errMsg,
        });
        advanceAgentSchedule(targetAgent, now);
        scheduleNext();
        return { status: "failed", reason: errMsg };
      }
    }
    for (const agent of state.agents.values()) {
      if (isInterval && now < agent.nextDueMs) {
        continue;
      }
      let res;
      try {
        res = await runOnce({
          cfg: state.cfg,
          agentId: agent.agentId,
          heartbeat: agent.heartbeat,
          reason,
          deps: { runtime: state.runtime },
        });
      } catch (err) {
        const errMsg = formatErrorMessage(err);
        log.error(`heartbeat runner: runOnce threw unexpectedly: ${errMsg}`, { error: errMsg });
        advanceAgentSchedule(agent, now);
        continue;
      }
      if (res.status === "skipped" && res.reason === "requests-in-flight") {
        advanceAgentSchedule(agent, now);
        scheduleNext();
        return res;
      }
      if (res.status !== "skipped" || res.reason !== "disabled") {
        advanceAgentSchedule(agent, now);
      }
      if (res.status === "ran") {
        ran = true;
      }
    }
    scheduleNext();
    const elapsed = Date.now() - startedAt;
    if (ran) {
      log.info(`heartbeat: completed (${elapsed}ms)`);
      return { status: "ran", durationMs: elapsed };
    }
    const skipReason = isInterval ? "not-due" : "disabled";
    log.info(`heartbeat: skipped (${skipReason}, ${elapsed}ms)`);
    return { status: "skipped", reason: skipReason };
  };
  const wakeHandler = async (params) =>
    run({
      reason: params.reason,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
    });
  const disposeWakeHandler = setHeartbeatWakeHandler(wakeHandler);
  updateConfig(state.cfg);
  const cleanup = () => {
    if (state.stopped) {
      return;
    }
    state.stopped = true;
    disposeWakeHandler();
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = null;
  };
  opts.abortSignal?.addEventListener("abort", cleanup, { once: true });
  return { stop: cleanup, updateConfig };
}
