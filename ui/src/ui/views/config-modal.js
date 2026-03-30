// GenosOS — Esteban & Nyx
import { html, nothing } from "lit";
import { icons } from "../icons.js";
import { openConfigEditor } from "./config-editor-overlay.js";
import { sidebarIcons } from "./config.js";

/** @type {ReadonlyArray<{key: string, label: string, desc: string, icon: string}>} */
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
  { key: "sessions", label: "Sessions", desc: "Active conversations", icon: "channels" },
  { key: "security", label: "Security", desc: "Permissions & restrictions", icon: "auth" },
];

/** @type {Record<string, string[]>} */
const CONFIG_MAP_HINTS = {
  providers: ["Show me my providers", "Add an OpenAI API key", "Pause the Anthropic provider"],
  agents: ["List my agents", "Create a new agent", "Delete an agent"],
  channels: ["Connect WhatsApp", "Enable Telegram", "Connect Signal"],
  skills: ["Show me the skills", "Enable the tavily skill", "Install a new skill"],
  cron: ["Show me the cron board", "Add a daily reminder at 9am", "List all cron jobs"],
  sessions: ["List my sessions", "What model am I using?", "Reset this conversation"],
  security: ["Show permissions", "Show channel restrictions", "Harden security"],
};

const OVERLAY_SECTIONS = new Set(["providers", "agents", "channels", "skills", "cron"]);

/** Quick commands shown at the top of the Config Map. */
const QUICK_COMMANDS = [
  { cmd: "/providers", desc: "AI model providers" },
  { cmd: "/agents", desc: "My agents" },
  { cmd: "/channels", desc: "My channels" },
  { cmd: "/skills", desc: "My skills" },
  { cmd: "/cron", desc: "My scheduled tasks" },
  { cmd: "/reset", desc: "New conversation" },
  { cmd: "/compact", desc: "Compact transcript" },
];

/**
 * Pre-fill chat input with a phrase and close the config modal.
 * @param {import("../app.js").GenosOSApp} state
 * @param {string} phrase
 */
const prefillChat = (state, phrase) => {
  state.chatMessage = phrase;
  state.configModalOpen = false;
  requestAnimationFrame(() => {
    const textarea = document.querySelector(".chat-compose__field textarea");
    textarea?.focus();
  });
};

/**
 * Render Config Map — discovery grid of all configurable sections.
 * @param {import("../app.js").GenosOSApp} state
 */
export function renderConfigModal(state) {
  if (!state.configModalOpen) {
    return nothing;
  }

  const dismiss = () => {
    state.configModalOpen = false;
  };

  return html`
    <div
      class="exec-approval-overlay"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          dismiss();
        }
      }}
    >
      <div class="exec-approval-card config-modal-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Config Map</div>
            <div class="exec-approval-sub">Click a phrase to ask the assistant</div>
          </div>
        </div>

        <div class="config-modal-body">
          <div class="config-map__commands">
            ${QUICK_COMMANDS.map(
              (c) => html`
              <span
                class="config-map__cmd"
                @click=${() => prefillChat(state, c.cmd)}
              ><code>${c.cmd}</code> \u2014 ${c.desc}</span>
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
                      <li
                        class="config-map__hint"
                        @click=${() => prefillChat(state, h)}
                      >\u201C${h}\u201D</li>
                    `,
                    )}
                  </ul>
                </div>
              `;
            })}
          </div>
        </div>

        <div class="exec-approval-actions">
          <button
            class="btn"
            @click=${() => {
              state.configModalOpen = false;
              openConfigEditor(state);
            }}
          >${icons.fileCode} Edit JSON</button>
          <button class="btn primary" @click=${dismiss}>Close</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Open the Config Map modal.
 * @param {import("../app.js").GenosOSApp} state
 */
export function openConfigModal(state) {
  state.configModalOpen = !state.configModalOpen;
}
