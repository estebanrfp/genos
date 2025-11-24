// GenosOS — Esteban & Nyx 🦀🌙
import { html, nothing } from "lit";

/**
 * Render the WebAuthn registration overlay triggered by an agent via chat.
 * Reuses the .exec-approval-* CSS classes for consistent overlay styling.
 * @param {object} state - GenosOSApp instance (host)
 * @returns {import("lit").TemplateResult}
 */
export function renderWebAuthnRegistrationOverlay(state) {
  const active = (state.webauthnRegQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const remaining = active.expiresAtMs - Date.now();
  const expired = remaining <= 0;

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Touch ID Registration</div>
            <div class="exec-approval-sub">${expired ? "expired" : `expires in ${Math.ceil(remaining / 1000)}s`}</div>
          </div>
        </div>
        <div class="exec-approval-command mono">🔐 ${active.displayName ?? "Touch ID"}</div>
        <div class="exec-approval-meta">
          <p>Place your finger on the sensor to register a new credential.</p>
        </div>
        ${
          state.webauthnRegError
            ? html`<div class="exec-approval-error">${state.webauthnRegError}</div>`
            : nothing
        }
        <div class="exec-approval-actions">
          <button class="btn primary" ?disabled=${state.webauthnRegBusy || expired}
            @click=${() => state.handleWebAuthnRegistration(active.id)}>
            ${state.webauthnRegBusy ? "Registering\u2026" : "Register Touch ID"}
          </button>
          <button class="btn danger" ?disabled=${state.webauthnRegBusy}
            @click=${() => state.dismissWebAuthnRegistration(active.id)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
}
