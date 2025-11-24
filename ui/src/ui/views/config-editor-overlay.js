import hljs from "highlight.js/lib/common";
// GenosOS — Esteban & Nyx
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { loadConfig, saveConfig } from "../controllers/config.js";
import { hasRegisteredCredentials, authenticateWithWebAuthn } from "./webauthn-panel.js";

/** @type {boolean} Track whether auth was already attempted for current open. */
let _authAttempted = false;

/**
 * Highlight JSON string for display.
 * @param {string} raw
 * @returns {string}
 */
const highlightJson = (raw) => {
  try {
    return hljs.highlight(raw, { language: "json" }).value;
  } catch {
    return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }
};

/**
 * Sync scroll position between textarea and highlight backdrop.
 * @param {Event} e
 */
const syncScroll = (e) => {
  const textarea = e.target;
  const pre = textarea.parentElement?.querySelector(".config-editor__highlight");
  if (pre) {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }
};

/**
 * Render the raw config editor overlay (triggered by /config show).
 * @param {import("../app.js").GenosOSApp} state
 * @returns {import("lit").TemplateResult}
 */
export function renderConfigEditorOverlay(state) {
  if (!state.configEditorOpen) {
    _authAttempted = false;
    return nothing;
  }

  const locked = !state.unlockedTabs?.has("config-editor") && hasRegisteredCredentials();

  const dismiss = () => {
    state.configEditorOpen = false;
    state.configFormDirty = false;
    state.unlockedTabs = new Set(
      [...(state.unlockedTabs ?? [])].filter((t) => t !== "config-editor"),
    );
  };

  if (locked) {
    if (!_authAttempted) {
      _authAttempted = true;
      authenticateWithWebAuthn()
        .then((token) => {
          if (token) {
            state.unlockedTabs = new Set([...(state.unlockedTabs ?? []), "config-editor"]);
          } else {
            dismiss();
          }
        })
        .catch(() => dismiss());
    }
    return nothing;
  }

  const dirty = state.configRaw !== state.configRawOriginal;
  const saving = state.configSaving;
  const highlighted = highlightJson(state.configRaw);

  return html`
    <div
      class="exec-approval-overlay"
      role="dialog"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          dismiss();
        }
      }}
    >
      <div class="exec-approval-card config-editor__card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">genosos.json</div>
            <div class="exec-approval-sub">
              ${dirty ? "Unsaved changes" : "Sensitive values are redacted"}
            </div>
          </div>
        </div>

        <div class="config-editor__body">
          <div class="config-editor__wrapper">
            <pre class="config-editor__highlight" aria-hidden="true"><code class="hljs">${unsafeHTML(highlighted + "\n")}</code></pre>
            <textarea
              class="config-editor__textarea"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              .value=${state.configRaw}
              @input=${(e) => {
                state.configRaw = e.target.value;
                state.configFormDirty = true;
              }}
              @scroll=${syncScroll}
            ></textarea>
          </div>
        </div>

        ${
          state.lastError
            ? html`<div class="exec-approval-error">${state.lastError}</div>`
            : nothing
        }

        <div class="exec-approval-actions">
          <button
            class="btn primary"
            ?disabled=${!dirty || saving}
            @click=${async () => {
              await saveConfig(state);
              if (!state.lastError) {
                await loadConfig(state);
                state.configEditorOpen = false;
              }
            }}
          >${saving ? "Saving\u2026" : "Save"}</button>
          <button
            class="btn"
            ?disabled=${saving}
            @click=${() => {
              dismiss();
              state.configModalOpen = true;
            }}
          >Config Map</button>
          <button
            class="btn"
            ?disabled=${saving}
            @click=${dismiss}
          >Cancel</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Open the config editor overlay — loads fresh config first.
 * @param {import("../app.js").GenosOSApp} state
 */
export async function openConfigEditor(state) {
  state.configEditorOpen = true;
  state.lastError = null;
  await loadConfig(state);
}
