// GenosOS — Esteban & Nyx 🦀🌙
import { html, nothing } from "lit";

/**
 * Render the WhatsApp QR login overlay triggered by an agent via chat.
 * Reuses the .exec-approval-* CSS classes for consistent overlay styling.
 * @param {object} state - GenosOSApp instance (host)
 * @returns {import("lit").TemplateResult}
 */
export function renderWhatsAppQrOverlay(state) {
  const active = (state.whatsappQrQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const remaining = active.expiresAtMs - Date.now();
  const expired = remaining <= 0;

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          state.dismissWhatsAppQr(active.id);
        }
      }}>
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">WhatsApp QR Login</div>
            <div class="exec-approval-sub">${expired ? "expired" : `expires in ${Math.ceil(remaining / 1000)}s`}</div>
          </div>
        </div>
        ${
          active.qrDataUrl
            ? html`<div class="qr-wrap" style="text-align: center; padding: 16px 0;">
                <img src=${active.qrDataUrl} alt="WhatsApp QR Code" style="max-width: 256px; border-radius: 8px;" />
              </div>`
            : html`
                <div class="exec-approval-command mono">Waiting for QR code...</div>
              `
        }
        ${
          active.message
            ? html`<div class="exec-approval-meta"><p>${active.message}</p></div>`
            : nothing
        }
        ${
          state.whatsappQrError
            ? html`<div class="exec-approval-error">${state.whatsappQrError}</div>`
            : nothing
        }
        <div class="exec-approval-actions">
          <button class="btn primary" ?disabled=${state.whatsappQrBusy || expired}
            @click=${() => state.handleWhatsAppQrWait(active.id)}>
            ${state.whatsappQrBusy ? "Waiting\u2026" : "I scanned it"}
          </button>
          <button class="btn danger" ?disabled=${state.whatsappQrBusy}
            @click=${() => state.dismissWhatsAppQr(active.id)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
}
