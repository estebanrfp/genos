import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { parseAgentSessionKey } from "../../../../src/routing/session-key.js";
import { isChatBusy, switchToNewSession } from "../app-chat.js";
import { resolveSessionDisplayName } from "../app-render.helpers.js";
import { syncUrlWithSessionKey } from "../app-settings.js";
import { loadAgents } from "../controllers/agents.js";
import { loadChatHistory } from "../controllers/chat.js";
import { deleteSessionAndRefresh, loadSessions, patchSession } from "../controllers/sessions.js";
import { icons } from "../icons.js";

/**
 * Group sessions by agentId for tree rendering.
 * @param {Array} sessions - Raw session rows from sessions.list
 * @returns {{ agents: Map<string, object[]>, agentIds: string[] }}
 */
const groupByAgent = (sessions) => {
  const agents = new Map();
  for (const s of sessions) {
    const parsed = parseAgentSessionKey(s.key);
    const agentId = parsed?.agentId ?? "main";
    if (!agents.has(agentId)) {
      agents.set(agentId, []);
    }
    agents.get(agentId).push(s);
  }
  // "main" always first
  const agentIds = [...agents.keys()].toSorted((a, b) => {
    if (a === "main") {
      return -1;
    }
    if (b === "main") {
      return 1;
    }
    return a.localeCompare(b);
  });
  return { agents, agentIds };
};

/**
 * Determine activity status for a session.
 * @returns {"active"|"working"|"inactive"}
 */
const sessionActivity = (session, activeSessionKey, chatRunId, runningSessions, connected) => {
  if (!connected) {
    return "inactive";
  }
  if (session.key === activeSessionKey && chatRunId) {
    return "working";
  }
  if (runningSessions?.has(session.key)) {
    return "working";
  }
  if (session.key === activeSessionKey) {
    return "active";
  }
  return "inactive";
};

/** Known channel names that appear in session keys. */
const KNOWN_CHANNELS = [
  "whatsapp",
  "telegram",
  "discord",
  "signal",
  "slack",
  "matrix",
  "bluebubbles",
  "email",
  "sms",
  "nostr",
];

/**
 * Extract channel name from a session key (e.g. "agent:main:whatsapp:default:direct:+34..." → "whatsapp").
 * @param {string} key
 * @returns {string|null}
 */
const extractChannelFromKey = (key) => {
  const parsed = parseAgentSessionKey(key);
  const rest = parsed?.rest ?? key;
  for (const ch of KNOWN_CHANNELS) {
    if (rest === ch || rest.startsWith(`${ch}:`)) {
      return ch;
    }
  }
  return null;
};

/**
 * Resolve channel connection status from channelsSnapshot.
 * @param {string} channel
 * @param {object|null} snapshot
 * @returns {"connected"|"disconnected"|null}
 */
const resolveChannelStatus = (channel, snapshot) => {
  const summary = snapshot?.channels?.[channel];
  if (!summary) {
    return null;
  }
  if (typeof summary.connected === "boolean") {
    return summary.connected ? "connected" : "disconnected";
  }
  // Fallback: linked means configured but connection state unknown
  if (typeof summary.linked === "boolean") {
    return summary.linked ? "connected" : "disconnected";
  }
  return null;
};

/**
 * Resolve the main session key from hello snapshot.
 */
const resolveMainSessionKey = (hello, sessions) => {
  const snapshot = hello?.snapshot;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  if (sessions?.sessions?.some((row) => row.key === "main")) {
    return "main";
  }
  return null;
};

/**
 * Reset chat state when switching sessions.
 */
const resetChatState = (state, sessionKey) => {
  state.sessionKey = sessionKey;
  state.chatMessages = [];
  state.chatMessage = "";
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatRunId = null;
  state.resetToolStream();
  state.resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey,
    lastActiveSessionKey: sessionKey,
  });
};

/**
 * Render the full session tree for the sidebar.
 * @param {object} state - GenosOSApp instance
 */
