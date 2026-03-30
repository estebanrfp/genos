// GenosOS — Esteban & Nyx
import { html, nothing } from "lit";
import { addCard, moveCard, removeCard, searchBoard } from "../controllers/board.js";
import { renderBoard } from "./board.js";

/**
 * Render the cron board overlay — full board experience inside a modal.
 * @param {object} state - GenosOSApp instance (host)
 * @returns {import("lit").TemplateResult}
 */
export function renderCronBoardOverlay(state) {
  const active = (state.cronBoardQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const status = state.cronStatus ?? {};
  const jobCount = (state.cronJobs ?? []).length;

  const dismiss = () => state.dismissCronBoard(active.id);

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          dismiss();
        }
      }}>
      <div class="exec-approval-card settings-modal__card cron-board-overlay__card">
        <div class="settings-modal__header">
          <div class="exec-approval-sub" style="margin:0">Board ${
            status.active !== false
              ? html`
                  <span class="cron-board-overlay__active">● active</span>
                `
              : html`
                  <span class="cron-board-overlay__inactive">● inactive</span>
                `
          } · ${jobCount} job${jobCount !== 1 ? "s" : ""}${status.nextWakeAtMs ? html` · Next: ${new Date(status.nextWakeAtMs).toLocaleTimeString()}` : nothing}</div>
          <button class="btn btn--sm btn--icon" title="Close" @click=${dismiss}>×</button>
        </div>
        <div class="settings-modal__content">
          ${renderBoard({
            section: state.boardSection,
            columns: state.boardColumns,
            events: (state.eventLogBuffer ?? []).slice(0, 100),
            activityFilter: state.boardActivityFilter,
            searchQuery: state.boardSearchQuery,
            searchResults: state.boardSearchResults,
            onSectionChange: (s) => {
              state.boardSection = s;
            },
            onAddCard: (colId, card) => addCard(state, colId, card),
            onMoveCard: (cardId, from, to) => moveCard(state, cardId, from, to),
            onRemoveCard: (cardId, colId) => removeCard(state, cardId, colId),
            onActivityFilterChange: (f) => {
              state.boardActivityFilter = f;
            },
            onSearchChange: (q) => {
              state.boardSearchQuery = q;
              searchBoard(state, q);
            },
          })}
          ${state.cronBoardError ? html`<div class="exec-approval-error">${state.cronBoardError}</div>` : nothing}
        </div>
      </div>
    </div>
  `;
}
