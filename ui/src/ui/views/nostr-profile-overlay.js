// GenosOS — Esteban & Nyx 🦀🌙
import { html, nothing } from "lit";
import {
  renderNostrProfileForm,
  createNostrProfileFormState,
} from "./channels.nostr-profile-form.js";

/**
 * Render the Nostr profile editor overlay triggered by an agent via chat.
 * Reuses the .exec-approval-* CSS classes for consistent overlay styling.
 * @param {object} state - GenosOSApp instance (host)
 * @returns {import("lit").TemplateResult}
 */
export function renderNostrProfileOverlay(state) {
  const active = (state.nostrEditQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const remaining = active.expiresAtMs - Date.now();
  const expired = remaining <= 0;

  // Initialize form state on first render if not yet created
  if (!state.nostrEditFormState) {
    state.nostrEditFormState = createNostrProfileFormState(active.profile);
  }

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          state.dismissNostrEdit(active.id);
        }
      }}>
      <div class="exec-approval-card" style="max-width: 560px;">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Edit Nostr Profile</div>
            <div class="exec-approval-sub">
              ${active.accountId ?? "default"} &mdash;
              ${expired ? "expired" : `expires in ${Math.ceil(remaining / 1000)}s`}
            </div>
          </div>
        </div>
        ${
          state.nostrEditError
            ? html`<div class="exec-approval-error">${state.nostrEditError}</div>`
            : nothing
        }
        ${renderNostrProfileForm({
          state: state.nostrEditFormState,
          accountId: active.accountId ?? "default",
          callbacks: {
            onFieldChange: (field, value) => {
              if (!state.nostrEditFormState) {
                return;
              }
              state.nostrEditFormState = {
                ...state.nostrEditFormState,
                values: { ...state.nostrEditFormState.values, [field]: value },
              };
              state.requestUpdate();
            },
            onSave: () => state.handleNostrEditSave(active.id),
            onImport: () => state.handleNostrEditImport(active.id),
            onToggleAdvanced: () => {
              if (!state.nostrEditFormState) {
                return;
              }
              state.nostrEditFormState = {
                ...state.nostrEditFormState,
                showAdvanced: !state.nostrEditFormState.showAdvanced,
              };
              state.requestUpdate();
            },
            onCancel: () => state.dismissNostrEdit(active.id),
          },
        })}
      </div>
    </div>
  `;
}