export function renderSessionTree(state) {
  const sessions = state.sessionsResult?.sessions ?? [];
  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const busy = isChatBusy(state);

  const switchSession = (key, implicit) => {
    if (key === state.sessionKey) {
      return;
    }
    resetChatState(state, key);
    state.loadAssistantIdentity();
    syncUrlWithSessionKey(state, key, true);
    if (implicit) {
      state.handleSendChat?.("/new");
    } else {
      loadChatHistory(state);
    }
  };

  const renameSession = async (key) => {
    const row = sessions.find((s) => s.key === key);
    const current = resolveSessionDisplayName(key, row);
    const newName = window.prompt("Rename session:", current);
    if (newName !== null && newName.trim()) {
      await patchSession(state, key, { label: newName.trim() });
    }
  };

  const deleteSession = async (key) => {
    const deleted = await deleteSessionAndRefresh(state, key);
    if (deleted) {
      const fallback = mainSessionKey ?? state.sessionKey;
      resetChatState(state, fallback);
      state.loadAssistantIdentity();
      syncUrlWithSessionKey(state, fallback, true);
      loadChatHistory(state);
    }
  };

  // Build session options with display names
  const seen = new Set();
  const allSessions = [];
  // Main session first
  if (mainSessionKey) {
    const row = sessions.find((s) => s.key === mainSessionKey);
    seen.add(mainSessionKey);
    allSessions.push({
      key: mainSessionKey,
      row,
      displayName: resolveSessionDisplayName(mainSessionKey, row),
    });
  }
  for (const s of sessions) {
    if (!seen.has(s.key)) {
      seen.add(s.key);
      allSessions.push({ key: s.key, row: s, displayName: resolveSessionDisplayName(s.key, s) });
    }
  }
  // Current session if missing
  if (!seen.has(state.sessionKey)) {
    allSessions.push({
      key: state.sessionKey,
      row: undefined,
      displayName: resolveSessionDisplayName(state.sessionKey, undefined),
    });
  }

  const { agents, agentIds } = groupByAgent(
    allSessions.map((s) => ({ ...s.row, key: s.key, _displayName: s.displayName })),
  );

  // Merge known agents from config — ensures agents with no sessions still appear
  const knownAgents = (state.agentsList?.agents ?? []).map((a) => a.id);
  for (const id of knownAgents) {
    if (!agents.has(id)) {
      agents.set(id, []);
      agentIds.push(id);
    }
  }
  const renderSessionItem = (s) => {
    const isActive = s.key === state.sessionKey;
    const parsed = parseAgentSessionKey(s.key);
    const isMain = s.key === mainSessionKey || parsed?.rest === "main";
    const activity = sessionActivity(
      s,
      state.sessionKey,
      state.chatRunId,
      state._runningSessions,
      state.connected,
    );
    const displayName = s._displayName ?? resolveSessionDisplayName(s.key, s);
    const rest = parsed?.rest ?? s.key;
    const isSubagent = rest.startsWith("subagent:");
    const isCron = rest.startsWith("cron:");

    // Connection status: channel-specific or gateway-level
    const channel = extractChannelFromKey(s.key);
    const channelStatus = channel ? resolveChannelStatus(channel, state.channelsSnapshot) : null;
    const isConnected =
      channelStatus === "connected" || (channelStatus === null && state.connected);
    const isDisconnected =
      channelStatus === "disconnected" || (channelStatus === null && !state.connected);

    const dotClass =
      activity === "working" && isConnected
        ? "session-item__dot--connected-working"
        : activity === "working" && isDisconnected
          ? "session-item__dot--working"
          : isConnected
            ? "session-item__dot--connected"
            : isDisconnected
              ? "session-item__dot--disconnected"
              : activity === "active"
                ? "session-item__dot--active"
                : "";

    return html`
      <button
        class="session-item ${isActive ? "session-item--active" : ""} ${isSubagent ? "session-item--sub" : ""} ${isCron ? "session-item--cron" : ""}"
        aria-current=${isActive ? "page" : nothing}
        title=${displayName}
        @click=${() => switchSession(s.key, s._implicit)}
        @dblclick=${() => !isMain && renameSession(s.key)}
      >
        <span class="session-item__dot ${dotClass}"></span>
        <span class="session-item__label">${displayName}</span>
        ${
          !isMain
            ? html`
          <span
            class="session-item__close"
            role="button"
            aria-label="Close ${displayName}"
            @click=${(e) => {
              e.stopPropagation();
              deleteSession(s.key);
            }}
          >${icons.x}</span>
        `
            : nothing
        }
      </button>
    `;
  };

  /** Resolve display label for an agent group header. */
  const agentLabel = (agentId) => {
    const entry = (state.agentsList?.agents ?? []).find((a) => a.id === agentId);
    const emoji = entry?.identity?.emoji ?? "";
    const name = entry?.name ?? entry?.identity?.name ?? agentId;
    return emoji ? `${emoji} ${name}` : name;
  };

  const _deletingAgents = state._deletingAgents ?? (state._deletingAgents = new Set());
  const deleteAgent = async (agentId) => {
    if (_deletingAgents.has(agentId)) {
      return;
    }
    const label = agentLabel(agentId);
    const confirmed = window.confirm(
      `Delete agent "${label}"?\n\nThis will remove the agent, its workspace files, and all sessions.`,
    );
    if (!confirmed) {
      return;
    }
    _deletingAgents.add(agentId);
    try {
      await state.client.request("agents.delete", { agentId, deleteFiles: true });
      // Always switch away to main agent session
      const fallback = mainSessionKey ?? "main";
      resetChatState(state, fallback);
      state.loadAssistantIdentity();
      syncUrlWithSessionKey(state, fallback, true);
      loadChatHistory(state);
      await Promise.all([loadAgents(state), loadSessions(state)]);
    } catch (err) {
      console.error("[session-tree] delete agent failed:", err);
    } finally {
      _deletingAgents.delete(agentId);
      state.requestUpdate();
    }
  };

  const renderAgentGroup = (agentId, groupSessions) => {
    // Ensure every agent has its main session entry
    const agentMainKey = `agent:${agentId}:main`;
    const hasMainSession = groupSessions.some((s) => s.key === agentMainKey);
    if (!hasMainSession) {
      groupSessions.unshift({
        key: agentMainKey,
        _displayName: "MAIN",
        _implicit: true,
      });
    }

    const collapsed = state._collapsedAgents?.has(agentId);
    const isMain = agentId === "main";

    const toggleCollapse = () => {
      const set = new Set(state._collapsedAgents ?? []);
      if (set.has(agentId)) {
        set.delete(agentId);
      } else {
        set.add(agentId);
      }
      state._collapsedAgents = set;
      state.requestUpdate();
    };

    return html`
      <div class="session-group ${collapsed ? "session-group--collapsed" : ""}">
        <button class="session-group__header" aria-expanded=${!collapsed} @click=${toggleCollapse}>
          <span class="session-group__chevron">${collapsed ? "\u25B6" : "\u25BC"}</span>
          <span class="session-group__name">${agentLabel(agentId)}</span>
          <span class="session-group__count">${groupSessions.length}</span>
        </button>
        ${
          !isMain
            ? html`
          <span
            class="session-group__close"
            role="button"
            aria-label="Delete ${agentLabel(agentId)}"
            @click=${(e) => {
              e.stopPropagation();
              deleteAgent(agentId);
            }}
          >${icons.x}</span>
        `
            : nothing
        }
        <div class="session-group__items">
          ${repeat(groupSessions, (s) => s.key, renderSessionItem)}
        </div>
      </div>
    `;
  };

  return html`
    <div class="session-tree">
      <div class="session-tree__header">
        <span class="session-tree__title">Sessions</span>
        <button
          class="session-tree__new"
          ?disabled=${!state.connected || busy}
          title="New session"
          @click=${() => switchToNewSession(state)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14"></path><path d="M5 12h14"></path>
          </svg>
        </button>
      </div>
      <div class="session-tree__list">
        ${agentIds.map((id) => renderAgentGroup(id, agents.get(id) ?? []))}
      </div>
    </div>
  `;
}
