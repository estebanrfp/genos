let resolveSidebarChatSessionKey = function (state) {
    const snapshot = state.hello?.snapshot;
    const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
    if (mainSessionKey) {
      return mainSessionKey;
    }
    const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
    if (mainKey) {
      return mainKey;
    }
    return "main";
  },
  resetChatStateForSessionSwitch = function (state, sessionKey) {
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
  },
  capitalize = function (s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  renderSunIcon = function () {
    return html`
      <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4"></circle>
        <path d="M12 2v2"></path>
        <path d="M12 20v2"></path>
        <path d="m4.93 4.93 1.41 1.41"></path>
        <path d="m17.66 17.66 1.41 1.41"></path>
        <path d="M2 12h2"></path>
        <path d="M20 12h2"></path>
        <path d="m6.34 17.66-1.41 1.41"></path>
        <path d="m19.07 4.93-1.41 1.41"></path>
      </svg>
    `;
  },
  renderMoonIcon = function () {
    return html`
      <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
        ></path>
      </svg>
    `;
  },
  renderMonitorIcon = function () {
    return html`
      <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="20" height="14" x="2" y="3" rx="2"></rect>
        <line x1="8" x2="16" y1="21" y2="21"></line>
        <line x1="12" x2="12" y1="17" y2="21"></line>
      </svg>
    `;
  };
import { html } from "lit";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { isChatBusy } from "./app-chat.js";
import { icons } from "./icons.js";
import { iconForTab, pathForTab, subtitleForTab, titleForTab } from "./navigation.js";
export function renderTab(state, tab) {
  const href = pathForTab(tab, state.basePath);
  return html`
    <a
      href=${href}
      class="nav-item ${state.tab === tab ? "active" : ""}"
      @click=${(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        if (tab === "chat") {
          const mainSessionKey = resolveSidebarChatSessionKey(state);
          if (state.sessionKey !== mainSessionKey) {
            resetChatStateForSessionSwitch(state, mainSessionKey);
            state.loadAssistantIdentity();
          }
        }
        state.setTab(tab);
      }}
      title="${titleForTab(tab)} — ${subtitleForTab(tab)}"
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__text">${titleForTab(tab)}</span>
    </a>
  `;
}
let _compactInFlight = false;
let _resetInFlight = false;
export const isResetInFlight = () => _resetInFlight;
export function renderChatControls(state) {
  const currentSession = state.sessionsResult?.sessions?.find((s) => s.key === state.sessionKey);
  const busy = isChatBusy(state);
  const isCompacting = _compactInFlight && busy;
  if (!busy) {
    _compactInFlight = false;
    _resetInFlight = false;
  }

  const parsedKey = parseAgentSessionKey(state.sessionKey);
  const agentId = parsedKey?.agentId ?? "default";
  const agentEntry = (state.agentsList?.agents ?? []).find((a) => a.id === agentId);
  const agentName = agentEntry?.identity?.emoji
    ? `${agentEntry.identity.emoji} ${agentEntry?.name ?? agentEntry?.identity?.name ?? agentId}`
    : (agentEntry?.name ?? agentEntry?.identity?.name ?? agentId);
  const sessionTitle = resolveSessionDisplayName(state.sessionKey, currentSession);

  return html`
    <div class="chat-controls">

      <!-- ── Session title (left) ────────────── -->
      <span class="chat-controls__title"><span class="chat-controls__agent">${agentName}</span> / ${sessionTitle}</span>

      <!-- ── Controls (right) ────────────────── -->
      <div class="chat-controls__right">

        <!-- Compact -->
        <button
          class="btn btn--sm btn--icon btn--compact ${isCompacting ? "is-loading" : ""}"
          ?disabled=${!state.connected || busy}
          title=${isCompacting ? "Compacting\u2026" : "Compact session"}
          @click=${() => {
            if (!isCompacting) {
              _compactInFlight = true;
              state.handleSendChat?.("/compact");
            }
          }}
        >
          <span class="btn-loading-state">
            <span class="btn-spinner"></span>
            <svg class="btn-compact-inner-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline>
              <line x1="10" y1="14" x2="3" y2="21"></line><line x1="21" y1="3" x2="14" y2="10"></line>
            </svg>
          </span>
          <svg class="btn-compact-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline>
            <line x1="10" y1="14" x2="3" y2="21"></line><line x1="21" y1="3" x2="14" y2="10"></line>
          </svg>
        </button>

        <!-- Reset session -->
        <button
          class="btn btn--sm btn--icon"
          ?disabled=${!state.connected || busy}
          title="Reset session"
          @click=${() => {
            _resetInFlight = true;
            state.handleSendChat?.("/reset");
          }}
        ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg></button>

      </div>

    </div>
  `;
}
const CHANNEL_LABELS = {
  bluebubbles: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  signal: "Signal",
  slack: "Slack",
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  email: "Email",
  sms: "SMS",
};
const KNOWN_CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);
export function parseSessionKey(key) {
  if (key === "main" || key === "agent:main:main" || key === "agent:default:main") {
    return { prefix: "", fallbackName: "Main Session" };
  }
  // Any agent's main session → show just "Main"
  const agentMainMatch = key.match(/^agent:[^:]+:main$/);
  if (agentMainMatch) {
    return { prefix: "", fallbackName: "Main" };
  }
  if (key.includes(":subagent:")) {
    return { prefix: "", fallbackName: "Subagent" };
  }
  if (key.includes(":cron:")) {
    return { prefix: "Cron:", fallbackName: "Cron Job:" };
  }
  const directMatch = key.match(/^agent:[^:]+:([^:]+):direct:(.+)$/);
  if (directMatch) {
    const channel = directMatch[1];
    const identifier = directMatch[2];
    const channelLabel = (CHANNEL_LABELS[channel] ?? channel).toUpperCase();
    return { prefix: "", fallbackName: `${channelLabel}: ${identifier}` };
  }
  const groupMatch = key.match(/^agent:[^:]+:([^:]+):group:(.+)$/);
  if (groupMatch) {
    const channel = groupMatch[1];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} Group` };
  }
  // Generic agent session → strip the agent prefix, show only the session part
  const agentGeneric = key.match(/^agent:[^:]+:(.+)$/);
  if (agentGeneric) {
    return { prefix: "", fallbackName: agentGeneric[1] };
  }
  for (const ch of KNOWN_CHANNEL_KEYS) {
    if (key === ch || key.startsWith(`${ch}:`)) {
      const rest = key.slice(ch.length + 1);
      // Flat gateway keys: "g-agent-main-whatsapp-direct-+34..." → extract identifier
      const directIdx = rest.lastIndexOf("direct-");
      if (directIdx >= 0) {
        const identifier = rest.slice(directIdx + 7);
        if (identifier) {
          return {
            prefix: "",
            fallbackName: `${(CHANNEL_LABELS[ch] ?? ch).toUpperCase()}: ${identifier}`,
          };
        }
      }
      const groupIdx = rest.lastIndexOf("group-");
      if (groupIdx >= 0) {
        return { prefix: "", fallbackName: `${CHANNEL_LABELS[ch] ?? capitalize(ch)} Group` };
      }
      return { prefix: "", fallbackName: `${CHANNEL_LABELS[ch]} Session` };
    }
  }
  return { prefix: "", fallbackName: key };
}
export function resolveSessionDisplayName(key, row) {
  const label = row?.label?.trim() || "";
  const displayName = row?.displayName?.trim() || "";
  const { prefix, fallbackName } = parseSessionKey(key);
  const applyTypedPrefix = (name) => {
    if (!prefix) {
      return name;
    }
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*`, "i");
    return prefixPattern.test(name) ? name : `${prefix} ${name}`;
  };
  const keyLower = key.toLowerCase();
  if (label && label.toLowerCase() !== keyLower) {
    return applyTypedPrefix(label);
  }
  if (displayName && displayName.toLowerCase() !== keyLower) {
    return applyTypedPrefix(displayName);
  }
  return fallbackName;
}
const THEME_ORDER = ["system", "light", "dark"];
const THEME_ICONS = { system: renderMonitorIcon, light: renderSunIcon, dark: renderMoonIcon };
const THEME_LABELS = { system: "System", light: "Light", dark: "Dark" };
export function renderThemeToggle(state) {
  const current = THEME_ORDER.indexOf(state.theme) >= 0 ? state.theme : "system";
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  return html`
    <button
      class="btn btn--sm btn--icon"
      title="${THEME_LABELS[current]}"
      aria-label="Theme: ${THEME_LABELS[current]}"
      @click=${(e) => {
        const context = { element: e.currentTarget };
        if (e.clientX || e.clientY) {
          context.pointerClientX = e.clientX;
          context.pointerClientY = e.clientY;
        }
        state.setTheme(next, context);
      }}
    >${THEME_ICONS[current]()}</button>
  `;
}
