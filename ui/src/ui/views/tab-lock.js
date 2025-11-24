import { html, nothing } from "lit";
import { hasRegisteredCredentials } from "./webauthn-panel.js";

/** Human-readable labels for each protected tab. */
const TAB_LABELS = {
  agents: "Agents",
  tools: "Tools",
};

/** Subtitle shown per tab on the lock screen. */
const TAB_SUBTITLES = {
  agents: "Authenticate to access agents, files, and configuration.",
  tools: "Authenticate to modify tool permissions and security policy.",
};

/**
 * Render the generic tab lock screen.
 * Returns nothing if the tab is already unlocked or no credentials are registered.
 *
 * @param {string} tabName - Protected tab identifier ("files" | "config")
 * @param {{ unlockedTabs: Set<string>, tabLockBusy: boolean, unlockTab: (tab: string) => void }} state
 * @returns {import("lit").TemplateResult | typeof nothing}
 */
export function renderTabLock(tabName, state) {
  if (state.unlockedTabs.has(tabName) || !hasRegisteredCredentials()) {
    return nothing;
  }
  const label = TAB_LABELS[tabName] ?? tabName;
  const subtitle = TAB_SUBTITLES[tabName] ?? "Authenticate to access this section.";
  return html`
    <div class="tab-lock">
      <div class="tab-lock-card">
        <div class="tab-lock-icon">🔒</div>
        <div class="tab-lock-title">${label} — Protected</div>
        <div class="tab-lock-sub">${subtitle}</div>
        <button
          class="btn primary tab-lock-btn"
          ?disabled=${state.tabLockBusy}
          @click=${() => state.unlockTab(tabName)}
        >
          ${state.tabLockBusy ? "Authenticating\u2026" : "Unlock (Touch ID)"}
        </button>
      </div>
    </div>
  `;
}
