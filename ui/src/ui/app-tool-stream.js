let extractToolOutputText = function (value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value;
    if (typeof record.text === "string") {
      return record.text;
    }
    const content = record.content;
    if (!Array.isArray(content)) {
      return null;
    }
    const parts = content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const entry = item;
        if (entry.type === "text" && typeof entry.text === "string") {
          return entry.text;
        }
        return null;
      })
      .filter((part) => Boolean(part));
    if (parts.length === 0) {
      return null;
    }
    return parts.join("\n");
  },
  formatToolOutput = function (value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    const contentText = extractToolOutputText(value);
    let text;
    if (typeof value === "string") {
      text = value;
    } else if (contentText) {
      text = contentText;
    } else {
      try {
        text = JSON.stringify(value, null, 2);
      } catch {
        text = String(value);
      }
    }
    const truncated = truncateText(text, TOOL_OUTPUT_CHAR_LIMIT);
    if (!truncated.truncated) {
      return truncated.text;
    }
    return `${truncated.text}

\u2026 truncated (${truncated.total} chars, showing first ${truncated.text.length}).`;
  },
  buildToolStreamMessage = function (entry) {
    const content = [];
    content.push({
      type: "toolcall",
      name: entry.name,
      arguments: entry.args ?? {},
    });
    if (entry.output) {
      content.push({
        type: "toolresult",
        name: entry.name,
        text: entry.output,
      });
    }
    return {
      role: "assistant",
      toolCallId: entry.toolCallId,
      runId: entry.runId,
      content,
      timestamp: entry.startedAt,
    };
  },
  trimToolStream = function (host) {
    if (host.toolStreamOrder.length <= TOOL_STREAM_LIMIT) {
      return;
    }
    const overflow = host.toolStreamOrder.length - TOOL_STREAM_LIMIT;
    const removed = host.toolStreamOrder.splice(0, overflow);
    for (const id of removed) {
      host.toolStreamById.delete(id);
    }
  },
  syncToolStreamMessages = function (host) {
    host.chatToolMessages = host.toolStreamOrder
      .map((id) => host.toolStreamById.get(id)?.message)
      .filter((msg) => Boolean(msg));
  };
import { loadSessions } from "./controllers/sessions.js";
import { truncateText } from "./format.js";
const TOOL_STREAM_LIMIT = 50;
const TOOL_STREAM_THROTTLE_MS = 80;
const TOOL_OUTPUT_CHAR_LIMIT = 120000;
export function flushToolStreamSync(host) {
  if (host.toolStreamSyncTimer != null) {
    clearTimeout(host.toolStreamSyncTimer);
    host.toolStreamSyncTimer = null;
  }
  syncToolStreamMessages(host);
}
export function scheduleToolStreamSync(host, force = false) {
  if (force) {
    flushToolStreamSync(host);
    return;
  }
  if (host.toolStreamSyncTimer != null) {
    return;
  }
  host.toolStreamSyncTimer = window.setTimeout(
    () => flushToolStreamSync(host),
    TOOL_STREAM_THROTTLE_MS,
  );
}
export function resetToolStream(host) {
  host.toolStreamById.clear();
  host.toolStreamOrder = [];
  host.chatToolMessages = [];
  host.isBoosted = false;
  flushToolStreamSync(host);
}
const COMPACTION_TOAST_DURATION_MS = 5000;
export function handleCompactionEvent(host, payload) {
  const sk = typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
  if (sk && sk !== host.sessionKey) {
    return;
  }
  const data = payload.data ?? {};
  const phase = typeof data.phase === "string" ? data.phase : "";
  if (host.compactionClearTimer != null) {
    window.clearTimeout(host.compactionClearTimer);
    host.compactionClearTimer = null;
  }
  if (phase === "start") {
    host.compactionStatus = {
      active: true,
      startedAt: Date.now(),
      completedAt: null,
    };
  } else if (phase === "end") {
    host.compactionStatus = {
      active: false,
      startedAt: host.compactionStatus?.startedAt ?? null,
      completedAt: Date.now(),
    };
    // Refresh session data so token counts in placeholder update.
    // The backend updates totalTokens *after* emitting compaction:end,
    // so we delay the refresh to give the store time to update.
    loadSessions(host);
    setTimeout(() => loadSessions(host), 1500);
    host.compactionClearTimer = window.setTimeout(() => {
      host.compactionStatus = null;
      host.compactionClearTimer = null;
    }, COMPACTION_TOAST_DURATION_MS);
  }
}
export function handleAgentEvent(host, payload) {
  if (!payload) {
    return;
  }
  if (payload.stream === "compaction") {
    handleCompactionEvent(host, payload);
    return;
  }
  // Track running sessions from lifecycle events (for sidebar activity dots)
  if (payload.stream === "lifecycle") {
    const sk = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
    const phase = payload.data?.phase;
    if (sk) {
      const set = host._runningSessions ?? (host._runningSessions = new Set());
      if (phase === "start") {
        set.add(sk);
      } else if (phase === "end") {
        set.delete(sk);
        // Refresh session data so token counts in placeholder update
        loadSessions(host);
      }
      host.requestUpdate();
    }
    return;
  }
  if (payload.stream !== "tool") {
    return;
  }
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
  if (sessionKey && sessionKey !== host.sessionKey) {
    return;
  }
  if (!sessionKey && host.chatRunId && payload.runId !== host.chatRunId) {
    return;
  }
  if (host.chatRunId && payload.runId !== host.chatRunId) {
    return;
  }
  if (!host.chatRunId) {
    return;
  }
  const data = payload.data ?? {};
  const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
  if (!toolCallId) {
    return;
  }
  const name = typeof data.name === "string" ? data.name : "tool";
  const phase = typeof data.phase === "string" ? data.phase : "";
  // Boost detection — mark as boosted when boost tool starts
  if (name === "boost" && phase === "start") {
    host.isBoosted = true;
    host.requestUpdate();
  }
  const args = phase === "start" ? data.args : undefined;
  const output =
    phase === "update"
      ? formatToolOutput(data.partialResult)
      : phase === "result"
        ? formatToolOutput(data.result)
        : undefined;
  const now = Date.now();
  let entry = host.toolStreamById.get(toolCallId);
  if (!entry) {
    entry = {
      toolCallId,
      runId: payload.runId,
      sessionKey,
      name,
      args,
      output: output || undefined,
      startedAt: typeof payload.ts === "number" ? payload.ts : now,
      updatedAt: now,
      message: {},
    };
    host.toolStreamById.set(toolCallId, entry);
    host.toolStreamOrder.push(toolCallId);
  } else {
    entry.name = name;
    if (args !== undefined) {
      entry.args = args;
    }
    if (output !== undefined) {
      entry.output = output || undefined;
    }
    entry.updatedAt = now;
  }
  entry.message = buildToolStreamMessage(entry);
  trimToolStream(host);
  scheduleToolStreamSync(host, phase === "result");
}
