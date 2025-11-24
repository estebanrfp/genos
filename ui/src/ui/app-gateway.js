let normalizeSessionKeyForDefaults = function (value, defaults) {
    const raw = (value ?? "").trim();
    const mainSessionKey = defaults.mainSessionKey?.trim();
    if (!mainSessionKey) {
      return raw;
    }
    if (!raw) {
      return mainSessionKey;
    }
    const mainKey = defaults.mainKey?.trim() || "main";
    const defaultAgentId = defaults.defaultAgentId?.trim();
    const isAlias =
      raw === "main" ||
      raw === mainKey ||
      (defaultAgentId &&
        (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
    return isAlias ? mainSessionKey : raw;
  },
  applySessionDefaults = function (host, defaults) {
    if (!defaults?.mainSessionKey) {
      return;
    }
    const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
    const resolvedSettingsSessionKey = normalizeSessionKeyForDefaults(
      host.settings.sessionKey,
      defaults,
    );
    const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
      host.settings.lastActiveSessionKey,
      defaults,
    );
    const nextSessionKey = resolvedSessionKey || resolvedSettingsSessionKey || host.sessionKey;
    const nextSettings = {
      ...host.settings,
      sessionKey: resolvedSettingsSessionKey || nextSessionKey,
      lastActiveSessionKey: resolvedLastActiveSessionKey || nextSessionKey,
    };
    const shouldUpdateSettings =
      nextSettings.sessionKey !== host.settings.sessionKey ||
      nextSettings.lastActiveSessionKey !== host.settings.lastActiveSessionKey;
    if (nextSessionKey !== host.sessionKey) {
      host.sessionKey = nextSessionKey;
    }
    if (shouldUpdateSettings) {
      applySettings(host, nextSettings);
    }
  },
  handleGatewayEventUnsafe = function (host, evt) {
    host.eventLogBuffer = [
      { ts: Date.now(), event: evt.event, payload: evt.payload },
      ...host.eventLogBuffer,
    ].slice(0, 250);
    if (host.tab === "debug") {
      host.eventLog = host.eventLogBuffer;
    }
    if (evt.event === "agent") {
      if (host.onboarding) {
        return;
      }
      handleAgentEvent(host, evt.payload);
      return;
    }
    if (evt.event === "chat") {
      const payload = evt.payload;
      if (payload?.sessionKey) {
        setLastActiveSessionKey(host, payload.sessionKey);
      }
      const isDelta = payload?.state === "delta";
      // Capture chatStream before handleChatEvent may clear it on "final"
      const preHandleStream = host.voiceMode ? (host.chatStream ?? "") : null;
      // TTS streaming: start on first delta
      if (isDelta && host.voiceMode && !host._ttsStreamActive) {
        host.startTtsStream();
      }
      const state = handleChatEvent(host, payload);
      // TTS streaming: feed each delta after chatStream is updated
      if (isDelta && host.voiceMode && host._ttsStreamActive) {
        host.feedTtsStream(host.chatStream ?? "");
      }
      if (state === "final" || state === "error" || state === "aborted") {
        resetToolStream(host);
        flushChatQueueForEvent(host);
        const runId = payload?.runId;
        if (runId && host.refreshSessionsAfterChat.has(runId)) {
          host.refreshSessionsAfterChat.delete(runId);
          if (state === "final") {
            loadSessions(host, {
              activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
            });
          }
        }
      }
      if (state === "final") {
        loadChatHistory(host);
        loadAgents(host);
        // Flush any remaining TTS text (handles partial last sentence)
        if (host.voiceMode) {
          host.endTtsStream(preHandleStream ?? "");
        }
      }
      if ((state === "error" || state === "aborted") && host.voiceMode && host._ttsStreamActive) {
        host.stopVoiceTts();
      }
      return;
    }
    if (evt.event === "presence") {
      const payload = evt.payload;
      if (payload?.presence && Array.isArray(payload.presence)) {
        host.presenceEntries = payload.presence;
        host.presenceError = null;
        host.presenceStatus = null;
      }
      return;
    }
    if (evt.event === "sessions.changed") {
      const syncModel = () => {
        loadSessions(host).then(() => {
          host.syncModelFromSessionData?.();
        });
        loadAgents(host);
      };
      if (host.sessionsLoading) {
        setTimeout(syncModel, 400);
      } else {
        syncModel();
      }
      return;
    }
    if (evt.event === "channels.changed") {
      loadChannels(host, false);
      return;
    }
    if (evt.event === "cron") {
      if ((host.cronBoardQueue ?? []).length > 0) {
        Promise.all([
          loadSessions(host),
          loadCronJobs(host),
          loadCronStatus(host),
          loadAgents(host),
          loadChannels(host, false),
        ]).then(() => loadBoard(host));
      }
    }
    if (evt.event === "cron.board.requested") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        host.cronBoardQueue = [
          ...(host.cronBoardQueue ?? []).filter((e) => e.id !== p.id),
          {
            id: p.id,
            createdAtMs: p.createdAtMs,
            expiresAtMs: p.expiresAtMs,
          },
        ];
        host.cronBoardError = null;
        Promise.all([
          loadSessions(host),
          loadCronJobs(host),
          loadCronStatus(host),
          loadAgents(host),
          loadChannels(host, false),
        ]).then(() => loadBoard(host));
        const delay = Math.max(0, p.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.cronBoardQueue = (host.cronBoardQueue ?? []).filter((e) => e.id !== p.id);
        }, delay);
      }
      return;
    }
    if (evt.event === "cron.board.completed") {
      const p = evt.payload;
      if (p?.id) {
        host.cronBoardQueue = (host.cronBoardQueue ?? []).filter((e) => e.id !== p.id);
      }
      return;
    }
    if (evt.event === "logs.view.requested") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        const filters = p.filters ?? {};
        // Apply pre-set level filters
        if (Array.isArray(filters.levels) && filters.levels.length > 0) {
          const enabledSet = new Set(filters.levels.map((l) => l.toLowerCase()));
          const next = {};
          for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
            next[level] = enabledSet.has(level);
          }
          host.logsLevelFilters = next;
        }
        // Apply pre-set text search
        if (typeof filters.text === "string") {
          host.logsFilterText = filters.text;
        }
        host.logsViewQueue = [
          ...(host.logsViewQueue ?? []).filter((e) => e.id !== p.id),
          {
            id: p.id,
            filters,
            createdAtMs: p.createdAtMs,
            expiresAtMs: p.expiresAtMs,
          },
        ];
        host.logsViewError = null;
        loadLogs(host, { reset: true });
        startLogsPolling(host);
        const delay = Math.max(0, p.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.logsViewQueue = (host.logsViewQueue ?? []).filter((e) => e.id !== p.id);
          if ((host.logsViewQueue ?? []).length === 0) {
            stopLogsPolling(host);
          }
        }, delay);
      }
      return;
    }
    if (evt.event === "logs.view.completed") {
      const p = evt.payload;
      if (p?.id) {
        host.logsViewQueue = (host.logsViewQueue ?? []).filter((e) => e.id !== p.id);
        if ((host.logsViewQueue ?? []).length === 0) {
          stopLogsPolling(host);
        }
      }
      return;
    }
    if (evt.event === "files.browser.requested") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        const agentId = p.agentId ?? "main";
        host.agentFileActive = null;
        host.agentFileContents = {};
        host.agentFileDrafts = {};
        host.filesBrowserQueue = [
          ...(host.filesBrowserQueue ?? []).filter((e) => e.id !== p.id),
          {
            id: p.id,
            agentId,
            createdAtMs: p.createdAtMs,
            expiresAtMs: p.expiresAtMs,
          },
        ];
        host.filesBrowserError = null;
        host.settingsModalOpen = true;
        host.settingsModalTab = "files";
        loadAgentFiles(host, agentId);
        const delay = Math.max(0, p.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.filesBrowserQueue = (host.filesBrowserQueue ?? []).filter((e) => e.id !== p.id);
        }, delay);
      }
      return;
    }
    if (evt.event === "files.browser.completed") {
      const p = evt.payload;
      if (p?.id) {
        host.filesBrowserQueue = (host.filesBrowserQueue ?? []).filter((e) => e.id !== p.id);
      }
      return;
    }
    if (evt.event === "device.pair.requested" || evt.event === "device.pair.resolved") {
      loadDevices(host, { quiet: true });
    }
    if (evt.event === "exec.approval.requested") {
      const entry = parseExecApprovalRequested(evt.payload);
      if (entry) {
        host.execApprovalQueue = addExecApproval(host.execApprovalQueue, entry);
        host.execApprovalError = null;
        const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, entry.id);
        }, delay);
      }
      return;
    }
    if (evt.event === "exec.approval.resolved") {
      const resolved = parseExecApprovalResolved(evt.payload);
      if (resolved) {
        host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, resolved.id);
      }
    }
    if (evt.event === "files.approval.required") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        const entry = {
          id: p.id,
          agentId: p.agentId,
          name: p.name,
          operation: p.operation,
          preview: p.preview,
          createdAtMs: p.createdAtMs,
          expiresAtMs: p.expiresAtMs,
        };
        host.fileApprovalQueue = [
          ...(host.fileApprovalQueue ?? []).filter((e) => e.id !== entry.id),
          entry,
        ];
        host.fileApprovalError = null;
        const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.fileApprovalQueue = (host.fileApprovalQueue ?? []).filter((e) => e.id !== entry.id);
        }, delay);
      }
      return;
    }
    if (evt.event === "files.approval.resolved") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        const entry = (host.fileApprovalQueue ?? []).find((e) => e.id === p.id);
        host.fileApprovalQueue = (host.fileApprovalQueue ?? []).filter((e) => e.id !== p.id);
        if (entry?.name && p.decision === "approve") {
          const name = entry.name;
          // Delay slightly to let the write complete before invalidating the content cache
          window.setTimeout(() => {
            const { [name]: _c, ...restContents } = host.agentFileContents ?? {};
            host.agentFileContents = restContents;
            const { [name]: _d, ...restDrafts } = host.agentFileDrafts ?? {};
            host.agentFileDrafts = restDrafts;
            if (host.agentFileActive === name) {
              const agentId =
                host.agentsSelectedId ??
                host.agentsList?.defaultId ??
                host.agentsList?.agents?.[0]?.id ??
                null;
              if (agentId) {
                loadAgentFileContent(host, agentId, name, { force: true, preserveDraft: false });
              }
            }
          }, 800);
        }
      }
    }
    if (evt.event === "whatsapp.qr.requested") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        host.whatsappQrQueue = [
          ...(host.whatsappQrQueue ?? []).filter((e) => e.id !== p.id),
          {
            id: p.id,
            qrDataUrl: p.qrDataUrl,
            message: p.message,
            createdAtMs: p.createdAtMs,
            expiresAtMs: p.expiresAtMs,
          },
        ];
        host.whatsappQrError = null;
        const delay = Math.max(0, p.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.whatsappQrQueue = (host.whatsappQrQueue ?? []).filter((e) => e.id !== p.id);
        }, delay);
      }
      return;
    }
    if (evt.event === "whatsapp.qr.completed") {
      const p = evt.payload;
      if (p?.id) {
        host.whatsappQrQueue = (host.whatsappQrQueue ?? []).filter((e) => e.id !== p.id);
      }
      return;
    }
    if (evt.event === "channel.setup.requested") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        host.channelSetupQueue = [
          ...(host.channelSetupQueue ?? []).filter((e) => e.id !== p.id),
          {
            id: p.id,
            channel: p.channel,
            descriptor: p.descriptor,
            state: p.state,
            createdAtMs: p.createdAtMs,
            expiresAtMs: p.expiresAtMs,
          },
        ];
        host.channelSetupError = null;
        host.channelSetupQr = null;
        host.channelSetupQrLoading = false;
        host.channelSetupQrWaiting = false;
        const delay = Math.max(0, p.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.channelSetupQueue = (host.channelSetupQueue ?? []).filter((e) => e.id !== p.id);
        }, delay);
      }
      return;
    }
    if (evt.event === "channel.setup.completed") {
      const p = evt.payload;
      if (p?.id) {
        // Skip removal if the entry is advancing to the next step (e.g. token → pairing)
        const entry = (host.channelSetupQueue ?? []).find((e) => e.id === p.id);
        if (entry?._advancing) {
          return;
        }
        const hadEntry = !!entry;
        host.channelSetupQueue = (host.channelSetupQueue ?? []).filter((e) => e.id !== p.id);
        if (hadEntry && (host.channelSetupQueue ?? []).length === 0) {
          host.channelSetupQr = null;
          host.channelSetupBusy = false;
          host.channelSetupError = null;
          host.channelSetupQrLoading = false;
          host.channelSetupQrWaiting = false;
        }
      }
      host.requestUpdate?.();
      return;
    }
    if (evt.event === "nostr.profile.edit.requested") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        host.nostrEditQueue = [
          ...(host.nostrEditQueue ?? []).filter((e) => e.id !== p.id),
          {
            id: p.id,
            accountId: p.accountId,
            profile: p.profile,
            createdAtMs: p.createdAtMs,
            expiresAtMs: p.expiresAtMs,
          },
        ];
        host.nostrEditError = null;
        host.nostrEditFormState = null;
        const delay = Math.max(0, p.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.nostrEditQueue = (host.nostrEditQueue ?? []).filter((e) => e.id !== p.id);
          if ((host.nostrEditQueue ?? []).length === 0) {
            host.nostrEditFormState = null;
          }
        }, delay);
      }
      return;
    }
    if (evt.event === "nostr.profile.edit.completed") {
      const p = evt.payload;
      if (p?.id) {
        host.nostrEditQueue = (host.nostrEditQueue ?? []).filter((e) => e.id !== p.id);
        if ((host.nostrEditQueue ?? []).length === 0) {
          host.nostrEditFormState = null;
        }
      }
      return;
    }
    if (evt.event === "webauthn.registration.requested") {
      const p = evt.payload;
      if (p && typeof p.id === "string") {
        host.webauthnRegQueue = [
          ...(host.webauthnRegQueue ?? []).filter((e) => e.id !== p.id),
          {
            id: p.id,
            displayName: p.displayName,
            createdAtMs: p.createdAtMs,
            expiresAtMs: p.expiresAtMs,
          },
        ];
        host.webauthnRegError = null;
        const delay = Math.max(0, p.expiresAtMs - Date.now() + 500);
        window.setTimeout(() => {
          host.webauthnRegQueue = (host.webauthnRegQueue ?? []).filter((e) => e.id !== p.id);
        }, delay);
      }
      return;
    }
    if (evt.event === "webauthn.registration.completed") {
      const p = evt.payload;
      if (p?.id) {
        host.webauthnRegQueue = (host.webauthnRegQueue ?? []).filter((e) => e.id !== p.id);
      }
      return;
    }
  };
