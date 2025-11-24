// GenosOS — Esteban & Nyx
import { html, nothing } from "lit";
import { loadLogs } from "../controllers/logs.js";
import { renderLogs } from "./logs.js";

/**
 * Render the logs view overlay — live log viewer inside a modal.
 * @param {object} state - GenosOSApp instance (host)
 * @returns {import("lit").TemplateResult}
 */
export function renderLogsViewOverlay(state) {
  const active = (state.logsViewQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const filters = active.filters ?? {};
  const filterSummary = [
    ...(filters.levels?.length ? [`levels: ${filters.levels.join(", ")}`] : []),
    ...(filters.text ? [`search: "${filters.text}"`] : []),
  ].join(" · ");

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          state.dismissLogsView(active.id);
        }
      }}>
      <div class="exec-approval-card logs-view-overlay__card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Gateway Logs</div>
            <div class="exec-approval-sub">
              ${filterSummary || "Live tail — all levels"}
            </div>
          </div>
        </div>

        <div class="logs-view-overlay__body">
          ${renderLogs({
            loading: state.logsLoading,
            error: state.logsError,
            file: state.logsFile,
            entries: state.logsEntries,
            filterText: state.logsFilterText,
            levelFilters: state.logsLevelFilters,
            autoFollow: state.logsAutoFollow,
            truncated: state.logsTruncated,
            onFilterTextChange: (next) => (state.logsFilterText = next),
            onLevelToggle: (level, enabled) => {
              state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
            },
            onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
            onRefresh: () => loadLogs(state, { reset: true }),
            onExport: (lines, label) => state.exportLogs(lines, label),
            onScroll: (event) => state.handleLogsScroll(event),
          })}
        </div>

        ${
          state.logsViewError
            ? html`<div class="exec-approval-error">${state.logsViewError}</div>`
            : nothing
        }

        <div class="exec-approval-actions">
          <button class="btn" @click=${() => loadLogs(state, { reset: true })}>Refresh</button>
          <button
            class="btn primary"
            ?disabled=${state.logsViewBusy}
            @click=${() => state.dismissLogsView(active.id)}
          >Close</button>
        </div>
      </div>
    </div>
  `;
}
