import hljs from "highlight.js/lib/common";
// GenosOS — Esteban & Nyx
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  deleteAgentFile,
  loadAgentFileContent,
  loadAgentFiles,
  saveAgentFile,
} from "../controllers/agent-files.js";
import { loadChannels } from "../controllers/channels.js";
import { loadConfig, saveConfig } from "../controllers/config.js";
import { icons } from "../icons.js";
import { renderAgentFiles } from "./agents-panels-status-files.js";
import { sidebarIcons } from "./config.js";
import { renderConnection } from "./overview.js";
import { hasRegisteredCredentials, authenticateWithWebAuthn } from "./webauthn-panel.js";

/** @type {ReadonlyArray<{id: string, label: string}>} */
const TABS = [
  { id: "gateway", label: "Gateway" },
  { id: "config", label: "Config" },
  { id: "files", label: "Files" },
];

// ─── Gateway tab (Access + Health) ───────────────────────────────────────────

const formatUptime = (ms) => {
  if (!ms || ms < 0) {
    return "\u2014";
  }
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const statCard = (icon, label, value, colorClass = "") => html`
  <div class="health-stat">
    <div class="health-stat__label">${icon}<span>${label}</span></div>
    <div class="health-stat__value ${colorClass}">${value}</div>
  </div>
`;

const renderGatewayTab = (state) => {
  // Fetch vault status on first render
  if (!state._healthVaultStatus && state.client) {
    state._healthVaultStatus = "loading";
    state.client
      .request("vault.status", {})
      .then((res) => {
        state._healthVaultResult = res;
        state._healthVaultStatus = "done";
        state.requestUpdate();
      })
      .catch(() => {
        state._healthVaultStatus = "error";
        state.requestUpdate();
      });
    loadChannels(state, false);
  }

  const snapshot = state.hello?.snapshot;
  const uptimeMs = snapshot?.uptimeMs ?? state.hello?.uptimeMs;
  const version = state.hello?.server?.version ?? "\u2014";
  const vaultRes = state._healthVaultResult;
  const vaultFailed = state._healthVaultStatus === "error";
  const vaultLocked = vaultRes?.locked === true;
  const vaultLabel = vaultFailed
    ? "Unavailable"
    : !vaultRes
      ? "\u2014"
      : vaultLocked
        ? "Locked"
        : "Unlocked";
  const vaultColor = vaultFailed ? "muted" : !vaultRes ? "muted" : vaultLocked ? "warn" : "ok";
  const webauthn = hasRegisteredCredentials();

  return html`
    <div class="health-modal-grid">
      ${statCard(icons.zap, "Uptime", formatUptime(uptimeMs), "ok")}
      ${statCard(icons.shield, "Vault", vaultLabel, vaultColor)}
      ${statCard(icons.plug, "WebAuthn", webauthn ? "Active" : "None", webauthn ? "ok" : "muted")}
      ${statCard(icons.globe, "Version", version)}
    </div>
    <div class="divider-section">
      ${renderConnection({
        connected: state.connected,
        hello: state.hello,
        settings: state.settings,
        lastError: state.lastError,
        onSettingsChange: (next) => state.applySettings(next),
        onConnect: () => state.connect(),
      })}
    </div>
  `;
};

// ─── Config tab ──────────────────────────────────────────────────────────────

const SECTION_DEFS = [
  { key: "providers", label: "Providers", desc: "AI model providers", icon: "auth" },
  { key: "agents", label: "Agents", desc: "My agents", icon: "agents" },
  {
    key: "channels",
    label: "Channels",
    desc: "WhatsApp, Telegram, Discord\u2026",
    icon: "channels",
  },
  { key: "skills", label: "Skills", desc: "Installed skills", icon: "skills" },
  { key: "cron", label: "Cron", desc: "Scheduled tasks", icon: "cron" },
];

const CONFIG_MAP_HINTS = {
  providers: ["Show my providers", "Connect OpenAI"],
  agents: ["List my agents", "Create an agent for X"],
  channels: ["Connect WhatsApp", "Connect Telegram"],
  skills: ["Show my skills", "Enable a skill"],
  cron: ["List cron jobs", "Add a daily reminder"],
};

const OVERLAY_SECTIONS = new Set(["providers", "agents", "channels", "skills", "cron"]);

const QUICK_COMMANDS = [
  { cmd: "/providers", desc: "AI model providers" },
  { cmd: "/agents", desc: "My agents" },
  { cmd: "/channels", desc: "My channels" },
  { cmd: "/skills", desc: "My skills" },
  { cmd: "/cron", desc: "My scheduled tasks" },
  { cmd: "/reset", desc: "New conversation" },
  { cmd: "/compact", desc: "Compact transcript" },
];

const highlightJson = (raw) => {
  try {
    return hljs.highlight(raw, { language: "json" }).value;
  } catch {
    return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }
};

const syncScroll = (e) => {
  const textarea = e.target;
  const pre = textarea.parentElement?.querySelector(".config-editor__highlight");
  if (pre) {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }
};

let _configAuthAttempted = false;

const prefillChat = (state, phrase) => {
  state.chatMessage = phrase;
  state.settingsModalOpen = false;
  requestAnimationFrame(() => {
    document.querySelector(".chat-compose__field textarea")?.focus();
  });
};

const renderConfigTab = (state) => {
  // Sub-view: editor or map
  if (state._settingsConfigEditor) {
    const locked = !state.unlockedTabs?.has("config-editor") && hasRegisteredCredentials();
    if (locked) {
      if (!_configAuthAttempted) {
        _configAuthAttempted = true;
        authenticateWithWebAuthn()
          .then((token) => {
            if (token) {
              state.unlockedTabs = new Set([...(state.unlockedTabs ?? []), "config-editor"]);
            } else {
              state._settingsConfigEditor = false;
            }
          })
          .catch(() => {
            state._settingsConfigEditor = false;
          });
      }
      return html`
        <div class="settings-tab-empty"><p class="muted">Authenticating…</p></div>
      `;
    }

    const dirty = state.configRaw !== state.configRawOriginal;
    const saving = state.configSaving;
    const highlighted = highlightJson(state.configRaw);

    return html`
      <div class="config-editor__body">
        <div class="config-editor__wrapper">
          <pre class="config-editor__highlight" aria-hidden="true"><code class="hljs">${unsafeHTML(highlighted + "\n")}</code></pre>
          <textarea
            class="config-editor__textarea"
            spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"
            .value=${state.configRaw}
            @input=${(e) => {
              state.configRaw = e.target.value;
              state.configFormDirty = true;
            }}
            @scroll=${syncScroll}
          ></textarea>
        </div>
      </div>
      ${state.lastError ? html`<div class="exec-approval-error">${state.lastError}</div>` : nothing}
      <div class="exec-approval-actions">
        <button class="btn primary" ?disabled=${!dirty || saving}
          @click=${async () => {
            await saveConfig(state);
            if (!state.lastError) {
              await loadConfig(state);
              state._settingsConfigEditor = false;
            }
          }}
        >${saving ? "Saving\u2026" : "Save"}</button>
        <button class="btn" ?disabled=${saving}
          @click=${() => {
            state._settingsConfigEditor = false;
          }}
        >Config Map</button>
      </div>
    `;
  }

  // Config Map view
  _configAuthAttempted = false;
  return html`
    <div class="config-modal-body">
      <div class="config-map__commands">
        ${QUICK_COMMANDS.map(
          (c) => html`
            <span class="config-map__cmd" @click=${() => prefillChat(state, c.cmd)}>
              <code>${c.cmd}</code> \u2014 ${c.desc}
            </span>
          `,
        )}
      </div>
      <div class="config-map__grid">
        ${SECTION_DEFS.map((sec) => {
          const hints = CONFIG_MAP_HINTS[sec.key] ?? [];
          const hasOverlay = OVERLAY_SECTIONS.has(sec.key);
          return html`
            <div class="config-map__card">
              <div class="config-map__card-header">
                <span class="config-map__icon">${sidebarIcons[sec.icon] ?? nothing}</span>
                <div class="config-map__card-meta">
                  <span class="config-map__label">${sec.label}</span>
                  ${
                    hasOverlay
                      ? html`
                          <span class="config-map__badge">overlay</span>
                        `
                      : nothing
                  }
                </div>
              </div>
              <div class="config-map__desc">${sec.desc}</div>
              <ul class="config-map__hints">
                ${hints.map(
                  (h) => html`
                  <li class="config-map__hint" @click=${() => prefillChat(state, h)}>\u201C${h}\u201D</li>
                `,
                )}
              </ul>
            </div>
          `;
        })}
      </div>
    </div>
    <div class="exec-approval-actions">
      <button class="btn" @click=${async () => {
        state._settingsConfigEditor = true;
        state.lastError = null;
        await loadConfig(state);
      }}>${icons.fileCode} Edit JSON</button>
    </div>
  `;
};

// ─── Files tab ───────────────────────────────────────────────────────────────

let _filesLoadedForAgent = null;
const _filesAuthAttempted = new WeakSet();

const renderFilesTab = (state) => {
  const locked = !state.unlockedTabs?.has("files") && hasRegisteredCredentials();
  if (locked) {
    if (!_filesAuthAttempted.has(state)) {
      _filesAuthAttempted.add(state);
      authenticateWithWebAuthn()
        .then((token) => {
          if (token) {
            state.unlockedTabs = new Set([...(state.unlockedTabs ?? []), "files"]);
          }
        })
        .catch(() => {});
    }
    return html`
      <div class="settings-tab-empty"><p class="muted">Authenticating…</p></div>
    `;
  }

  const active = (state.filesBrowserQueue ?? [])[0];
  const agentId = active?.agentId ?? "main";

  if (_filesLoadedForAgent !== agentId && !state.agentFilesLoading) {
    _filesLoadedForAgent = agentId;
    loadAgentFiles(state, agentId);
  }

  const list = state.agentFilesList?.agentId === agentId ? state.agentFilesList : null;
  const files = list?.files ?? [];

  // Auto-select first file when list loads and nothing is active
  if (files.length > 0 && !state.agentFileActive) {
    const first = files[0].name;
    state.agentFileActive = first;
    loadAgentFileContent(state, agentId, first);
  }

  const activeFile = state.agentFileActive ?? null;
  const baseContent = activeFile ? (state.agentFileContents[activeFile] ?? "") : "";
  const draftContent = activeFile ? (state.agentFileDrafts[activeFile] ?? baseContent) : "";
  const isDirty = activeFile ? draftContent !== baseContent : false;
  const activeEntry = activeFile ? (files.find((f) => f.name === activeFile) ?? null) : null;
  const isText = activeEntry?.contentType === "text" || activeEntry?.contentType === undefined;
  const isNonCore = activeEntry?.section !== "core";

  return html`
    <div class="exec-approval-sub" style="margin-bottom:0;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <span>${agentId.toUpperCase()}${state.agentFilesList?.workspace ? html` | <span class="mono">${state.agentFilesList.workspace}/${activeFile ?? ""}</span>` : nothing}</span>
      <span style="display:flex;gap:6px;align-items:center">
        ${
          activeEntry && isText
            ? html`
          <button class="btn btn--sm primary" ?disabled=${state.agentFileSaving || !isDirty}
            @click=${() => saveAgentFile(state, agentId, activeFile, draftContent)}
          >${state.agentFileSaving ? "Saving\u2026" : "Save"}</button>
        `
            : nothing
        }
        ${
          activeEntry && isNonCore
            ? html`
          <button class="btn btn--sm danger"
            @click=${() => {
              if (confirm("Delete " + activeFile + "?")) {
                deleteAgentFile(state, agentId, activeFile);
              }
            }}
          >Delete</button>
        `
            : nothing
        }
      </span>
    </div>
    <div class="files-browser-overlay__body">
      ${renderAgentFiles({
        agentId,
        agentFilesList: state.agentFilesList,
        agentFilesLoading: state.agentFilesLoading,
        agentFilesError: state.agentFilesError,
        agentFileActive: state.agentFileActive,
        agentFileContents: state.agentFileContents,
        agentFileDrafts: state.agentFileDrafts,
        agentFileSaving: state.agentFileSaving,
        onLoadFiles: (id) => loadAgentFiles(state, id),
        onSelectFile: (name) => {
          state.agentFileActive = name;
          loadAgentFileContent(state, agentId, name);
        },
        onFileDraftChange: (name, content) => {
          state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
        },
        onFileReset: (name) => {
          const base = state.agentFileContents[name] ?? "";
          state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
        },
        onFileSave: (name) => {
          const content = state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
          saveAgentFile(state, agentId, name, content);
        },
        onDeleteFile: (name) => deleteAgentFile(state, agentId, name),
      })}
    </div>
    ${state.filesBrowserError ? html`<div class="exec-approval-error">${state.filesBrowserError}</div>` : nothing}
  `;
};

// ─── Main modal ──────────────────────────────────────────────────────────────

const TAB_RENDERERS = {
  gateway: renderGatewayTab,
  config: renderConfigTab,
  files: renderFilesTab,
};

/**
 * Render the unified Settings modal.
 * @param {import("../app.js").GenosOSApp} state
 */
export function renderSettingsModal(state) {
  if (!state.settingsModalOpen) {
    return nothing;
  }

  const activeTab = state.settingsModalTab ?? "gateway";

  const dismiss = () => {
    state.settingsModalOpen = false;
    // Reset health vault cache for fresh data next open
    state._healthVaultStatus = null;
    state._healthVaultResult = null;
  };

  const switchTab = (tabId) => {
    state.settingsModalTab = tabId;
    // Reset health cache when switching to gateway tab
    if (tabId === "gateway") {
      state._healthVaultStatus = null;
      state._healthVaultResult = null;
    }
  };

  const renderer = TAB_RENDERERS[activeTab] ?? TAB_RENDERERS.gateway;

  return html`
    <div class="exec-approval-overlay" role="dialog"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          dismiss();
        }
      }}>
      <div class="exec-approval-card settings-modal__card">
        <div class="settings-modal__header">
          <div class="settings-modal__tabs" role="tablist">
            ${TABS.map(
              (tab) => html`
              <button
                role="tab"
                aria-selected=${activeTab === tab.id}
                class="settings-modal__tab ${activeTab === tab.id ? "settings-modal__tab--active" : ""}"
                @click=${() => switchTab(tab.id)}
              >${tab.label}</button>
            `,
            )}
          </div>
          <button class="btn btn--sm btn--icon" title="Close" @click=${dismiss}>
            ${icons.x}
          </button>
        </div>
        <div class="settings-modal__content">
          ${renderer(state)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Open the settings modal on a specific tab.
 * @param {import("../app.js").GenosOSApp} state
 * @param {string} [tab]
 */
export function openSettingsModal(state, tab = "gateway") {
  state.settingsModalTab = tab;
  state.settingsModalOpen = true;
}
