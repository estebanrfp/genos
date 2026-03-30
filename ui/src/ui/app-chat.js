const VISIBLE_SLASH_COMMANDS = ["/think ", "/t ", "/thinking "];
let isSilentCommand = function (text) {
    const normalized = text.trim().toLowerCase();
    if (!normalized.startsWith("/")) {
      return false;
    }
    return !VISIBLE_SLASH_COMMANDS.some((cmd) => normalized.startsWith(cmd));
  },
  isChatResetCommand = function (text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === "/new" || normalized === "/reset") {
      return true;
    }
    return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
  },
  enqueueChatMessage = function (host, text, attachments, refreshSessions) {
    const trimmed = text.trim();
    const hasAttachments = Boolean(attachments && attachments.length > 0);
    if (!trimmed && !hasAttachments) {
      return;
    }
    host.chatQueue = [
      ...host.chatQueue,
      {
        id: generateUUID(),
        text: trimmed,
        createdAt: Date.now(),
        attachments: hasAttachments ? attachments?.map((att) => ({ ...att })) : undefined,
        refreshSessions,
      },
    ];
  },
  resolveAgentIdForSession = function (host) {
    const parsed = parseAgentSessionKey(host.sessionKey);
    if (parsed?.agentId) {
      return parsed.agentId;
    }
    const snapshot = host.hello?.snapshot;
    const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
    return fallback || "main";
  },
  buildAvatarMetaUrl = function (basePath, agentId) {
    const base = normalizeBasePath(basePath);
    const encoded = encodeURIComponent(agentId);
    return base ? `${base}/avatar/${encoded}?meta=1` : `/avatar/${encoded}?meta=1`;
  };
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { scheduleChatScroll } from "./app-scroll.js";
import { setLastActiveSessionKey, syncUrlWithSessionKey } from "./app-settings.js";
import { resetToolStream } from "./app-tool-stream.js";
import { abortChatRun, loadChatHistory, sendChatMessage } from "./controllers/chat.js";
import { loadConfig } from "./controllers/config.js";
import { loadSessions } from "./controllers/sessions.js";
import { normalizeBasePath } from "./navigation.js";
import { generateUUID } from "./uuid.js";
import { openSettingsModal } from "./views/settings-modal.js";
export const CHAT_SESSIONS_ACTIVE_MINUTES = 0;

/** Switch to a brand-new session key (UUID-based), preserving the current session. */
export async function switchToNewSession(host) {
  const parsed = parseAgentSessionKey(host.sessionKey);
  const agentId = parsed?.agentId ?? "default";
  const newKey = `agent:${agentId}:${generateUUID().replace(/-/g, "").slice(0, 12)}`;
  host.sessionKey = newKey;
  host.chatMessages = [];
  host.chatMessage = "";
  host.chatStream = null;
  host.chatStreamStartedAt = null;
  host.chatRunId = null;
  host.resetToolStream();
  host.resetChatScroll();
  host.applySettings({
    ...host.settings,
    sessionKey: newKey,
    lastActiveSessionKey: newKey,
  });
  host.loadAssistantIdentity();
  syncUrlWithSessionKey(host, newKey, true);
  await loadChatHistory(host);
  // Initialize new session on the server — triggers the welcome message from the agent
  await host.handleSendChat?.("/new");
}

