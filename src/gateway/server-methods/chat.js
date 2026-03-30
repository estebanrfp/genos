let stripDisallowedChatControlChars = function (message) {
    let output = "";
    for (const char of message) {
      const code = char.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
        output += char;
      }
    }
    return output;
  },
  truncateChatHistoryText = function (text) {
    if (text.length <= CHAT_HISTORY_TEXT_MAX_CHARS) {
      return { text, truncated: false };
    }
    return {
      text: `${text.slice(0, CHAT_HISTORY_TEXT_MAX_CHARS)}\n...(truncated)...`,
      truncated: true,
    };
  },
  sanitizeChatHistoryContentBlock = function (block) {
    if (!block || typeof block !== "object") {
      return { block, changed: false };
    }
    const entry = { ...block };
    let changed = false;
    if (typeof entry.text === "string") {
      const res = truncateChatHistoryText(entry.text);
      entry.text = res.text;
      changed ||= res.truncated;
    }
    if (typeof entry.partialJson === "string") {
      const res = truncateChatHistoryText(entry.partialJson);
      entry.partialJson = res.text;
      changed ||= res.truncated;
    }
    if (typeof entry.arguments === "string") {
      const res = truncateChatHistoryText(entry.arguments);
      entry.arguments = res.text;
      changed ||= res.truncated;
    }
    if (typeof entry.thinking === "string") {
      const res = truncateChatHistoryText(entry.thinking);
      entry.thinking = res.text;
      changed ||= res.truncated;
    }
    if ("thinkingSignature" in entry) {
      delete entry.thinkingSignature;
      changed = true;
    }
    const type = typeof entry.type === "string" ? entry.type : "";
    if (type === "image" && typeof entry.data === "string") {
      const bytes = Buffer.byteLength(entry.data, "utf8");
      delete entry.data;
      entry.omitted = true;
      entry.bytes = bytes;
      changed = true;
    }
    return { block: changed ? entry : block, changed };
  },
  stripPrefetchContext = function (text) {
    const idx = text.indexOf("[Memory Prefetch");
    if (idx === -1) {
      return text;
    }
    const before = text.slice(0, idx);
    const rest = text.slice(idx);
    const timestampMatch = rest.match(/\n\[\w{3} \d{4}-\d{2}-\d{2} /);
    if (timestampMatch) {
      return (before + rest.slice(timestampMatch.index))
        .replace(/^\n+/, "")
        .replace(/\n{3,}/g, "\n\n");
    }
    const parts = rest.split(/\n{2,}/);
    const lastPart = parts.at(-1)?.trim();
    return lastPart || text;
  },
  sanitizeChatHistoryMessage = function (message) {
    if (!message || typeof message !== "object") {
      return { message, changed: false };
    }
    const entry = { ...message };
    let changed = false;
    if (entry.role === "user") {
      if (typeof entry.content === "string" && entry.content.includes("[Memory Prefetch")) {
        entry.content = stripPrefetchContext(entry.content);
        changed = true;
      } else if (Array.isArray(entry.content)) {
        for (const block of entry.content) {
          if (
            block?.type === "text" &&
            typeof block.text === "string" &&
            block.text.includes("[Memory Prefetch")
          ) {
            block.text = stripPrefetchContext(block.text);
            changed = true;
          }
        }
      }
    }
    if ("details" in entry) {
      delete entry.details;
      changed = true;
    }
    if ("usage" in entry) {
      delete entry.usage;
      changed = true;
    }
    if ("cost" in entry) {
      delete entry.cost;
      changed = true;
    }
    if (typeof entry.content === "string") {
      const res = truncateChatHistoryText(entry.content);
      entry.content = res.text;
      changed ||= res.truncated;
    } else if (Array.isArray(entry.content)) {
      const updated = entry.content.map((block) => sanitizeChatHistoryContentBlock(block));
      if (updated.some((item) => item.changed)) {
        entry.content = updated.map((item) => item.block);
        changed = true;
      }
    }
    if (typeof entry.text === "string") {
      const res = truncateChatHistoryText(entry.text);
      entry.text = res.text;
      changed ||= res.truncated;
    }
    return { message: changed ? entry : message, changed };
  },
  sanitizeChatHistoryMessages = function (messages) {
    if (messages.length === 0) {
      return messages;
    }
    let changed = false;
    const next = messages.map((message) => {
      const res = sanitizeChatHistoryMessage(message);
      changed ||= res.changed;
      return res.message;
    });
    return changed ? next : messages;
  },
  jsonUtf8Bytes = function (value) {
    try {
      return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      return Buffer.byteLength(String(value), "utf8");
    }
  },
  buildOversizedHistoryPlaceholder = function (message) {
    const role =
      message && typeof message === "object" && typeof message.role === "string"
        ? message.role
        : "assistant";
    const timestamp =
      message && typeof message === "object" && typeof message.timestamp === "number"
        ? message.timestamp
        : Date.now();
    return {
      role,
      timestamp,
      content: [{ type: "text", text: CHAT_HISTORY_OVERSIZED_PLACEHOLDER }],
      __genosos: { truncated: true, reason: "oversized" },
    };
  },
  replaceOversizedChatHistoryMessages = function (params) {
    const { messages, maxSingleMessageBytes } = params;
    if (messages.length === 0) {
      return { messages, replacedCount: 0 };
    }
    let replacedCount = 0;
    const next = messages.map((message) => {
      if (jsonUtf8Bytes(message) <= maxSingleMessageBytes) {
        return message;
      }
      replacedCount += 1;
      return buildOversizedHistoryPlaceholder(message);
    });
    return { messages: replacedCount > 0 ? next : messages, replacedCount };
  },
  enforceChatHistoryFinalBudget = function (params) {
    const { messages, maxBytes } = params;
    if (messages.length === 0) {
      return { messages, placeholderCount: 0 };
    }
    if (jsonUtf8Bytes(messages) <= maxBytes) {
      return { messages, placeholderCount: 0 };
    }
    const last = messages.at(-1);
    if (last && jsonUtf8Bytes([last]) <= maxBytes) {
      return { messages: [last], placeholderCount: 0 };
    }
    const placeholder = buildOversizedHistoryPlaceholder(last);
    if (jsonUtf8Bytes([placeholder]) <= maxBytes) {
      return { messages: [placeholder], placeholderCount: 1 };
    }
    return { messages: [], placeholderCount: 0 };
  },
  resolveTranscriptPath = function (params) {
    const { sessionId, storePath, sessionFile, agentId } = params;
    if (!storePath && !sessionFile) {
      return null;
    }
    try {
      const sessionsDir = storePath ? path.dirname(storePath) : undefined;
      return resolveSessionFilePath(
        sessionId,
        sessionFile ? { sessionFile } : undefined,
        sessionsDir || agentId ? { sessionsDir, agentId } : undefined,
      );
    } catch {
      return null;
    }
  },
  ensureTranscriptFile = function (params) {
    if (fs.existsSync(params.transcriptPath)) {
      return { ok: true };
    }
    try {
      fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
      const header = {
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: params.sessionId,
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      };
      secureWriteFileSync(params.transcriptPath, `${JSON.stringify(header)}\n`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  transcriptHasIdempotencyKey = function (transcriptPath, idempotencyKey) {
    try {
      const lines = secureReadFileSync(transcriptPath).split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const parsed = JSON.parse(line);
        if (parsed?.message?.idempotencyKey === idempotencyKey) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  },
  appendAssistantTranscriptMessage = function (params) {
    const transcriptPath = resolveTranscriptPath({
      sessionId: params.sessionId,
      storePath: params.storePath,
      sessionFile: params.sessionFile,
      agentId: params.agentId,
    });
    if (!transcriptPath) {
      return { ok: false, error: "transcript path not resolved" };
    }
    if (!fs.existsSync(transcriptPath)) {
      if (!params.createIfMissing) {
        return { ok: false, error: "transcript file not found" };
      }
      const ensured = ensureTranscriptFile({
        transcriptPath,
        sessionId: params.sessionId,
      });
      if (!ensured.ok) {
        return { ok: false, error: ensured.error ?? "failed to create transcript file" };
      }
    }
    if (
      params.idempotencyKey &&
      transcriptHasIdempotencyKey(transcriptPath, params.idempotencyKey)
    ) {
      return { ok: true };
    }
    const now = Date.now();
    const labelPrefix = params.label ? `[${params.label}]\n\n` : "";
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    };
    const messageBody = {
      role: params.role ?? "assistant",
      content: [{ type: "text", text: `${labelPrefix}${params.message}` }],
      timestamp: now,
      stopReason: "stop",
      usage,
      api: "openai-responses",
      provider: "genosos",
      model: "gateway-injected",
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
      ...(params.abortMeta
        ? {
            genososAbort: {
              aborted: true,
              origin: params.abortMeta.origin,
              runId: params.abortMeta.runId,
            },
          }
        : {}),
    };
    try {
      ensureSessionFileDecrypted(transcriptPath);
      const sessionManager = SessionManager.open(transcriptPath);
      const messageId = sessionManager.appendMessage(messageBody);
      return { ok: true, messageId, message: messageBody };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  collectSessionAbortPartials = function (params) {
    const out = [];
    for (const [runId, active] of params.chatAbortControllers) {
      if (active.sessionKey !== params.sessionKey) {
        continue;
      }
      const text = params.chatRunBuffers.get(runId);
      if (!text || !text.trim()) {
        continue;
      }
      out.push({
        runId,
        sessionId: active.sessionId,
        text,
        abortOrigin: params.abortOrigin,
      });
    }
    return out;
  },
  persistAbortedPartials = function (params) {
    if (params.snapshots.length === 0) {
      return;
    }
    const { storePath, entry } = loadSessionEntry(params.sessionKey);
    for (const snapshot of params.snapshots) {
      const sessionId = entry?.sessionId ?? snapshot.sessionId ?? snapshot.runId;
      const appended = appendAssistantTranscriptMessage({
        message: snapshot.text,
        sessionId,
        storePath,
        sessionFile: entry?.sessionFile,
        createIfMissing: true,
        idempotencyKey: `${snapshot.runId}:assistant`,
        abortMeta: {
          aborted: true,
          origin: snapshot.abortOrigin,
          runId: snapshot.runId,
        },
      });
      if (!appended.ok) {
        params.context.logGateway.warn(
          `chat.abort transcript append failed: ${appended.error ?? "unknown error"}`,
        );
      }
    }
  },
  createChatAbortOps = function (context) {
    return {
      chatAbortControllers: context.chatAbortControllers,
      chatRunBuffers: context.chatRunBuffers,
      chatDeltaSentAt: context.chatDeltaSentAt,
      chatAbortedRuns: context.chatAbortedRuns,
      removeChatRun: context.removeChatRun,
      agentRunSeq: context.agentRunSeq,
      broadcast: context.broadcast,
      nodeSendToSession: context.nodeSendToSession,
    };
  },
  abortChatRunsForSessionKeyWithPartials = function (params) {
    const snapshots = collectSessionAbortPartials({
      chatAbortControllers: params.context.chatAbortControllers,
      chatRunBuffers: params.context.chatRunBuffers,
      sessionKey: params.sessionKey,
      abortOrigin: params.abortOrigin,
    });
    const res = abortChatRunsForSessionKey(params.ops, {
      sessionKey: params.sessionKey,
      stopReason: params.stopReason,
    });
    if (res.aborted) {
      persistAbortedPartials({
        context: params.context,
        sessionKey: params.sessionKey,
        snapshots,
      });
    }
    return res;
  },
  nextChatSeq = function (context, runId) {
    const next = (context.agentRunSeq.get(runId) ?? 0) + 1;
    context.agentRunSeq.set(runId, next);
    return next;
  },
  broadcastChatFinal = function (params) {
    const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
    const payload = {
      runId: params.runId,
      sessionKey: params.sessionKey,
      seq,
      state: "final",
      message: params.message,
    };
    params.context.broadcast("chat", payload);
    params.context.nodeSendToSession(params.sessionKey, "chat", payload);
    params.context.agentRunSeq.delete(params.runId);
  },
  broadcastChatError = function (params) {
    const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
    const payload = {
      runId: params.runId,
      sessionKey: params.sessionKey,
      seq,
      state: "error",
      errorMessage: params.errorMessage,
    };
    params.context.broadcast("chat", payload);
    params.context.nodeSendToSession(params.sessionKey, "chat", payload);
    params.context.agentRunSeq.delete(params.runId);
  };
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@mariozechner/pi-coding-agent";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveThinkingDefault } from "../../agents/model-selection.js";
import { ensureSessionFileDecrypted } from "../../agents/pi-embedded-runner/session-manager-cache.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import { isSystemInstruction } from "../../auto-reply/reply/system-instructions.js";
import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { secureReadFileSync, secureWriteFileSync } from "../../infra/secure-io.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import {
  abortChatRunById,
  abortChatRunsForSessionKey,
  isChatStopCommandText,
  resolveChatRunExpiresAtMs,
} from "../chat-abort.js";
import { parseMessageWithAttachments } from "../chat-attachments.js";
import { stripEnvelopeFromMessages } from "../chat-sanitize.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatAbortParams,
  validateChatHistoryParams,
  validateChatInjectParams,
  validateChatSendParams,
} from "../protocol/index.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  capArrayByJsonBytes,
  loadSessionEntry,
  readSessionMessages,
  resolveSessionModelRef,
} from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";
import { normalizeRpcAttachmentsToChatAttachments } from "./attachment-normalize.js";
const CHAT_HISTORY_TEXT_MAX_CHARS = 12000;
const CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 131072;
const CHAT_HISTORY_OVERSIZED_PLACEHOLDER = "[chat.history omitted: message too large]";
let chatHistoryPlaceholderEmitCount = 0;
export function sanitizeChatSendMessageInput(message) {
  const normalized = message.normalize("NFC");
  if (normalized.includes("\0")) {
    return { ok: false, error: "message must not contain null bytes" };
  }
  return { ok: true, message: stripDisallowedChatControlChars(normalized) };
}
export const chatHandlers = {
  "chat.history": async ({ params, respond, context }) => {
    if (!validateChatHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, limit } = params;
    try {
      const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
      const sessionId = entry?.sessionId;
      const rawMessages =
        sessionId && storePath ? readSessionMessages(sessionId, storePath, entry?.sessionFile) : [];
      const hardMax = 1000;
      const defaultLimit = 200;
      const requested = typeof limit === "number" ? limit : defaultLimit;
      const max = Math.min(hardMax, requested);
      const sliced = rawMessages.length > max ? rawMessages.slice(-max) : rawMessages;
      const sanitized = stripEnvelopeFromMessages(sliced);
      const normalized = sanitizeChatHistoryMessages(sanitized);
      // Annotate system instruction messages so the UI can render them as dividers
      for (const msg of normalized) {
        if (msg.role !== "user") {
          continue;
        }
        const text =
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? (msg.content.find((b) => b.type === "text")?.text ?? "")
              : "";
        if (isSystemInstruction(text)) {
          msg.__genosos = { kind: "system-instruction" };
        }
      }
      const maxHistoryBytes = getMaxChatHistoryMessagesBytes();
      const perMessageHardCap = Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes);
      const replaced = replaceOversizedChatHistoryMessages({
        messages: normalized,
        maxSingleMessageBytes: perMessageHardCap,
      });
      const capped = capArrayByJsonBytes(replaced.messages, maxHistoryBytes).items;
      const bounded = enforceChatHistoryFinalBudget({
        messages: capped,
        maxBytes: maxHistoryBytes,
      });
      const placeholderCount = replaced.replacedCount + bounded.placeholderCount;
      if (placeholderCount > 0) {
        chatHistoryPlaceholderEmitCount += placeholderCount;
        context.logGateway.debug(
          `chat.history omitted oversized payloads placeholders=${placeholderCount} total=${chatHistoryPlaceholderEmitCount}`,
        );
      }
      let thinkingLevel = entry?.thinkingLevel;
      if (!thinkingLevel) {
        const configured = cfg.agents?.defaults?.thinkingDefault;
        if (configured) {
          thinkingLevel = configured;
        } else {
          const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
          const { provider, model } = resolveSessionModelRef(cfg, entry, sessionAgentId);
          const catalog = await context.loadGatewayModelCatalog();
          thinkingLevel = resolveThinkingDefault({
            cfg,
            provider,
            model,
            catalog,
          });
        }
      }
      const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
      respond(true, {
        sessionKey,
        sessionId,
        messages: bounded.messages,
        thinkingLevel,
        verboseLevel,
      });
    } catch (err) {
      context.logGateway.error(
        `chat.history failed for session=${sessionKey}: ${formatForLog(err)}`,
      );
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "chat.abort": ({ params, respond, context }) => {
    if (!validateChatAbortParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey: rawSessionKey, runId } = params;
    const ops = createChatAbortOps(context);
    if (!runId) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops,
        sessionKey: rawSessionKey,
        abortOrigin: "rpc",
        stopReason: "rpc",
      });
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }
    const active = context.chatAbortControllers.get(runId);
    if (!active) {
      respond(true, { ok: true, aborted: false, runIds: [] });
      return;
    }
    if (active.sessionKey !== rawSessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId does not match sessionKey"),
      );
      return;
    }
    const partialText = context.chatRunBuffers.get(runId);
    const res = abortChatRunById(ops, {
      runId,
      sessionKey: rawSessionKey,
      stopReason: "rpc",
    });
    if (res.aborted && partialText && partialText.trim()) {
      persistAbortedPartials({
        context,
        sessionKey: rawSessionKey,
        snapshots: [
          {
            runId,
            sessionId: active.sessionId,
            text: partialText,
            abortOrigin: "rpc",
          },
        ],
      });
    }
    respond(true, {
      ok: true,
      aborted: res.aborted,
      runIds: res.aborted ? [runId] : [],
    });
  },
  "chat.send": async ({ params, respond, context, client }) => {
    if (!validateChatSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const sanitizedMessageResult = sanitizeChatSendMessageInput(p.message);
    if (!sanitizedMessageResult.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, sanitizedMessageResult.error),
      );
      return;
    }
    const inboundMessage = sanitizedMessageResult.message;
    const stopCommand = isChatStopCommandText(inboundMessage);
    const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(p.attachments);
    const rawMessage = inboundMessage.trim();
    if (!rawMessage && normalizedAttachments.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message or attachment required"),
      );
      return;
    }
    let parsedMessage = inboundMessage;
    let parsedImages = [];
    if (normalizedAttachments.length > 0) {
      try {
        const parsed = await parseMessageWithAttachments(inboundMessage, normalizedAttachments, {
          maxBytes: 5000000,
          log: context.logGateway,
        });
        parsedMessage = parsed.message;
        parsedImages = parsed.images;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }
    const rawSessionKey = p.sessionKey;
    const { cfg, entry, canonicalKey: sessionKey } = loadSessionEntry(rawSessionKey);
    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: p.timeoutMs,
    });
    const now = Date.now();
    const clientRunId = p.idempotencyKey;
    const sendPolicy = resolveSendPolicy({
      cfg,
      entry,
      sessionKey,
      channel: entry?.channel,
      chatType: entry?.chatType,
    });
    if (sendPolicy === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
      );
      return;
    }
    if (stopCommand) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops: createChatAbortOps(context),
        sessionKey: rawSessionKey,
        abortOrigin: "stop-command",
        stopReason: "stop",
      });
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }
    const cached = context.dedupe.get(`chat:${clientRunId}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }
    const activeExisting = context.chatAbortControllers.get(clientRunId);
    if (activeExisting) {
      respond(true, { runId: clientRunId, status: "in_flight" }, undefined, {
        cached: true,
        runId: clientRunId,
      });
      return;
    }
    try {
      const abortController = new AbortController();
      context.chatAbortControllers.set(clientRunId, {
        controller: abortController,
        sessionId: entry?.sessionId ?? clientRunId,
        sessionKey: rawSessionKey,
        startedAtMs: now,
        expiresAtMs: resolveChatRunExpiresAtMs({ now, timeoutMs }),
      });
      const ackPayload = {
        runId: clientRunId,
        status: "started",
      };
      respond(true, ackPayload, undefined, { runId: clientRunId });
      const trimmedMessage = parsedMessage.trim();
      const injectThinking = Boolean(
        p.thinking && trimmedMessage && !trimmedMessage.startsWith("/"),
      );
      const commandBody = injectThinking ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;
      const clientInfo = client?.connect?.client;
      const stampedMessage = injectTimestamp(parsedMessage, timestampOptsFromConfig(cfg));
      const ctx = {
        Body: parsedMessage,
        BodyForAgent: stampedMessage,
        BodyForCommands: commandBody,
        RawBody: parsedMessage,
        CommandBody: commandBody,
        SessionKey: sessionKey,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
        ChatType: "direct",
        CommandAuthorized: true,
        MessageSid: clientRunId,
        SenderId: clientInfo?.id,
        SenderName: clientInfo?.displayName,
        SenderUsername: clientInfo?.displayName,
        GatewayClientScopes: client?.connect?.scopes,
      };
      const agentId = resolveSessionAgentId({
        sessionKey,
        config: cfg,
      });
      const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
        cfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });
      const finalReplyParts = [];
      let finalReplyRole;
      const dispatcher = createReplyDispatcher({
        ...prefixOptions,
        onError: (err) => {
          context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
        },
        deliver: async (payload, info) => {
          if (info.kind !== "final") {
            return;
          }
          const text = payload.text?.trim() ?? "";
          if (!text) {
            return;
          }
          if (payload.role) {
            finalReplyRole = payload.role;
          }
          finalReplyParts.push(text);
        },
      });
      let agentRunStarted = false;
      dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          abortSignal: abortController.signal,
          images: parsedImages.length > 0 ? parsedImages : undefined,
          onAgentRunStart: (runId) => {
            agentRunStarted = true;
            const connId = typeof client?.connId === "string" ? client.connId : undefined;
            const wantsToolEvents = hasGatewayClientCap(
              client?.connect?.caps,
              GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
            );
            if (connId && wantsToolEvents) {
              context.registerToolEventRecipient(runId, connId);
              for (const [activeRunId, active] of context.chatAbortControllers) {
                if (activeRunId !== runId && active.sessionKey === p.sessionKey) {
                  context.registerToolEventRecipient(activeRunId, connId);
                }
              }
            }
          },
          onModelSelected,
        },
      })
        .then(() => {
          if (!agentRunStarted) {
            const combinedReply = finalReplyParts
              .map((part) => part.trim())
              .filter(Boolean)
              .join("\n\n")
              .trim();
            let message;
            if (combinedReply) {
              const { storePath: latestStorePath, entry: latestEntry } =
                loadSessionEntry(sessionKey);
              const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
              const appended = appendAssistantTranscriptMessage({
                message: combinedReply,
                sessionId,
                storePath: latestStorePath,
                sessionFile: latestEntry?.sessionFile,
                agentId,
                createIfMissing: true,
                role: finalReplyRole,
              });
              if (appended.ok) {
                message = appended.message;
              } else {
                context.logGateway.warn(
                  `webchat transcript append failed: ${appended.error ?? "unknown error"}`,
                );
                const now = Date.now();
                message = {
                  role: finalReplyRole ?? "assistant",
                  content: [{ type: "text", text: combinedReply }],
                  timestamp: now,
                  stopReason: "stop",
                  usage: { input: 0, output: 0, totalTokens: 0 },
                };
              }
            }
            broadcastChatFinal({
              context,
              runId: clientRunId,
              sessionKey: rawSessionKey,
              message,
            });
          }
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: true,
            payload: { runId: clientRunId, status: "ok" },
          });
        })
        .catch((err) => {
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: false,
            payload: {
              runId: clientRunId,
              status: "error",
              summary: String(err),
            },
            error,
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey: rawSessionKey,
            errorMessage: String(err),
          });
        })
        .finally(() => {
          context.chatAbortControllers.delete(clientRunId);
        });
    } catch (err) {
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: clientRunId,
        status: "error",
        summary: String(err),
      };
      context.dedupe.set(`chat:${clientRunId}`, {
        ts: Date.now(),
        ok: false,
        payload,
        error,
      });
      respond(false, payload, error, {
        runId: clientRunId,
        error: formatForLog(err),
      });
    }
  },
  "chat.inject": async ({ params, respond, context }) => {
    if (!validateChatInjectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const rawSessionKey = p.sessionKey;
    const { cfg, storePath, entry } = loadSessionEntry(rawSessionKey);
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
      return;
    }
    const appended = appendAssistantTranscriptMessage({
      message: p.message,
      label: p.label,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      agentId: resolveSessionAgentId({ sessionKey: rawSessionKey, config: cfg }),
      createIfMissing: false,
    });
    if (!appended.ok || !appended.messageId || !appended.message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to write transcript: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }
    const chatPayload = {
      runId: `inject-${appended.messageId}`,
      sessionKey: rawSessionKey,
      seq: 0,
      state: "final",
      message: appended.message,
    };
    context.broadcast("chat", chatPayload);
    context.nodeSendToSession(rawSessionKey, "chat", chatPayload);
    respond(true, { ok: true, messageId: appended.messageId });
  },
};

export { appendAssistantTranscriptMessage };
