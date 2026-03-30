let normalizeNonEmptyString = function (value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  normalizeFiniteInteger = function (value) {
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
  },
  resolveVoiceTranscriptFingerprint = function (obj, text) {
    const eventId =
      normalizeNonEmptyString(obj.eventId) ??
      normalizeNonEmptyString(obj.providerEventId) ??
      normalizeNonEmptyString(obj.transcriptId);
    if (eventId) {
      return `event:${eventId}`;
    }
    const callId =
      normalizeNonEmptyString(obj.providerCallId) ?? normalizeNonEmptyString(obj.callId);
    const sequence = normalizeFiniteInteger(obj.sequence) ?? normalizeFiniteInteger(obj.seq);
    if (callId && sequence !== null) {
      return `call-seq:${callId}:${sequence}`;
    }
    const eventTimestamp =
      normalizeFiniteInteger(obj.timestamp) ??
      normalizeFiniteInteger(obj.ts) ??
      normalizeFiniteInteger(obj.eventTimestamp);
    if (callId && eventTimestamp !== null) {
      return `call-ts:${callId}:${eventTimestamp}`;
    }
    if (eventTimestamp !== null) {
      return `timestamp:${eventTimestamp}|text:${text}`;
    }
    return `text:${text}`;
  },
  shouldDropDuplicateVoiceTranscript = function (params) {
    const previous = recentVoiceTranscripts.get(params.sessionKey);
    if (
      previous &&
      previous.fingerprint === params.fingerprint &&
      params.now - previous.ts <= VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS
    ) {
      return true;
    }
    recentVoiceTranscripts.set(params.sessionKey, {
      fingerprint: params.fingerprint,
      ts: params.now,
    });
    if (recentVoiceTranscripts.size > MAX_RECENT_VOICE_TRANSCRIPTS) {
      const cutoff = params.now - VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS * 2;
      for (const [key, value] of recentVoiceTranscripts) {
        if (value.ts < cutoff) {
          recentVoiceTranscripts.delete(key);
        }
        if (recentVoiceTranscripts.size <= MAX_RECENT_VOICE_TRANSCRIPTS) {
          break;
        }
      }
      while (recentVoiceTranscripts.size > MAX_RECENT_VOICE_TRANSCRIPTS) {
        const oldestKey = recentVoiceTranscripts.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        recentVoiceTranscripts.delete(oldestKey);
      }
    }
    return false;
  },
  compactExecEventOutput = function (raw) {
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    if (normalized.length <= MAX_EXEC_EVENT_OUTPUT_CHARS) {
      return normalized;
    }
    const safe = Math.max(1, MAX_EXEC_EVENT_OUTPUT_CHARS - 1);
    return `${normalized.slice(0, safe)}\u2026`;
  },
  queueSessionStoreTouch = function (params) {
    touchSessionStore({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
      storePath: params.storePath,
      canonicalKey: params.canonicalKey,
      entry: params.entry,
      sessionId: params.sessionId,
      now: params.now,
    }).catch((err) => {
      params.ctx.logGateway.warn("voice session-store update failed: " + formatForLog(err));
    });
  },
  parseSessionKeyFromPayloadJSON = function (payloadJSON) {
    let payload;
    try {
      payload = JSON.parse(payloadJSON);
    } catch {
      return null;
    }
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const obj = payload;
    const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
    return sessionKey.length > 0 ? sessionKey : null;
  };
import { randomUUID } from "node:crypto";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { normalizeChannelId } from "../channels/plugins/index.js";
import { createOutboundSendDeps } from "../cli/outbound-send-deps.js";
import { agentCommand } from "../commands/agent.js";
import { loadConfig } from "../config/config.js";
import { updateSessionStore } from "../config/sessions.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { resolveOutboundTarget } from "../infra/outbound/targets.js";
import { registerApnsToken } from "../infra/push-apns.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { normalizeMainKey } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { parseMessageWithAttachments } from "./chat-attachments.js";
import { normalizeRpcAttachmentsToChatAttachments } from "./server-methods/attachment-normalize.js";
import {
  loadSessionEntry,
  pruneLegacyStoreKeys,
  resolveGatewaySessionStoreTarget,
} from "./session-utils.js";
import { formatForLog } from "./ws-log.js";
const MAX_EXEC_EVENT_OUTPUT_CHARS = 180;
const VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS = 1500;
const MAX_RECENT_VOICE_TRANSCRIPTS = 200;
const recentVoiceTranscripts = new Map();
async function touchSessionStore(params) {
  const { storePath } = params;
  if (!storePath) {
    return;
  }
  await updateSessionStore(storePath, (store) => {
    const target = resolveGatewaySessionStoreTarget({
      cfg: params.cfg,
      key: params.sessionKey,
      store,
    });
    pruneLegacyStoreKeys({
      store,
      canonicalKey: target.canonicalKey,
      candidates: target.storeKeys,
    });
    store[params.canonicalKey] = {
      sessionId: params.sessionId,
      updatedAt: params.now,
      thinkingLevel: params.entry?.thinkingLevel,
      verboseLevel: params.entry?.verboseLevel,
      reasoningLevel: params.entry?.reasoningLevel,
      systemSent: params.entry?.systemSent,
      sendPolicy: params.entry?.sendPolicy,
      lastChannel: params.entry?.lastChannel,
      lastTo: params.entry?.lastTo,
    };
  });
}
async function sendReceiptAck(params) {
  const resolved = resolveOutboundTarget({
    channel: params.channel,
    to: params.to,
    cfg: params.cfg,
    mode: "explicit",
  });
  if (!resolved.ok) {
    throw new Error(String(resolved.error));
  }
  const agentId = resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg });
  await deliverOutboundPayloads({
    cfg: params.cfg,
    channel: params.channel,
    to: resolved.to,
    payloads: [{ text: params.text }],
    agentId,
    bestEffort: true,
    deps: createOutboundSendDeps(params.deps),
  });
}
export const handleNodeEvent = async (ctx, nodeId, evt) => {
  switch (evt.event) {
    case "voice.transcript": {
      if (!evt.payloadJSON) {
        return;
      }
      let payload;
      try {
        payload = JSON.parse(evt.payloadJSON);
      } catch {
        return;
      }
      const obj = typeof payload === "object" && payload !== null ? payload : {};
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text) {
        return;
      }
      if (text.length > 20000) {
        return;
      }
      const sessionKeyRaw = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
      const cfg = loadConfig();
      const rawMainKey = normalizeMainKey(cfg.session?.mainKey);
      const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : rawMainKey;
      const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
      const now = Date.now();
      const fingerprint = resolveVoiceTranscriptFingerprint(obj, text);
      if (shouldDropDuplicateVoiceTranscript({ sessionKey: canonicalKey, fingerprint, now })) {
        return;
      }
      const sessionId = entry?.sessionId ?? randomUUID();
      queueSessionStoreTouch({
        ctx,
        cfg,
        sessionKey,
        storePath,
        canonicalKey,
        entry,
        sessionId,
        now,
      });
      ctx.addChatRun(sessionId, {
        sessionKey: canonicalKey,
        clientRunId: `voice-${randomUUID()}`,
      });
      agentCommand(
        {
          message: text,
          sessionId,
          sessionKey: canonicalKey,
          thinking: "low",
          deliver: false,
          messageChannel: "node",
          inputProvenance: {
            kind: "external_user",
            sourceChannel: "voice",
            sourceTool: "gateway.voice.transcript",
          },
        },
        defaultRuntime,
        ctx.deps,
      ).catch((err) => {
        ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
      });
      return;
    }
    case "agent.request": {
      if (!evt.payloadJSON) {
        return;
      }
      let link = null;
      try {
        link = JSON.parse(evt.payloadJSON);
      } catch {
        return;
      }
      let message = (link?.message ?? "").trim();
      const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(
        link?.attachments ?? undefined,
      );
      let images = [];
      if (normalizedAttachments.length > 0) {
        try {
          const parsed = await parseMessageWithAttachments(message, normalizedAttachments, {
            maxBytes: 5000000,
            log: ctx.logGateway,
          });
          message = parsed.message.trim();
          images = parsed.images;
        } catch {
          return;
        }
      }
      if (!message) {
        return;
      }
      if (message.length > 20000) {
        return;
      }
      const channelRaw = typeof link?.channel === "string" ? link.channel.trim() : "";
      let channel = normalizeChannelId(channelRaw) ?? undefined;
      let to = typeof link?.to === "string" && link.to.trim() ? link.to.trim() : undefined;
      const deliverRequested = Boolean(link?.deliver);
      const wantsReceipt = Boolean(link?.receipt);
      const receiptTextRaw = typeof link?.receiptText === "string" ? link.receiptText.trim() : "";
      const receiptText =
        receiptTextRaw || "Just received your iOS share + request, working on it.";
      const sessionKeyRaw = (link?.sessionKey ?? "").trim();
      const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : `node-${nodeId}`;
      const cfg = loadConfig();
      const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
      const now = Date.now();
      const sessionId = entry?.sessionId ?? randomUUID();
      await touchSessionStore({ cfg, sessionKey, storePath, canonicalKey, entry, sessionId, now });
      if (deliverRequested && (!channel || !to)) {
        const entryChannel =
          typeof entry?.lastChannel === "string"
            ? normalizeChannelId(entry.lastChannel)
            : undefined;
        const entryTo = typeof entry?.lastTo === "string" ? entry.lastTo.trim() : "";
        if (!channel && entryChannel) {
          channel = entryChannel;
        }
        if (!to && entryTo) {
          to = entryTo;
        }
      }
      const deliver = deliverRequested && Boolean(channel && to);
      const deliveryChannel = deliver ? channel : undefined;
      const deliveryTo = deliver ? to : undefined;
      if (deliverRequested && !deliver) {
        ctx.logGateway.warn(
          `agent delivery disabled node=${nodeId}: missing session delivery route (channel=${channel ?? "-"} to=${to ?? "-"})`,
        );
      }
      if (wantsReceipt && deliveryChannel && deliveryTo) {
        sendReceiptAck({
          cfg,
          deps: ctx.deps,
          sessionKey: canonicalKey,
          channel: deliveryChannel,
          to: deliveryTo,
          text: receiptText,
        }).catch((err) => {
          ctx.logGateway.warn(`agent receipt failed node=${nodeId}: ${formatForLog(err)}`);
        });
      } else if (wantsReceipt) {
        ctx.logGateway.warn(
          `agent receipt skipped node=${nodeId}: missing delivery route (channel=${deliveryChannel ?? "-"} to=${deliveryTo ?? "-"})`,
        );
      }
      agentCommand(
        {
          message,
          images,
          sessionId,
          sessionKey: canonicalKey,
          thinking: link?.thinking ?? undefined,
          deliver,
          to: deliveryTo,
          channel: deliveryChannel,
          timeout:
            typeof link?.timeoutSeconds === "number" ? link.timeoutSeconds.toString() : undefined,
          messageChannel: "node",
        },
        defaultRuntime,
        ctx.deps,
      ).catch((err) => {
        ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
      });
      return;
    }
    case "chat.subscribe": {
      if (!evt.payloadJSON) {
        return;
      }
      const sessionKey = parseSessionKeyFromPayloadJSON(evt.payloadJSON);
      if (!sessionKey) {
        return;
      }
      ctx.nodeSubscribe(nodeId, sessionKey);
      return;
    }
    case "chat.unsubscribe": {
      if (!evt.payloadJSON) {
        return;
      }
      const sessionKey = parseSessionKeyFromPayloadJSON(evt.payloadJSON);
      if (!sessionKey) {
        return;
      }
      ctx.nodeUnsubscribe(nodeId, sessionKey);
      return;
    }
    case "exec.started":
    case "exec.finished":
    case "exec.denied": {
      if (!evt.payloadJSON) {
        return;
      }
      let payload;
      try {
        payload = JSON.parse(evt.payloadJSON);
      } catch {
        return;
      }
      const obj = typeof payload === "object" && payload !== null ? payload : {};
      const sessionKey =
        typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : `node-${nodeId}`;
      if (!sessionKey) {
        return;
      }
      const runId = typeof obj.runId === "string" ? obj.runId.trim() : "";
      const command = typeof obj.command === "string" ? obj.command.trim() : "";
      const exitCode =
        typeof obj.exitCode === "number" && Number.isFinite(obj.exitCode)
          ? obj.exitCode
          : undefined;
      const timedOut = obj.timedOut === true;
      const output = typeof obj.output === "string" ? obj.output.trim() : "";
      const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
      let text = "";
      if (evt.event === "exec.started") {
        text = `Exec started (node=${nodeId}${runId ? ` id=${runId}` : ""})`;
        if (command) {
          text += `: ${command}`;
        }
      } else if (evt.event === "exec.finished") {
        const exitLabel = timedOut ? "timeout" : `code ${exitCode ?? "?"}`;
        const compactOutput = compactExecEventOutput(output);
        const shouldNotify = timedOut || exitCode !== 0 || compactOutput.length > 0;
        if (!shouldNotify) {
          return;
        }
        text = `Exec finished (node=${nodeId}${runId ? ` id=${runId}` : ""}, ${exitLabel})`;
        if (compactOutput) {
          text += `\n${compactOutput}`;
        }
      } else {
        text = `Exec denied (node=${nodeId}${runId ? ` id=${runId}` : ""}${reason ? `, ${reason}` : ""})`;
        if (command) {
          text += `: ${command}`;
        }
      }
      enqueueSystemEvent(text, { sessionKey, contextKey: runId ? `exec:${runId}` : "exec" });
      requestHeartbeatNow({ reason: "exec-event" });
      return;
    }
    case "push.apns.register": {
      if (!evt.payloadJSON) {
        return;
      }
      let payload;
      try {
        payload = JSON.parse(evt.payloadJSON);
      } catch {
        return;
      }
      const obj = typeof payload === "object" && payload !== null ? payload : {};
      const token = typeof obj.token === "string" ? obj.token : "";
      const topic = typeof obj.topic === "string" ? obj.topic : "";
      const environment = obj.environment;
      try {
        await registerApnsToken({
          nodeId,
          token,
          topic,
          environment,
        });
      } catch (err) {
        ctx.logGateway.warn(`push apns register failed node=${nodeId}: ${formatForLog(err)}`);
      }
      return;
    }
    default:
      return;
  }
};
