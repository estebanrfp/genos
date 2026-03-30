import { html, nothing } from "lit";
import { loadChannels } from "../controllers/channels.js";
import { icons } from "../icons.js";
import { hasRegisteredCredentials } from "./webauthn-panel.js";

/**
 * Format milliseconds into a human-readable uptime string.
 * @param {number} ms
 * @returns {string}
 */
const formatUptime = (ms) => {
  if (!ms || ms < 0) {
    return "—";
  }
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * Render a single stat card.
 * @param {import("lit").TemplateResult} icon
 * @param {string} label
 * @param {string} value
 * @param {string} [colorClass]
 */
const statCard = (icon, label, value, colorClass = "") => html`
  <div class="health-stat">
    <div class="health-stat__label">${icon}<span>${label}</span></div>
    <div class="health-stat__value ${colorClass}">${value}</div>
  </div>
`;

/**
 * Render the gateway health status modal overlay.
 * @param {import("../app.js").GenosOSApp} state
 */
export function renderHealthModal(state) {
  if (!state.healthModalOpen) {
    return nothing;
  }

  const dismiss = () => {
    state.healthModalOpen = false;
  };

  // Fetch fresh data on each open (fire-and-forget)
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
    // Ensure channels snapshot is fresh (normally lazy-loaded)
    loadChannels(state, false);
  }

  const snapshot = state.hello?.snapshot;
  const uptimeMs = snapshot?.uptimeMs ?? state.hello?.uptimeMs;
  const version = state.hello?.server?.version ?? "—";
  const authMode = snapshot?.authMode ?? "—";
  const instances = snapshot?.presence?.length ?? 0;
  const cs = state.channelsSnapshot;
  const channels =
    cs?.channelOrder?.length ?? cs?.channelMeta?.length ?? Object.keys(cs?.channels ?? {}).length;
  const sessions = state.sessionsResult?.sessions?.length ?? 0;

  // Vault — RPC returns { locked, lastActivity, autoLockMs, idleMs }
  const vaultRes = state._healthVaultResult;
  const vaultFailed = state._healthVaultStatus === "error";
  const vaultLocked = vaultRes?.locked === true;
  const vaultLabel = vaultFailed
    ? "Unavailable"
    : !vaultRes
      ? "—"
      : vaultLocked
        ? "Locked"
        : "Unlocked";
  const vaultColor = vaultFailed ? "muted" : !vaultRes ? "muted" : vaultLocked ? "warn" : "ok";

  // WebAuthn
  const webauthn = hasRegisteredCredentials();
  const webauthnLabel = webauthn ? "Active" : "None";
  const webauthnColor = webauthn ? "ok" : "muted";

  return html`
    <div
      class="exec-approval-overlay"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          dismiss();
        }
      }}
    >
      <div class="exec-approval-card health-modal-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title" style="display:flex;align-items:center;gap:8px">
              <span class="health-modal-icon">${icons.shield}</span>
              Gateway Health
            </div>
            <div class="exec-approval-sub">System status at a glance</div>
          </div>
        </div>

        <div class="health-modal-grid">
          ${statCard(icons.zap, "Uptime", formatUptime(uptimeMs), "ok")}
          ${statCard(icons.shield, "Vault", vaultLabel, vaultColor)}
          ${statCard(icons.check, "Auth", authMode)}
          ${statCard(icons.plug, "WebAuthn", webauthnLabel, webauthnColor)}
          ${statCard(icons.monitor, "Instances", String(instances), instances > 0 ? "ok" : "muted")}
          ${statCard(icons.link, "Channels", String(channels), channels > 0 ? "ok" : "muted")}
          ${statCard(icons.messageSquare, "Sessions", String(sessions), sessions > 0 ? "" : "muted")}
          ${statCard(icons.globe, "Version", version)}
        </div>

        <div class="health-modal-footer">
          <button class="btn" @click=${dismiss}>Close</button>
        </div>
      </div>
    </div>
  `;
}
