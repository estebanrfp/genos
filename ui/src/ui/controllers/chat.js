let dataUrlToBase64 = function (dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      return null;
    }
    return { mimeType: match[1], content: match[2] };
  },
  normalizeAbortedAssistantMessage = function (message) {
    if (!message || typeof message !== "object") {
      return null;
    }
    const candidate = message;
    if (candidate.role !== "assistant") {
      return null;
    }
    if (!("content" in candidate) || !Array.isArray(candidate.content)) {
      return null;
    }
    return candidate;
  };
import { extractText } from "../chat/message-extract.js";
import { generateUUID } from "../uuid.js";
let _chatHistoryInflight = null;
let _chatHistoryInflightKey = null;
export async function loadChatHistory(state) {
  if (!state.client || !state.connected) {
    return;
  }
  // Dedup: only piggyback if loading the SAME session (prevent stale cross-session data).
  if (_chatHistoryInflight && _chatHistoryInflightKey === state.sessionKey) {
    return _chatHistoryInflight;
  }
  state.chatLoading = true;
  state.lastError = null;
  const sessionKey = state.sessionKey;
  _chatHistoryInflightKey = sessionKey;
  _chatHistoryInflight = (async () => {
    try {
      const res = await state.client.request("chat.history", {
        sessionKey,
        limit: 200,
      });
      // Only apply if user hasn't switched sessions while the request was in-flight.
      if (state.sessionKey === sessionKey) {
        const incoming = Array.isArray(res.messages) ? res.messages : [];
        // Preserve cached messages when server returns empty on reconnect
        if (incoming.length > 0 || state.chatMessages.length === 0) {
          state.chatMessages = incoming;
        }
        state.chatThinkingLevel = res.thinkingLevel ?? null;
        state.deriveChatActiveModel?.();
      }
    } catch (err) {
      state.lastError = String(err);
    } finally {
      state.chatLoading = false;
      _chatHistoryInflight = null;
      _chatHistoryInflightKey = null;
    }
  })();
  return _chatHistoryInflight;
}
export async function sendChatMessage(state, message, attachments, opts) {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }
  const now = Date.now();
  const contentBlocks = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  if (hasAttachments) {
    for (const att of attachments) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
      });
    }
  }
  if (!opts?.silent) {
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "user",
        content: contentBlocks,
        timestamp: now,
      },
    ];
  }
  state.chatSending = true;
  state.lastError = null;
  state.lastRunStats = null;
  const runId = generateUUID();
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            type: "image",
            mimeType: parsed.mimeType,
            content: parsed.content,
          };
        })
        .filter((a) => a !== null)
    : undefined;
  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
    });
    return runId;
  } catch (err) {
    const error = String(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.lastError = error;
    return null;
  } finally {
    state.chatSending = false;
  }
}
export async function abortChatRun(state) {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = String(err);
    return false;
  }
}
export function handleChatEvent(state, payload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }
  // Background run (no active chatRunId) — only reload history on final,
  // never update stream or inject messages (prevents blank/flash from
  // sessions_send, cron, or other background agent runs).
  if (!state.chatRunId) {
    if (payload.state === "final") {
      return "final";
    }
    return null;
  }
  if (payload.runId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      return "final";
    }
    return null;
  }
  if (payload.state === "delta") {
    state.chatStreamStartedAt ??= Date.now();
    const next = extractText(payload.message);
    if (typeof next === "string") {
      const current = state.chatStream ?? "";
      if (!current || next.length >= current.length) {
        state.chatStream = next;
      }
    }
  } else if (payload.state === "final") {
    if (payload.usage) {
      state.lastRunStats = payload.usage;
      // Sync model from gateway response
      if (payload.usage.model) {
        state.syncModelFromGateway?.(payload.usage.model);
      }
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "aborted") {
    const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
    if (normalizedMessage) {
      state.chatMessages = [...state.chatMessages, normalizedMessage];
    } else {
      const streamedText = state.chatStream ?? "";
      if (streamedText.trim()) {
        state.chatMessages = [
          ...state.chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: streamedText }],
            timestamp: Date.now(),
          },
        ];
      }
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "error") {
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.lastError = payload.errorMessage ?? "chat error";
  }
  return payload.state;
}
