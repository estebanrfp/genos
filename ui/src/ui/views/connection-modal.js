import { html, nothing } from "lit";
import { renderConnection } from "./overview.js";

/**
 * Render the connection settings as a modal overlay.
 * Reuses renderConnection() — no form duplication.
 * @param {import("../app.js").GenosOSApp} state
 */
export function renderConnectionModal(state) {
  if (!state.connectionModalOpen) {
    return nothing;
  }

  const dismiss = () => {
    state.connectionModalOpen = false;
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
      <div class="exec-approval-card connection-modal-card">
        ${renderConnection({
          connected: state.connected,
          hello: state.hello,
          settings: state.settings,
          lastError: state.lastError,
          onSettingsChange: (next) => state.applySettings(next),
          onConnect: () => state.connect(),
        })}
        <div class="row" style="margin-top: 14px; justify-content: flex-end;">
          <button class="btn" @click=${dismiss}>Close</button>
        </div>
      </div>
    </div>
  `;
}