export function isChatBusy(host) {
  return host.chatSending || Boolean(host.chatRunId);
}
export function isChatStopCommand(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}
export async function handleAbortChat(host) {
  if (!host.connected) {
    return;
  }
  host.chatMessage = "";
  // Clear running session so activity dot stops immediately
  host._runningSessions?.delete(host.sessionKey);
  await abortChatRun(host);
}
async function sendChatMessageNow(host, message, opts) {
  resetToolStream(host);
  const runId = await sendChatMessage(host, message, opts?.attachments, { silent: opts?.silent });
  const ok = Boolean(runId);
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (ok) {
    setLastActiveSessionKey(host, host.sessionKey);
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  scheduleChatScroll(host);
  if (ok && !host.chatRunId) {
    flushChatQueue(host);
  }
  if (ok && opts?.refreshSessions && runId) {
    host.refreshSessionsAfterChat.add(runId);
  }
  return ok;
}
async function flushChatQueue(host) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const [next, ...rest] = host.chatQueue;
  if (!next) {
    return;
  }
  host.chatQueue = rest;
  const ok = await sendChatMessageNow(host, next.text, {
    attachments: next.attachments,
    refreshSessions: next.refreshSessions,
  });
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  }
}
export function removeQueuedMessage(host, id) {
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}
export async function handleSendChat(host, messageOverride, opts) {
  if (!host.connected) {
    return;
  }
  const previousDraft = host.chatMessage;
  const message = (messageOverride ?? host.chatMessage).trim();
  const attachments = host.chatAttachments ?? [];
  const attachmentsToSend = messageOverride == null ? attachments : [];
  const hasAttachments = attachmentsToSend.length > 0;
  if (!message && !hasAttachments) {
    return;
  }
  if (isChatStopCommand(message)) {
    await handleAbortChat(host);
    return;
  }
  // Intercept /new from user input — create a new session and send /new there
  if (
    messageOverride == null &&
    (message.toLowerCase() === "/new" || message.toLowerCase().startsWith("/new "))
  ) {
    host.chatMessage = "";
    await switchToNewSession(host);
    return;
  }
  // Intercept bare /config — open Config Map overlay instead of sending to agent
  if (message.toLowerCase() === "/config") {
    host.chatMessage = "";
    openSettingsModal(host, "config");
    return;
  }
  // Intercept /config show — open config editor in settings modal
  if (message.toLowerCase() === "/config show") {
    host.chatMessage = "";
    host._settingsConfigEditor = true;
    host.lastError = null;
    openSettingsModal(host, "config");
    loadConfig(host);
    return;
  }
  const refreshSessions = isChatResetCommand(message);
  if (messageOverride == null) {
    host.chatMessage = "";
    host.chatAttachments = [];
  }
  if (isChatBusy(host)) {
    enqueueChatMessage(host, message, attachmentsToSend, refreshSessions);
    return;
  }
  await sendChatMessageNow(host, message, {
    previousDraft: messageOverride == null ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null ? attachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
    refreshSessions,
    silent: refreshSessions || isSilentCommand(message),
  });
}
export async function refreshChat(host, opts) {
  await Promise.all([
    loadChatHistory(host),
    loadSessions(host, {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
    }),
    refreshChatAvatar(host),
  ]);
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(host);
  }
}
export const flushChatQueueForEvent = flushChatQueue;
export async function refreshChatAvatar(host) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    host.chatAvatarUrl = null;
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = await res.json();
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    host.chatAvatarUrl = null;
  }
}
const CHAT_RUN_STALE_MS = 5 * 60_000;
const WATCHDOG_INTERVAL_MS = 30_000;
export function startChatRunWatchdog(host) {
  stopChatRunWatchdog(host);
  host._chatWatchdog = setInterval(() => {
    if (!host.chatRunId || !host.chatStreamStartedAt) {
      return;
    }
    if (Date.now() - host.chatStreamStartedAt > CHAT_RUN_STALE_MS) {
      host.chatRunId = null;
      host.chatStream = null;
      host.chatStreamStartedAt = null;
      flushChatQueue(host);
    }
  }, WATCHDOG_INTERVAL_MS);
}
export function stopChatRunWatchdog(host) {
  if (host._chatWatchdog) {
    clearInterval(host._chatWatchdog);
    host._chatWatchdog = null;
  }
}
const ACTIVITY_TICK_MS = 1000;
export function startActivityTick(host) {
  stopActivityTick(host);
  host._activityTick = setInterval(() => {
    if (host.chatRunId || host.compactionStatus?.active || host._runningSessions?.size > 0) {
      host.requestUpdate();
    }
  }, ACTIVITY_TICK_MS);
}
export function stopActivityTick(host) {
  if (host._activityTick) {
    clearInterval(host._activityTick);
    host._activityTick = null;
  }
}