import {
  CHAT_SESSIONS_ACTIVE_MINUTES,
  flushChatQueueForEvent,
  startActivityTick,
  startChatRunWatchdog,
  stopActivityTick,
  stopChatRunWatchdog,
} from "./app-chat.js";
import { startLogsPolling, stopLogsPolling } from "./app-polling.js";
import { applySettings, refreshActiveTab, setLastActiveSessionKey } from "./app-settings.js";
import { handleAgentEvent, resetToolStream } from "./app-tool-stream.js";
import { loadAgentFileContent, loadAgentFiles } from "./controllers/agent-files.js";
import { loadAgents } from "./controllers/agents.js";
import { loadAssistantIdentity } from "./controllers/assistant-identity.js";
import { loadBoard } from "./controllers/board.js";
import { loadChannels } from "./controllers/channels.js";
import { loadChatHistory } from "./controllers/chat.js";
import { handleChatEvent } from "./controllers/chat.js";
import { loadCronJobs, loadCronStatus } from "./controllers/cron.js";
import { loadDevices } from "./controllers/devices.js";
import {
  addExecApproval,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  removeExecApproval,
} from "./controllers/exec-approval.js";
import { loadLogs } from "./controllers/logs.js";
import { loadSessions } from "./controllers/sessions.js";
import { GatewayBrowserClient } from "./gateway.js";
import { loadWebAuthnCredentials } from "./views/webauthn-panel.js";

