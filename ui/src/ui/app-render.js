/**
 * Build a Map of agentId → display name from the agents list.
 * @param {object} state
 * @returns {Map<string, string>}
 */
const buildAgentNameMap = (state) => {
  const list = state.agentsList?.agents ?? [];
  const map = new Map();
  for (const agent of list) {
    const name = agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
    map.set(agent.id, name);
  }
  return map;
};
/** Resolve the last pending tool call (no output yet) for activity hint. */
const resolveActiveTool = (state) => {
  for (let i = state.toolStreamOrder.length - 1; i >= 0; i--) {
    const entry = state.toolStreamById.get(state.toolStreamOrder[i]);
    if (entry && !entry.output) {
      return { name: entry.name, args: entry.args };
    }
  }
  return null;
};
const resolveAssistantAvatarUrl = (state) => {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
};
import { html, nothing } from "lit";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { t } from "../i18n/index.js";
import { refreshChatAvatar, switchToNewSession } from "./app-chat.js";
import { renderChatControls, renderThemeToggle } from "./app-render.helpers.js";
import { loadAgents } from "./controllers/agents.js";
import { loadBoard } from "./controllers/board.js";
import { loadChannels } from "./controllers/channels.js";
import { loadChatHistory } from "./controllers/chat.js";
import { runUpdate } from "./controllers/config.js";
import { loadCronJobs, loadCronStatus } from "./controllers/cron.js";
import { loadSessions } from "./controllers/sessions.js";
import { icons } from "./icons.js";
import { renderChannelSetupOverlay } from "./views/channel-setup-overlay.js";
import { renderChat } from "./views/chat.js";
import { renderCronBoardOverlay } from "./views/cron-board-overlay.js";
import { renderExecApprovalPrompt } from "./views/exec-approval.js";
import { renderFileApprovalPrompt } from "./views/file-approval.js";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.js";
import { renderLogsViewOverlay } from "./views/logs-view-overlay.js";
import { renderNostrProfileOverlay } from "./views/nostr-profile-overlay.js";
import { renderSessionTree } from "./views/session-tree.js";
import { renderSettingsModal, openSettingsModal } from "./views/settings-modal.js";
import { renderWebAuthnRegistrationOverlay } from "./views/webauthn-registration-overlay.js";
import { renderWhatsAppQrOverlay } from "./views/whatsapp-qr-overlay.js";
const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
export function renderApp(state) {
  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const showThinking = !state.onboarding;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  return html`
    <div class="shell ${isChat ? "shell--chat" : ""} ${chatFocus ? "shell--chat-focus" : ""} ${state.settings.navCollapsed ? "shell--nav-collapsed" : ""} ${state.onboarding ? "shell--onboarding" : ""}"
      style="${state.settings.navWidth ? `--shell-nav-width: ${state.settings.navWidth}px` : ""}"
    >
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="nav-collapse-toggle"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
            aria-label="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
          >
            <span class="nav-collapse-toggle__icon">${icons.menu}</span>
          </button>
          <div class="brand">
            <div class="brand-title">GATEWAY</div>
          </div>
        </div>
        <div class="topbar-status">
          <button
            class="topbar-connection-btn"
            title="Cron Board"
            ?disabled=${!state.connected}
            @click=${async () => {
              if ((state.cronBoardQueue ?? []).length > 0) {
                return;
              }
              const id = `ui-board-${Date.now()}`;
              state.cronBoardQueue = [
                { id, createdAtMs: Date.now(), expiresAtMs: Date.now() + 3600000 },
              ];
              state.cronBoardError = null;
              await Promise.all([
                loadSessions(state),
                loadCronJobs(state),
                loadCronStatus(state),
                loadAgents(state),
                loadChannels(state, false),
              ]);
              loadBoard(state);
            }}
          >
            ${icons.kanban}
          </button>
          <button
            class="topbar-connection-btn"
            title="Settings"
            @click=${() => openSettingsModal(state, state.settingsModalTab ?? "gateway")}
          >
            ${icons.settings}
          </button>
          ${renderThemeToggle(state)}
        </div>
      </header>
      <aside class="nav">
        ${isChat ? renderSessionTree(state) : nothing}
      </aside>
      <div class="nav-resize-handle"
        @mousedown=${(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = state.settings.navWidth ?? 220;
          const onMove = (ev) => {
            const w = Math.max(160, Math.min(400, startW + (ev.clientX - startX)));
            document.documentElement.style.setProperty("--shell-nav-width-live", `${w}px`);
          };
          const onUp = (ev) => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            document.documentElement.style.removeProperty("--shell-nav-width-live");
            const w = Math.max(160, Math.min(400, startW + (ev.clientX - startX)));
            state.applySettings({ ...state.settings, navWidth: w });
          };
          document.body.style.userSelect = "none";
          document.body.style.cursor = "col-resize";
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      ></div>
      <main class="content ${isChat ? "content--chat" : ""}">
        ${
          state.updateAvailable
            ? html`<div class="update-banner callout danger" role="alert">
              <strong>Update available:</strong> v${state.updateAvailable.latestVersion}
              (running v${state.updateAvailable.currentVersion}).
              <button
                class="btn btn--sm update-banner__btn"
                ?disabled=${state.updateRunning || !state.connected}
                @click=${() => runUpdate(state)}
              >${state.updateRunning ? "Updating\u2026" : "Update now"}</button>
            </div>`
            : nothing
        }
        ${
          isChat
            ? html`
          <section class="content-header">
            <div class="page-meta">
              ${renderChatControls(state)}
            </div>
          </section>
        `
            : state.lastError
              ? html`
          <div class="callout danger">${state.lastError}</div>
        `
              : nothing
        }


        ${
          state.tab === "chat"
            ? renderChat({
                sessionKey: state.sessionKey,
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessages = [];
                  state.chatMessage = "";
                  state.chatAttachments = [];
                  state.chatStream = null;
                  state.chatStreamStartedAt = null;
                  state.chatRunId = null;
                  state.chatQueue = [];
                  state.resetToolStream();
                  state.resetChatScroll();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  state.loadAssistantIdentity();
                  loadChatHistory(state);
                  refreshChatAvatar(state);
                },
                thinkingLevel: state.chatThinkingLevel,
                showThinking,
                loading: state.chatLoading,
                sending: state.chatSending,
                compactionStatus: state.compactionStatus,
                assistantAvatarUrl: chatAvatarUrl,
                messages: state.chatMessages,
                toolMessages: state.chatToolMessages,
                activeTool: resolveActiveTool(state),
                stream: state.chatStream,
                streamStartedAt: state.chatStreamStartedAt,
                draft: state.chatMessage,
                queue: state.chatQueue,
                connected: state.connected,
                canSend: state.connected,
                disabledReason: chatDisabledReason,
                error: state.lastError,
                sessions: state.sessionsResult,
                focusMode: chatFocus,
                onRefresh: () => {
                  state.resetToolStream();
                  return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
                },
                onToggleFocusMode: () => {
                  if (state.onboarding) {
                    return;
                  }
                  state.applySettings({
                    ...state.settings,
                    chatFocusMode: !state.settings.chatFocusMode,
                  });
                },
                onChatScroll: (event) => state.handleChatScroll(event),
                onDraftChange: (next) => (state.chatMessage = next),
                attachments: state.chatAttachments,
                onAttachmentsChange: (next) => (state.chatAttachments = next),
                onSend: () => state.handleSendChat(),
                canAbort: Boolean(state.chatRunId),
                onAbort: () => void state.handleAbortChat(),
                onQueueRemove: (id) => state.removeQueuedMessage(id),
                onQueueInterrupt: () => void state.handleAbortChat(),
                onNewSession: () => switchToNewSession(state),
                showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                onScrollToBottom: () => state.scrollToBottom(),
                sidebarOpen: state.sidebarOpen,
                sidebarContent: state.sidebarContent,
                sidebarError: state.sidebarError,
                splitRatio: state.splitRatio,
                onOpenSidebar: (content) => state.handleOpenSidebar(content),
                onCloseSidebar: () => state.handleCloseSidebar(),
                onSplitRatioChange: (ratio) => state.handleSplitRatioChange(ratio),
                assistantName: state.assistantName,
                agentNames: buildAgentNameMap(state),
                ownerDisplayName: state.ownerDisplayName ?? null,
                assistantAvatar: state.assistantAvatar,
                lastRunStats: state.lastRunStats ?? null,
                activeModel: state.chatActiveModel ?? null,
                client: state.client ?? null,
              })
            : nothing
        }


      </main>
      ${renderSettingsModal(state)}
      ${renderCronBoardOverlay(state)}
      ${renderLogsViewOverlay(state)}
      ${renderWebAuthnRegistrationOverlay(state)}
      ${renderWhatsAppQrOverlay(state)}
      ${renderNostrProfileOverlay(state)}
      ${renderChannelSetupOverlay(state)}
      ${renderFileApprovalPrompt(state)}
      ${renderExecApprovalPrompt(state)}
      ${renderGatewayUrlConfirmation(state)}
    </div>
  `;
}
