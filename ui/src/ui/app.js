import { __decorateClass as __decorateClass_48d94f0e55ed4dd4 } from "bun:wrap";
let resolveOnboardingMode = function () {
  if (!window.location.search) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("onboarding");
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};
import { startRegistration } from "@simplewebauthn/browser";
import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { i18n, I18nController, isSupportedLocale } from "../i18n/index.js";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat.js";
import { DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults.js";
import { connectGateway as connectGatewayInternal } from "./app-gateway.js";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle.js";
import { renderApp } from "./app-render.js";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.js";
import {
  applySettings as applySettingsInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  onPopState as onPopStateInternal,
} from "./app-settings.js";
import { resetToolStream as resetToolStreamInternal } from "./app-tool-stream.js";
import { normalizeAssistantIdentity } from "./assistant-identity.js";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity.js";
import { loadSettings } from "./storage.js";
import { authenticateWithWebAuthn, webauthnFetch } from "./views/webauthn-panel.js";
const bootAssistantIdentity = normalizeAssistantIdentity({});

export class GenosOSApp extends LitElement {
  i18nController = new I18nController(this);
  constructor() {
    super();
    this.settings = loadSettings();
    this.tab = "chat";
    this.onboarding = resolveOnboardingMode();
    this.connected = false;
    this.theme = this.settings.theme ?? "system";
    this.themeResolved = "dark";
    this.hello = null;
    this.lastError = null;
    this.eventLog = [];
    this.assistantName = bootAssistantIdentity.name;
    this.assistantAvatar = bootAssistantIdentity.avatar;
    this.assistantAgentId = bootAssistantIdentity.agentId ?? null;
    this.sessionKey = this.settings.sessionKey;
    this.chatLoading = false;
    this.chatSending = false;
    this.chatMessage = "";
    this.chatMessages = [];
    this.chatToolMessages = [];
    this.chatStream = null;
    this.chatStreamStartedAt = null;
    this.chatRunId = null;
    this.compactionStatus = null;
    this.chatAvatarUrl = null;
    this.chatThinkingLevel = null;
    this.chatQueue = [];
    this.chatAttachments = [];
    this.chatManualRefreshInFlight = false;
    this.sidebarOpen = false;
    this.sidebarContent = null;
    this.sidebarError = null;
    this.splitRatio = this.settings.splitRatio;
    this.execApprovalQueue = [];
    this.execApprovalBusy = false;
    this.execApprovalError = null;
    this.fileApprovalQueue = [];
    this.fileApprovalBusy = false;
    this.fileApprovalError = null;
    this.webauthnRegQueue = [];
    this.webauthnRegBusy = false;
    this.webauthnRegError = null;
    this.whatsappQrQueue = [];
    this.whatsappQrBusy = false;
    this.whatsappQrError = null;
    this.nostrEditQueue = [];
    this.nostrEditBusy = false;
    this.nostrEditError = null;
    this.nostrEditFormState = null;
    this.cronBoardQueue = [];
    this.cronBoardBusy = false;
    this.cronBoardError = null;
    this.logsViewQueue = [];
    this.logsViewBusy = false;
    this.logsViewError = null;
    this.filesBrowserQueue = [];
    this.filesBrowserBusy = false;
    this.filesBrowserError = null;
    this.channelSetupQueue = [];
    this.channelSetupBusy = false;
    this.channelSetupError = null;
    this.channelSetupQr = null;
    this.channelSetupQrLoading = false;
    this.channelSetupQrWaiting = false;
    this.channelSetupUnlinking = false;
    this.unlockedTabs = new Set();
    this.tabLockBusy = false;
    this.pendingGatewayUrl = null;
    this.connectionModalOpen = false;
    this.healthModalOpen = false;
    this.configModalOpen = false;
    this.configEditorOpen = false;
    this.settingsModalOpen = false;
    this.settingsModalTab = "gateway";
    this.configLoading = false;
    this.configRaw = "{\n}\n";
    this.configRawOriginal = "";
    this.configValid = null;
    this.configIssues = [];
    this.configSaving = false;
    this.configApplying = false;
    this.updateRunning = false;
    this.applySessionKey = this.settings.lastActiveSessionKey;
    this.configSnapshot = null;
    this.configSchema = null;
    this.configSchemaVersion = null;
    this.configSchemaLoading = false;
    this.configUiHints = {};
    this.configForm = null;
    this.configFormOriginal = null;
    this.configFormDirty = false;
    this.configFormMode = "form";
    this.configSearchQuery = "";
    this.configActiveSection = null;
    this.configActiveSubsection = null;
    this.channelsLoading = false;
    this.channelsSnapshot = null;
    this.channelsError = null;
    this.channelsLastSuccess = null;
    this.agentsLoading = false;
    this.agentsList = null;
    this.agentsError = null;
    this.agentsSelectedId = null;
    this.agentFilesLoading = false;
    this.agentFilesError = null;
    this.agentFilesList = null;
    this.agentFileContents = {};
    this.agentFileDrafts = {};
    this.agentFileActive = null;
    this.agentFileSaving = false;
    this.agentIdentityLoading = false;
    this.agentIdentityError = null;
    this.agentIdentityById = {};
    this.agentSkillsLoading = false;
    this.agentSkillsError = null;
    this.agentSkillsReport = null;
    this.agentSkillsAgentId = null;
    this.sessionsLoading = false;
    this.sessionsResult = null;
    this.sessionsError = null;
    this._collapsedAgents = new Set();
    this.boardSection = "kanban";
    this.boardColumns = null;
    this.boardSearchQuery = "";
    this.boardSearchResults = [];
    this.boardActivityFilter = "all";
    this.cronLoading = false;
    this.cronJobs = [];
    this.cronStatus = null;
    this.cronError = null;
    this.cronRunsJobId = null;
    this.cronRuns = [];
    this.cronBusy = false;
    this.updateAvailable = null;
    this.skillsLoading = false;
    this.skillsReport = null;
    this.skillsError = null;
    this.skillsFilter = "";
    this.skillEdits = {};
    this.skillsBusyKey = null;
    this.skillMessages = {};
    this.logsLoading = false;
    this.logsError = null;
    this.logsFile = null;
    this.logsEntries = [];
    this.logsFilterText = "";
    this.logsLevelFilters = {
      ...DEFAULT_LOG_LEVEL_FILTERS,
    };
    this.logsAutoFollow = true;
    this.logsTruncated = false;
    this.logsCursor = null;
    this.logsLastFetchAt = null;
    this.logsLimit = 500;
    this.logsMaxBytes = 250000;
    this.logsAtBottom = true;
    this.chatNewMessagesBelow = false;
    this.chatActiveModel = null;
    if (isSupportedLocale(this.settings.locale)) {
      i18n.setLocale(this.settings.locale);
    }
  }
  eventLogBuffer = [];
  toolStreamSyncTimer = null;
  sidebarCloseTimer = null;
  client = null;
  chatScrollFrame = null;
  chatScrollTimeout = null;
  chatHasAutoScrolled = false;
  chatUserNearBottom = true;
  logsPollInterval = null;
  logsScrollFrame = null;
  toolStreamById = new Map();
  toolStreamOrder = [];
  refreshSessionsAfterChat = new Set();
  basePath = "";
  popStateHandler = () => onPopStateInternal(this);
  themeMedia = null;
  themeMediaHandler = null;
  topbarObserver = null;
  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    handleConnected(this);
  }
  firstUpdated() {
    handleFirstUpdated(this);
  }
  disconnectedCallback() {
    handleDisconnected(this);
    super.disconnectedCallback();
  }
  updated(changed) {
    handleUpdated(this, changed);
  }
  connect() {
    connectGatewayInternal(this);
  }
  handleChatScroll(event) {
    handleChatScrollInternal(this, event);
  }
  handleLogsScroll(event) {
    handleLogsScrollInternal(this, event);
  }
  exportLogs(lines, label) {
    exportLogsInternal(lines, label);
  }
  resetToolStream() {
    resetToolStreamInternal(this);
  }
  resetChatScroll() {
    resetChatScrollInternal(this);
  }
  scrollToBottom(opts) {
    resetChatScrollInternal(this);
    scheduleChatScrollInternal(this, true, Boolean(opts?.smooth));
  }
  async loadAssistantIdentity() {
    await loadAssistantIdentityInternal(this);
  }
  applySettings(next) {
    applySettingsInternal(this, next);
  }
  setTab(next) {
    setTabInternal(this, next);
  }
  setTheme(next, context) {
    setThemeInternal(this, next, context);
  }
  dismissCronBoard(id) {
    this.cronBoardError = null;
    if (!id?.startsWith("ui-")) {
      this.client?.request("cron.board.complete", { id }).catch(() => {});
    }
    this.cronBoardQueue = (this.cronBoardQueue ?? []).filter((e) => e.id !== id);
  }
  async dismissLogsView(id) {
    if (this.logsViewBusy) {
      return;
    }
    this.logsViewBusy = true;
    this.logsViewError = null;
    try {
      await this.client?.request("logs.view.complete", { id });
      this.logsViewQueue = (this.logsViewQueue ?? []).filter((e) => e.id !== id);
    } catch (err) {
      this.logsViewError = `Logs view dismiss failed: ${String(err)}`;
    } finally {
      this.logsViewBusy = false;
    }
  }
  async dismissFilesBrowser(id) {
    if (this.filesBrowserBusy) {
      return;
    }
    this.filesBrowserBusy = true;
    this.filesBrowserError = null;
    try {
      await this.client?.request("files.browser.complete", { id });
      this.filesBrowserQueue = (this.filesBrowserQueue ?? []).filter((e) => e.id !== id);
    } catch (err) {
      this.filesBrowserError = `Files browser dismiss failed: ${String(err)}`;
    } finally {
      this.filesBrowserBusy = false;
    }
  }
  async handleAbortChat() {
    await handleAbortChatInternal(this);
  }
  removeQueuedMessage(id) {
    removeQueuedMessageInternal(this, id);
  }
  async handleSendChat(messageOverride, opts) {
    await handleSendChatInternal(this, messageOverride, opts);
  }
  async handleExecApprovalDecision(decision) {
    const active = this.execApprovalQueue[0];
    if (!active || !this.client || this.execApprovalBusy) {
      return;
    }
    this.execApprovalBusy = true;
    this.execApprovalError = null;
    try {
      await this.client.request("exec.approval.resolve", {
        id: active.id,
        decision,
      });
      this.execApprovalQueue = this.execApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.execApprovalError = `Exec approval failed: ${String(err)}`;
    } finally {
      this.execApprovalBusy = false;
    }
  }
  async handleFileApprovalDecision(id, decision) {
    const active =
      (this.fileApprovalQueue ?? []).find((e) => e.id === id) ?? this.fileApprovalQueue?.[0];
    if (!active || !this.client || this.fileApprovalBusy) {
      return;
    }
    this.fileApprovalBusy = true;
    this.fileApprovalError = null;
    try {
      if (decision === "approve") {
        const token = await authenticateWithWebAuthn();
        if (!token) {
          this.fileApprovalError = "Touch ID / Face ID authentication required.";
          return;
        }
        await this.client.request("agents.files.approve", {
          id: active.id,
          webauthnSessionToken: token,
        });
      } else {
        await this.client.request("agents.files.deny", { id: active.id });
      }
      this.fileApprovalQueue = (this.fileApprovalQueue ?? []).filter((e) => e.id !== active.id);
    } catch (err) {
      this.fileApprovalError = `File approval failed: ${String(err)}`;
    } finally {
      this.fileApprovalBusy = false;
    }
  }
  /**
   * Handle WebAuthn registration triggered by agent via gateway event.
   * @param {string} id - Pending registration id
   */
  async handleWebAuthnRegistration(id) {
    if (this.webauthnRegBusy) {
      return;
    }
    this.webauthnRegBusy = true;
    this.webauthnRegError = null;
    try {
      const token = this.settings.token;
      const optionsRes = await webauthnFetch(
        "register/options",
        { displayName: "Touch ID" },
        token,
      );
      if (optionsRes.error) {
        throw new Error(optionsRes.error.message);
      }
      const attestation = await startRegistration({ optionsJSON: optionsRes.options });
      const verifyRes = await webauthnFetch(
        "register/verify",
        { challengeKey: optionsRes.challengeKey, attestation, displayName: "Touch ID" },
        token,
      );
      if (verifyRes.error) {
        throw new Error(verifyRes.error.message);
      }
      await this.client?.request("webauthn.register.complete", {
        id,
        success: true,
        credentialId: verifyRes.credentialId,
      });
      this.webauthnRegQueue = this.webauthnRegQueue.filter((e) => e.id !== id);
    } catch (err) {
      if (err?.name === "NotAllowedError") {
        await this.client?.request("webauthn.register.complete", {
          id,
          success: false,
          error: "cancelled",
        });
        this.webauthnRegQueue = this.webauthnRegQueue.filter((e) => e.id !== id);
      } else {
        this.webauthnRegError = err?.message ?? "Registration failed";
        await this.client?.request("webauthn.register.complete", {
          id,
          success: false,
          error: err?.message,
        });
        this.webauthnRegQueue = this.webauthnRegQueue.filter((e) => e.id !== id);
      }
    } finally {
      this.webauthnRegBusy = false;
    }
  }
  dismissWebAuthnRegistration(id) {
    this.client?.request("webauthn.register.complete", { id, success: false, error: "dismissed" });
    this.webauthnRegQueue = this.webauthnRegQueue.filter((e) => e.id !== id);
  }
  /**
   * Handle WhatsApp QR scan confirmation from overlay.
   * Calls web.login.wait then resolves the pending QR login.
   * @param {string} id - Pending QR login id
   */
  async handleWhatsAppQrWait(id) {
    if (this.whatsappQrBusy || !this.client) {
      return;
    }
    this.whatsappQrBusy = true;
    this.whatsappQrError = null;
    try {
      const res = await this.client.request("web.login.wait", { timeoutMs: 120000 });
      const connected = res?.connected === true;
      await this.client.request("whatsapp.qr.complete", {
        id,
        success: connected,
        ...(connected ? {} : { error: "not connected" }),
      });
      this.whatsappQrQueue = this.whatsappQrQueue.filter((e) => e.id !== id);
    } catch (err) {
      this.whatsappQrError = err?.message ?? "QR login failed";
      await this.client?.request("whatsapp.qr.complete", {
        id,
        success: false,
        error: err?.message,
      });
      this.whatsappQrQueue = this.whatsappQrQueue.filter((e) => e.id !== id);
    } finally {
      this.whatsappQrBusy = false;
    }
  }
  dismissWhatsAppQr(id) {
    this.client?.request("whatsapp.qr.complete", { id, success: false, error: "dismissed" });
    this.whatsappQrQueue = this.whatsappQrQueue.filter((e) => e.id !== id);
  }
  /**
   * Start QR generation for channel setup overlay.
   * @param {string} id - Pending setup id
   * @param {object} _step - Descriptor step
   */
  async handleChannelSetupQrStart(id, _step) {
    if (this.channelSetupQrLoading || !this.client) {
      return;
    }
    this.channelSetupQrLoading = true;
    this.channelSetupError = null;
    try {
      // Clean stale credentials before QR to avoid auto-restart loops
      const active = (this.channelSetupQueue ?? []).find((e) => e.id === id);
      if (active && !active.state?.linked) {
        await this.client
          .request("channels.logout", { channel: active.channel ?? "whatsapp" })
          .catch(() => {});
      }
      const res = await this.client.request("web.login.start", { force: true, timeoutMs: 60000 });
      this.channelSetupQr = res?.qrDataUrl ?? res?.qr ?? null;
      if (!this.channelSetupQr) {
        this.channelSetupError = "No QR code received. WhatsApp may need a gateway restart.";
      }
    } catch (err) {
      this.channelSetupError = err?.message ?? "QR generation failed";
    } finally {
      this.channelSetupQrLoading = false;
    }
    // Auto-wait for scan after QR is shown
    if (this.channelSetupQr) {
      this.handleChannelSetupQrWait(id, _step);
    }
  }
  /**
   * Wait for QR scan confirmation in channel setup overlay.
   * @param {string} id - Pending setup id
   * @param {object} _step - Descriptor step
   */
  async handleChannelSetupQrWait(id, _step) {
    if (this.channelSetupQrWaiting || !this.client) {
      return;
    }
    this.channelSetupQrWaiting = true;
    this.channelSetupError = null;
    try {
      const res = await this.client.request("web.login.wait", { timeoutMs: 120000 });
      if (res?.connected) {
        // Auto-close modal on successful link
        this.chatMessages = [
          ...(this.chatMessages ?? []),
          {
            role: "assistant",
            content: [{ type: "text", text: "Whatsapp linked successfully." }],
            timestamp: Date.now(),
            __genosos: { kind: "system-instruction" },
          },
        ];
        this._closeChannelSetup(id);
        return;
      }
      this.channelSetupQr = null;
      this.channelSetupError = res?.message ?? "WhatsApp not connected. Try scanning again.";
    } catch (err) {
      this.channelSetupQr = null;
      this.channelSetupError = err?.message ?? "QR scan failed";
    } finally {
      this.channelSetupQrWaiting = false;
    }
  }
  /**
   * Unlink channel account from within the setup wizard.
   * Calls channels.logout, then updates local state so the QR step becomes visible.
   * @param {object} active - Queue entry
   */
  async handleChannelSetupUnlink(active, step) {
    if (this.channelSetupUnlinking || !this.client) {
      return;
    }
    this.channelSetupUnlinking = true;
    this.channelSetupError = null;
    try {
      const channel = active.channel ?? "whatsapp";
      const accountId = active.state?.accountId;
      if (step?.unlinkAction === "disable") {
        active._advancing = true;
        await this.client.request("channel.setup.complete", {
          id: active.id,
          channel,
          answers: { action: "disable" },
        });
        active._advancing = false;
      } else {
        await this.client.request("channels.logout", {
          channel,
          ...(accountId ? { accountId } : {}),
        });
      }
      if (active.state) {
        active.state.linked = false;
        active.state.configured = false;
        active.state.needsPairing = false;
      }
      this.channelSetupTokenValue = "";
      this.channelSetupPairingValue = "";
      this._qrAutoStarted = false;
      this.channelSetupQueue = [...(this.channelSetupQueue ?? [])];
    } catch (err) {
      this.channelSetupError = err?.message ?? "Unlink failed";
    } finally {
      this.channelSetupUnlinking = false;
    }
  }
  /**
   * Submit token for channel setup (Telegram and similar).
   * Calls channel.setup.complete with the token, validates server-side.
   * @param {string} id - Pending setup id
   */
  async handleChannelSetupTokenSubmit(id) {
    const active = (this.channelSetupQueue ?? []).find((e) => e.id === id);
    if (!active || this.channelSetupBusy || !this.client) {
      return;
    }
    const token = (this.channelSetupTokenValue ?? "").trim();
    if (!token) {
      this.channelSetupError = "Paste a bot token first.";
      return;
    }
    // Check if we need to advance to pairing step BEFORE calling server
    const hasPairingStep = active.descriptor?.steps?.some((s) => s.type === "pairing-input");
    // Protect entry from broadcast removal while advancing
    active._advancing = true;
    this.channelSetupBusy = true;
    this.channelSetupError = null;
    let res;
    try {
      res = await this.client.request("channel.setup.complete", {
        id,
        channel: active.channel,
        answers: { token },
        accountId: active.state?.accountId,
      });
      if (res?.writeResult?.ok === false) {
        this.channelSetupError = res.writeResult.error ?? "Token verification failed.";
        this.channelSetupBusy = false;
        active._advancing = false;
        return;
      }
    } catch (err) {
      this.channelSetupError = err?.message ?? "Setup failed";
      this.channelSetupBusy = false;
      active._advancing = false;
      return;
    }
    this.channelSetupBusy = false;
    active._advancing = false;
    // Advance to pairing step by updating state
    if (hasPairingStep && active.state) {
      active.state.configured = true;
      active.state.needsPairing = true;
      active.state.botUsername = res?.writeResult?.botUsername ?? null;
      this.channelSetupQueue = [...(this.channelSetupQueue ?? [])];
      return;
    }
    // Stay open — show linked info step
    if (active.state) {
      active.state.configured = true;
      active.state.botUsername = res?.writeResult?.botUsername ?? null;
    }
    this.channelSetupQueue = [...(this.channelSetupQueue ?? [])];
  }
  /**
   * Submit pairing code for channel setup (Telegram DM approval).
   * Calls channel.pairing.approve with the code, closes modal on success.
   * @param {string} id - Pending setup id
   */
  async handleChannelSetupPairingSubmit(id) {
    const active = (this.channelSetupQueue ?? []).find((e) => e.id === id);
    if (!active || this.channelSetupBusy || !this.client) {
      return;
    }
    const code = (this.channelSetupPairingValue ?? "").trim();
    if (!code) {
      this.channelSetupError = "Paste the pairing code first.";
      return;
    }
    this.channelSetupBusy = true;
    this.channelSetupError = null;
    try {
      const res = await this.client.request("channel.pairing.approve", {
        channel: active.channel,
        code,
        accountId: active.state?.accountId,
      });
      if (!res?.ok) {
        this.channelSetupError = res?.error ?? "Pairing code not recognized.";
        this.channelSetupBusy = false;
        return;
      }
    } catch (err) {
      this.channelSetupError = err?.message ?? "Pairing approval failed";
      this.channelSetupBusy = false;
      return;
    }
    const ch = active.channel ?? "channel";
    this.chatMessages = [
      ...(this.chatMessages ?? []),
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `${ch.charAt(0).toUpperCase() + ch.slice(1)} linked successfully.`,
          },
        ],
        timestamp: Date.now(),
        __genosos: { kind: "system-instruction" },
      },
    ];
    this._closeChannelSetup(id);
  }
  /**
   * Enable a channel from the prereq step (iMessage and similar).
   * Calls channel.setup.complete to write config, closes modal on success.
   * @param {string} id - Pending setup id
   */
  async handleChannelSetupEnable(id) {
    const active = (this.channelSetupQueue ?? []).find((e) => e.id === id);
    if (!active || this.channelSetupBusy || !this.client) {
      return;
    }
    this.channelSetupBusy = true;
    this.channelSetupError = null;
    try {
      active._advancing = true;
      const res = await this.client.request("channel.setup.complete", {
        id,
        channel: active.channel,
        answers: {},
        accountId: active.state?.accountId,
      });
      active._advancing = false;
      if (res?.writeResult?.ok === false) {
        this.channelSetupError = res.writeResult.error ?? "Enable failed.";
        this.channelSetupBusy = false;
        return;
      }
    } catch (err) {
      active._advancing = false;
      this.channelSetupError = err?.message ?? "Enable failed";
      this.channelSetupBusy = false;
      return;
    }
    if (active.state) {
      active.state.configured = true;
    }
    this.channelSetupBusy = false;
    this.channelSetupQueue = [...(this.channelSetupQueue ?? [])];
  }
  /** @param {string} [id] */
  _closeChannelSetup(id) {
    if (id) {
      this.channelSetupQueue = (this.channelSetupQueue ?? []).filter((e) => e.id !== id);
    } else {
      this.channelSetupQueue = [];
    }
    this.channelSetupQr = null;
    this.channelSetupBusy = false;
    this.channelSetupError = null;
    this.channelSetupQrLoading = false;
    this.channelSetupQrWaiting = false;
    this.channelSetupUnlinking = false;
    this.channelSetupTokenValue = "";
    this.channelSetupPairingValue = "";
    this._qrAutoStarted = false;
  }
  /**
   * Dismiss/cancel channel setup overlay.
   * @param {string} id - Pending setup id
   */
  dismissChannelSetup(id) {
    this.client?.request("channel.setup.complete", { id, cancelled: true }).catch(() => {});
    this._closeChannelSetup(id);
  }
  /**
   * Handle Nostr profile save from overlay.
   * PUTs the profile to the API then resolves the pending edit.
   * @param {string} id - Pending profile edit id
   */
  async handleNostrEditSave(id) {
    const active = (this.nostrEditQueue ?? []).find((e) => e.id === id);
    if (!active || this.nostrEditBusy || !this.client) {
      return;
    }
    this.nostrEditBusy = true;
    this.nostrEditError = null;
    try {
      const accountId = active.accountId ?? "default";
      const values = this.nostrEditFormState?.values ?? {};
      const token = this.settings.token;
      const base = this.settings.gatewayUrl?.replace(/\/+$/, "") ?? "";
      const res = await fetch(`${base}/api/channels/nostr/${accountId}/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await this.client.request("nostr.profile.edit.complete", {
        id,
        success: true,
        profile: values,
      });
      this.nostrEditQueue = this.nostrEditQueue.filter((e) => e.id !== id);
      this.nostrEditFormState = null;
    } catch (err) {
      this.nostrEditError = err?.message ?? "Save failed";
    } finally {
      this.nostrEditBusy = false;
    }
  }
  /**
   * Handle Nostr profile import from relays in overlay.
   * @param {string} id - Pending profile edit id
   */
  async handleNostrEditImport(id) {
    const active = (this.nostrEditQueue ?? []).find((e) => e.id === id);
    if (!active || !this.nostrEditFormState) {
      return;
    }
    const accountId = active.accountId ?? "default";
    const token = this.settings.token;
    const base = this.settings.gatewayUrl?.replace(/\/+$/, "") ?? "";
    try {
      this.nostrEditFormState = { ...this.nostrEditFormState, importing: true };
      const res = await fetch(`${base}/api/channels/nostr/${accountId}/profile/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ autoMerge: true }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const imported = data?.profile ?? {};
      const merged = { ...this.nostrEditFormState.values };
      for (const [k, v] of Object.entries(imported)) {
        if (v && !merged[k]) {
          merged[k] = v;
        }
      }
      this.nostrEditFormState = {
        ...this.nostrEditFormState,
        values: merged,
        importing: false,
        success: "Profile imported from relays",
      };
    } catch (err) {
      this.nostrEditFormState = {
        ...this.nostrEditFormState,
        importing: false,
        error: err?.message ?? "Import failed",
      };
    }
  }
  dismissNostrEdit(id) {
    this.client?.request("nostr.profile.edit.complete", { id, success: false, error: "dismissed" });
    this.nostrEditQueue = this.nostrEditQueue.filter((e) => e.id !== id);
    this.nostrEditFormState = null;
  }
  /**
   * Save tools status changes from the overlay.
   * @param {string} id - Pending tools status id
   */
  /**
   * Unlock a protected tab via Touch ID / WebAuthn.
   * @param {string} tabName - The tab to unlock ("files" | "tools" | "config")
   */
  async unlockTab(tabName) {
    if (this.tabLockBusy) {
      return;
    }
    this.tabLockBusy = true;
    try {
      const token = await authenticateWithWebAuthn();
      if (token) {
        this.unlockedTabs = new Set([...this.unlockedTabs, tabName]);
      }
    } catch {
      // biometric cancelled or failed — stay locked
    } finally {
      this.tabLockBusy = false;
    }
  }
  handleGatewayUrlConfirm() {
    const nextGatewayUrl = this.pendingGatewayUrl;
    if (!nextGatewayUrl) {
      return;
    }
    this.pendingGatewayUrl = null;
    applySettingsInternal(this, {
      ...this.settings,
      gatewayUrl: nextGatewayUrl,
    });
    this.connect();
  }
  handleGatewayUrlCancel() {
    this.pendingGatewayUrl = null;
  }
  handleOpenSidebar(content) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }
  handleCloseSidebar() {
    this.sidebarOpen = false;
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
    }
    this.sidebarCloseTimer = window.setTimeout(() => {
      if (this.sidebarOpen) {
        return;
      }
      this.sidebarContent = null;
      this.sidebarError = null;
      this.sidebarCloseTimer = null;
    }, 200);
  }
  handleSplitRatioChange(ratio) {
    const newRatio = Math.max(0.4, Math.min(0.7, ratio));
    this.splitRatio = newRatio;
    this.applySettings({ ...this.settings, splitRatio: newRatio });
  }
  async loadModelCatalog() {
    // Voice mode (TTS) — Kokoro primary, Web Speech API fallback
    this.voiceMode = (() => {
      try {
        return localStorage.getItem("genosos.voiceMode") === "1";
      } catch {
        return false;
      }
    })();
    this._ttsKokoroUrl = "http://localhost:8880/v1";
    this._ttsVoice = "em_alex";
    this._ttsLang = "es";
    this._ttsCurrentAudio = null;
    this._ttsAbortController = null;
  }
  // ── Voice Mode (TTS) ──────────────────────────────────────────────────────

  /** Load Kokoro config from gateway (URL + voice). Falls back to defaults. */
  async loadTtsConfig() {
    try {
      const res = await this.client?.request("tts.status");
      if (res?.kokoroBaseUrl) {
        this._ttsKokoroUrl = res.kokoroBaseUrl;
      }
      if (res?.kokoroVoice) {
        this._ttsVoice = res.kokoroVoice;
      }
      if (res?.kokoroLang) {
        this._ttsLang = res.kokoroLang;
      }
    } catch {
      /* keep defaults */
    }
  }

  /** Toggle voice mode on/off. Persists state in localStorage. */
  toggleVoiceMode() {
    this.voiceMode = !this.voiceMode;
    try {
      localStorage.setItem("genosos.voiceMode", this.voiceMode ? "1" : "0");
    } catch {
      /* quota */
    }
    if (this.voiceMode) {
      this.loadTtsConfig();
    } else {
      this.stopVoiceTts();
    }
  }

  /** Stop any currently playing TTS audio and cancel pending fetches. */
  /** Stop all TTS activity — abort fetches, stop audio, cancel speech. */
  stopVoiceTts() {
    this._ttsAbortController?.abort();
    this._ttsAbortController = null;
    this._ttsStreamActive = false;
    this._ttsSentenceOffset = 0;
    if (this._ttsCurrentAudio) {
      this._ttsCurrentAudio.pause();
      this._ttsCurrentAudio = null;
    }
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }
  }

  /** Strip markdown, emojis, and unreadable content from text before TTS. Returns null if empty or code-only. */
  _ttsClean(text) {
    const codeBlocks = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
    const codeLen = codeBlocks.reduce((s, b) => s + b.length, 0);
    const withoutCode =
      text.length > 0 && codeLen / text.length > 0.55
        ? "He adjuntado un bloque de código."
        : text.replace(/```[\s\S]*?```/g, " [código] ");
    const clean = withoutCode
      .replace(/`[^`\n]+`/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_~>|\\]/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[a-zA-Z0-9+/]{60,}={0,2}/g, "")
      // Strip emoji and pictographic symbols (covers all Unicode emoji/icon ranges)
      .replace(
        /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA9F}\u{1FAD0}-\u{1FAFF}]/gu,
        "",
      )
      // Strip variation selectors and zero-width joiners left after emoji removal
      .replace(/[\uFE0E\uFE0F\u200D]/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return clean || null;
  }

  /** Fetch audio for a single sentence. Returns blob URL or null on error. */
  async _fetchTtsSentence(sentence, signal) {
    try {
      const res = await fetch(`${this._ttsKokoroUrl}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "kokoro",
          input: sentence,
          voice: this._ttsVoice,
          speed: 1.0,
          response_format: "mp3",
          stream: false,
          ...(this._ttsLang ? { lang_code: this._ttsLang } : {}),
        }),
        signal,
      });
      if (!res.ok) {
        throw new Error(`Kokoro ${res.status}`);
      }
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }

  /**
   * Start a new TTS streaming session. Called on the first delta of an agent response.
   * Kicks off a playback loop that drains a queue fed by feedTtsStream().
   */
  startTtsStream() {
    this.stopVoiceTts();
    const abort = new AbortController();
    this._ttsAbortController = abort;
    this._ttsStreamActive = true;
    this._ttsSentenceOffset = 0;
    this._ttsQueue = []; // array of Promise<string|null>
    this._ttsKokoroFailed = false;
    // Playback loop: drains _ttsQueue in order, waits for more if empty
    (async () => {
      let idx = 0;
      let played = 0;
      while (this._ttsStreamActive || idx < this._ttsQueue.length) {
        if (idx >= this._ttsQueue.length) {
          await new Promise((r) => setTimeout(r, 30));
          continue;
        }
        if (abort.signal.aborted) {
          break;
        }
        const src = await this._ttsQueue[idx++];
        if (!src || abort.signal.aborted) {
          continue;
        }
        played++;
        await new Promise((resolve) => {
          const audio = new Audio(src);
          this._ttsCurrentAudio = audio;
          const cleanup = () => {
            URL.revokeObjectURL(src);
            resolve();
          };
          audio.addEventListener("ended", cleanup);
          audio.addEventListener("error", cleanup);
          audio.play().catch(cleanup);
        });
      }
      if (this._ttsAbortController === abort) {
        this._ttsAbortController = null;
        this._ttsCurrentAudio = null;
      }
      // Full fallback if Kokoro failed on every sentence
      if (played === 0 && !abort.signal.aborted && this._ttsFallbackText) {
        this._fallbackSpeech(this._ttsFallbackText);
      }
      this._ttsFallbackText = null;
    })();
  }

  /**
   * Feed accumulated stream text on each delta event.
   * Detects new complete sentences and enqueues Kokoro fetches immediately.
   * @param {string} fullText - Full chatStream text accumulated so far.
   */
  feedTtsStream(fullText) {
    if (!this._ttsStreamActive || !this._ttsAbortController) {
      return;
    }
    const signal = this._ttsAbortController.signal;
    // Walk forward from last known offset looking for sentence boundaries
    const pending = fullText.slice(this._ttsSentenceOffset);
    // Match sentence ending: period/!/? followed by space or end-of-string
    const re = /[^.!?]*[.!?]+(?:\s|$)/g;
    let match;
    while ((match = re.exec(pending)) !== null) {
      const sentence = match[0].trim();
      if (sentence.length < 4) {
        continue;
      }
      const cleaned = this._ttsClean(sentence);
      if (cleaned) {
        this._ttsQueue.push(this._fetchTtsSentence(cleaned, signal));
      }
      this._ttsSentenceOffset += match.index + match[0].length;
      re.lastIndex = 0; // restart on updated pending
      const newPending = fullText.slice(this._ttsSentenceOffset);
      re.lastIndex = 0;
      if (!newPending) {
        break;
      }
      // re-exec on remaining
      const next = /[^.!?]*[.!?]+(?:\s|$)/g;
      let m2;
      while ((m2 = next.exec(newPending)) !== null) {
        const s2 = m2[0].trim();
        if (s2.length >= 4) {
          const c2 = this._ttsClean(s2);
          if (c2) {
            this._ttsQueue.push(this._fetchTtsSentence(c2, signal));
          }
          this._ttsSentenceOffset += m2.index + m2[0].length;
        }
      }
      break;
    }
  }

  /**
   * Signal end of stream. Flushes any remaining text (last sentence may lack punctuation).
   * @param {string} fullText - Complete final text of the response.
   */
  endTtsStream(fullText) {
    const remaining = fullText?.slice(this._ttsSentenceOffset ?? 0).trim();
    if (remaining && remaining.length >= 4 && this._ttsStreamActive) {
      const cleaned = this._ttsClean(remaining);
      if (cleaned && this._ttsAbortController) {
        this._ttsFallbackText = cleaned; // used if every sentence failed
        this._ttsQueue?.push(this._fetchTtsSentence(cleaned, this._ttsAbortController.signal));
      }
    }
    this._ttsStreamActive = false; // signals playback loop to stop waiting
  }

  /** Web Speech API fallback — prefers Spanish male voice. */
  _fallbackSpeech(text) {
    if (typeof speechSynthesis === "undefined") {
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-ES";
    utter.rate = 1.0;
    const voices = speechSynthesis.getVoices();
    const maleEs =
      voices.find(
        (v) => v.lang.startsWith("es") && /jorge|carlos|pablo|male|hombre/i.test(v.name),
      ) ?? voices.find((v) => v.lang.startsWith("es"));
    if (maleEs) {
      utter.voice = maleEs;
    }
    speechSynthesis.speak(utter);
  }

  deriveChatActiveModel() {
    // Read model from session data — no manual overrides, system controls the model
    const sessions = this.sessionsResult?.sessions;
    if (!sessions) {
      return;
    }
    const current = sessions.find((s) => s.key === this.sessionKey);
    const provider = current?.modelProvider;
    const model = current?.model;
    if (provider && model) {
      this.chatActiveModel = `${provider}/${model}`;
    }
  }
  syncModelFromGateway(model) {
    if (!model) {
      return;
    }
    if (model === this.chatActiveModel) {
      return;
    }
    // Model from gateway may or may not include provider prefix
    this.chatActiveModel = model;
  }
  syncModelFromSessionData() {
    const sessions = this.sessionsResult?.sessions;
    if (!sessions) {
      return;
    }
    const current = sessions.find((s) => s.key === this.sessionKey);
    if (!current?.modelProvider || !current?.model) {
      return;
    }
    const serverModel = `${current.modelProvider}/${current.model}`;
    if (serverModel === this.chatActiveModel) {
      return;
    }
    this.chatActiveModel = serverModel;
  }
  render() {
    return renderApp(this);
  }
}
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "settings", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "tab", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "onboarding", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "connected", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "theme", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "themeResolved", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "hello", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "lastError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "eventLog", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "assistantName", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "assistantAvatar", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "assistantAgentId", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "sessionKey", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatSending", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatMessage", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatMessages", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatToolMessages", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatStream", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatStreamStartedAt", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatRunId", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "compactionStatus", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatAvatarUrl", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatThinkingLevel", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatAttachments", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatManualRefreshInFlight", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "sidebarOpen", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "sidebarContent", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "sidebarError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "splitRatio", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "execApprovalQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "execApprovalBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "execApprovalError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "fileApprovalQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "fileApprovalBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "fileApprovalError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "webauthnRegQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "webauthnRegBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "webauthnRegError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "unlockedTabs", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "tabLockBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "pendingGatewayUrl", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "connectionModalOpen", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "healthModalOpen", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configModalOpen", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configEditorOpen", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "settingsModalOpen", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "settingsModalTab", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "_settingsConfigEditor", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configRaw", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configRawOriginal", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configValid", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configIssues", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configSaving", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configApplying", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "updateRunning", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "applySessionKey", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configSnapshot", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configSchema", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configSchemaVersion", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configSchemaLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configUiHints", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configForm", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configFormOriginal", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configFormDirty", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configFormMode", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configSearchQuery", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configActiveSection", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "configActiveSubsection", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelsLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelsSnapshot", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelsError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelsLastSuccess", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentsLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentsList", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentsError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentsSelectedId", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentFilesLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentFilesError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentFilesList", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentFileContents", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentFileDrafts", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentFileActive", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentFileSaving", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentIdentityLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentIdentityError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentIdentityById", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentSkillsLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentSkillsError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentSkillsReport", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "agentSkillsAgentId", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "sessionsLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "sessionsResult", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "sessionsError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "boardSection", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "boardColumns", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "boardSearchQuery", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "boardSearchResults", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "boardActivityFilter", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronJobs", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronStatus", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronForm", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronRunsJobId", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronRuns", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronBoardQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronBoardBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "cronBoardError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "updateAvailable", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "skillsLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "skillsReport", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "skillsError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "skillsFilter", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "skillEdits", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "skillsBusyKey", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "skillMessages", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsFile", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsEntries", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsFilterText", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsLevelFilters", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsAutoFollow", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsTruncated", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsCursor", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsLastFetchAt", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsLimit", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsMaxBytes", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsAtBottom", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsViewQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsViewBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "logsViewError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "filesBrowserQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "filesBrowserBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "filesBrowserError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelSetupQueue", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelSetupBusy", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelSetupError", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelSetupQr", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelSetupQrLoading", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelSetupQrWaiting", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "channelSetupUnlinking", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatNewMessagesBelow", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "chatActiveModel", 2);
__decorateClass_48d94f0e55ed4dd4([state()], GenosOSApp.prototype, "voiceMode", 2);
GenosOSApp = __decorateClass_48d94f0e55ed4dd4([customElement("genosos-app")], GenosOSApp);