export function connectGateway(host) {
  host.lastError = null;
  host.hello = null;
  host.connected = false;
  host.execApprovalQueue = [];
  host.execApprovalError = null;
  const previousClient = host.client;
  const client = new GatewayBrowserClient({
    url: host.settings.gatewayUrl,
    token: host.settings.token.trim() ? host.settings.token : undefined,
    clientName: "genosos-control-ui",
    mode: "webchat",
    displayName: host.ownerDisplayName ?? undefined,
    onHello: (hello) => {
      if (host.client !== client) {
        return;
      }
      host.connected = true;
      host.lastError = null;
      host.hello = hello;
      applySnapshot(host, hello);
      host.chatRunId = null;
      host.chatStream = null;
      host.chatStreamStartedAt = null;
      resetToolStream(host);
      flushChatQueueForEvent(host);
      startChatRunWatchdog(host);
      startActivityTick(host);
      loadAssistantIdentity(host);
      loadAgents(host);
      loadChannels(host, false);
      host.deriveChatActiveModel?.();
      loadWebAuthnCredentials(host.client, () => host.requestUpdate());
      refreshActiveTab(host);
    },
    onClose: ({ code, reason }) => {
      if (host.client !== client) {
        return;
      }
      stopChatRunWatchdog(host);
      stopActivityTick(host);
      host.connected = false;
      host.channelsSnapshot = null;
      host._runningSessions = null;
      if (code !== 1012) {
        host.lastError = `disconnected (${code}): ${reason || "no reason"}`;
      }
    },
    onEvent: (evt) => {
      if (host.client !== client) {
        return;
      }
      handleGatewayEvent(host, evt);
    },
    onGap: ({ expected, received }) => {
      if (host.client !== client) {
        return;
      }
      // Silently reconnect to resync state instead of showing a red banner
      console.warn(
        `[gateway] event gap detected (expected ${expected}, got ${received}), reconnecting`,
      );
      connectGateway(host);
    },
  });
  host.client = client;
  previousClient?.stop();
  client.start();
}
export function handleGatewayEvent(host, evt) {
  try {
    handleGatewayEventUnsafe(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}
export function applySnapshot(host, hello) {
  const snapshot = hello.snapshot;
  if (snapshot?.presence && Array.isArray(snapshot.presence)) {
    host.presenceEntries = snapshot.presence;
  }
  if (snapshot?.health) {
    host.debugHealth = snapshot.health;
  }
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
  host.ownerDisplayName = snapshot?.owner?.displayName ?? null;
  host.updateAvailable = snapshot?.updateAvailable ?? null;
}
