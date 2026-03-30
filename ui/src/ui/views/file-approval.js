import { html, nothing } from "lit";

const formatRemaining = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
};

/**
 * Render the biometric file-approval overlay.
 * @param {object} state
 * @returns {import("lit").TemplateResult}
 */
export function renderFileApprovalPrompt(state) {
  const active = (state.fileApprovalQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const remaining = active.expiresAtMs - Date.now();
  const expiryLabel = remaining > 0 ? `expires in ${formatRemaining(remaining)}` : "expired";
  const queueCount = state.fileApprovalQueue.length;

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Protected file — approval needed</div>
            <div class="exec-approval-sub">${expiryLabel}</div>
          </div>
          ${queueCount > 1 ? html`<div class="exec-approval-queue">${queueCount} pending</div>` : nothing}
        </div>

        <div class="exec-approval-command mono">${active.operation === "edit" ? "✏️" : "📝"} ${active.name}</div>

        <div class="exec-approval-meta">
          <div class="exec-approval-meta-row"><span>Agent</span><span>${active.agentId ?? "—"}</span></div>
          <div class="exec-approval-meta-row"><span>Operation</span><span>${active.operation}</span></div>
        </div>

        ${
          active.preview
            ? html`<pre class="exec-approval-command mono" style="white-space:pre-wrap;font-size:0.78em;max-height:8em;overflow:auto">${active.preview}</pre>`
            : nothing
        }

        ${
          state.fileApprovalError
            ? html`<div class="exec-approval-error">${state.fileApprovalError}</div>`
            : nothing
        }

        <div class="exec-approval-actions">
          <button
            class="btn primary"
            ?disabled=${state.fileApprovalBusy}
            @click=${() => state.handleFileApprovalDecision(active.id, "approve")}
          >
            Approve (Touch ID)
          </button>
          <button
            class="btn danger"
            ?disabled=${state.fileApprovalBusy}
            @click=${() => state.handleFileApprovalDecision(active.id, "deny")}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  `;
}
