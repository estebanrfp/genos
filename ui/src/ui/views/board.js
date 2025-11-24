import { html, nothing } from "lit";
import { filterActivity } from "../controllers/board.js";

const formatTime = (ts) => {
  if (!ts) {
    return "";
  }
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const highlightMatch = (text, query) => {
  if (!query) {
    return text;
  }
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) {
    return text;
  }
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return html`${before}<mark>${match}</mark>${after}`;
};

const renderAddCardForm = (props, colId) => html`
  <form
    class="board-add-form"
    @submit=${(e) => {
      e.preventDefault();
      const form = e.target;
      const title = form.elements.title.value.trim();
      if (!title) {
        return;
      }
      props.onAddCard(colId, { title, description: form.elements.desc.value.trim() });
      form.reset();
    }}
  >
    <input name="title" class="board-search-input" placeholder="Card title" required />
    <input name="desc" class="board-search-input" placeholder="Description (optional)" />
    <button type="submit" class="chip chip-ok">Add</button>
  </form>
`;

/** Source badge for auto-generated cards. */
const SOURCE_LABELS = { session: "Session", cron: "Cron", agent: "Agent", channel: "Channel" };

const renderCard = (card, col, columns, props) => {
  const isManual = card.source === "manual" || !card.source;
  const canDrag = isManual || card.draggable;
  const canRemove = isManual;
  const colIdx = columns.indexOf(col);
  return html`
    <div
      class="board-card ${isManual ? "" : "board-card--live"} ${canDrag ? "board-card--draggable" : ""}"
      draggable=${canDrag ? "true" : "false"}
      @dragstart=${
        canDrag
          ? (e) => {
              e.dataTransfer.setData("text/plain", card.id);
              e.dataTransfer.setData("application/x-column", col.id);
              e.currentTarget.classList.add("dragging");
            }
          : nothing
      }
      @dragend=${(e) => e.currentTarget.classList.remove("dragging")}
    >
      <div class="board-card-header">
        <div class="board-card-title">${card.title}</div>
        ${
          card.source && SOURCE_LABELS[card.source]
            ? html`<span class="chip chip--xs board-chip-${card.source}">${SOURCE_LABELS[card.source]}</span>`
            : nothing
        }
      </div>
      ${card.description ? html`<div class="board-card-desc">${card.description}</div>` : nothing}
      <div class="board-card-time">${formatTime(card.createdAt)}</div>
      ${
        canDrag || canRemove
          ? html`
            <div class="board-card-actions">
              ${
                canDrag && colIdx > 0
                  ? html`<button class="chip chip--sm" title="Move left"
                    @click=${() => props.onMoveCard(card.id, col.id, columns[colIdx - 1].id)}>&larr;</button>`
                  : nothing
              }
              ${
                canDrag && colIdx < columns.length - 1
                  ? html`<button class="chip chip--sm" title="Move right"
                    @click=${() => props.onMoveCard(card.id, col.id, columns[colIdx + 1].id)}>&rarr;</button>`
                  : nothing
              }
              ${
                canRemove
                  ? html`<button class="chip chip--sm chip-danger" title="Remove"
                    @click=${() => props.onRemoveCard(card.id, col.id)}>&times;</button>`
                  : nothing
              }
            </div>
          `
          : nothing
      }
    </div>
  `;
};

const renderKanban = (props) => {
  const columns = props.columns ?? [];
  return html`
    <div class="board-columns">
      ${columns.map(
        (col) => html`
          <div
            class="board-column"
            @dragover=${(e) => {
              e.preventDefault();
              e.currentTarget.classList.add("drag-over");
            }}
            @dragleave=${(e) => e.currentTarget.classList.remove("drag-over")}
            @drop=${(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("drag-over");
              const cardId = e.dataTransfer.getData("text/plain");
              const fromCol = e.dataTransfer.getData("application/x-column");
              if (cardId && fromCol) {
                props.onMoveCard(cardId, fromCol, col.id);
              }
            }}
          >
            <div class="board-column-header">
              <span>${col.label}</span>
              <span class="chip chip--sm">${col.cards.length}</span>
            </div>
            ${col.cards.map((card) => renderCard(card, col, columns, props))}
            ${renderAddCardForm(props, col.id)}
          </div>
        `,
      )}
    </div>
  `;
};

const ACTIVITY_FILTERS = ["all", "chat", "agent", "cron"];

/**
 * Summarize an event payload into a readable string.
 * @param {object} evt - { ts, event, payload }
 * @returns {string}
 */
const summarizePayload = (evt) => {
  const p = evt?.payload;
  if (!p) {
    return "";
  }
  if (typeof p === "string") {
    return p;
  }
  // Common payload fields
  const parts = [];
  if (p.channel) {
    parts.push(p.channel);
  }
  if (p.sessionKey) {
    parts.push(`session: ${p.sessionKey}`);
  }
  if (p.agentId) {
    parts.push(`agent: ${p.agentId}`);
  }
  if (p.message) {
    parts.push(p.message);
  }
  if (p.text) {
    parts.push(p.text);
  }
  if (p.jobId) {
    parts.push(`job: ${p.jobId}`);
  }
  if (p.status) {
    parts.push(p.status);
  }
  if (p.error) {
    parts.push(p.error);
  }
  if (parts.length > 0) {
    return parts.join(" \u00b7 ");
  }
  // Fallback: show first few keys
  const keys = Object.keys(p).slice(0, 4);
  return keys.length > 0 ? keys.join(", ") : "";
};

/** Map event names to category chips for coloring. */
const eventCategory = (event) => {
  if (!event) {
    return "";
  }
  const e = event.toLowerCase();
  if (e.includes("chat") || e.includes("message")) {
    return "chat";
  }
  if (e.includes("agent") || e.includes("run")) {
    return "agent";
  }
  if (e.includes("cron") || e.includes("schedule")) {
    return "cron";
  }
  return "";
};

const renderActivitySection = (props) => {
  const events = filterActivity(props.events ?? [], props.activityFilter);
  return html`
    <div class="board-tabs">
      ${ACTIVITY_FILTERS.map(
        (f) => html`
          <button
            class="chip ${props.activityFilter === f ? "chip-ok" : ""}"
            @click=${() => props.onActivityFilterChange(f)}
          >
            ${f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        `,
      )}
    </div>
    <div class="board-activity">
      ${
        events.length === 0
          ? html`
              <div class="board-empty">No activity events yet.</div>
            `
          : events.map(
              (e) => html`
              <div class="board-activity-entry">
                <span class="board-card-time">${formatTime(e?.ts)}</span>
                <span>
                  <span class="chip chip--sm board-chip-${eventCategory(e?.event)}">${e?.event ?? "event"}</span>
                  <span class="board-activity-summary">${summarizePayload(e)}</span>
                </span>
              </div>
            `,
            )
      }
    </div>
  `;
};

const renderSearchSection = (props) => html`
  <div class="board-search-wrap">
    <input
      class="board-search-input"
      type="search"
      placeholder="Search board cards... (Cmd+K)"
      .value=${props.searchQuery}
      @input=${(e) => props.onSearchChange(e.target.value)}
    />
  </div>
  ${
    props.searchResults.length > 0
      ? html`
        <div class="board-activity">
          ${props.searchResults.map(
            (r) => html`
              <div class="board-activity-entry">
                <span class="chip chip--sm">${r.columnLabel}</span>
                <span>
                  <div class="board-card-title">${highlightMatch(r.title, props.searchQuery)}</div>
                  ${
                    r.description
                      ? html`<div class="board-card-desc">
                        ${highlightMatch(r.description, props.searchQuery)}
                      </div>`
                      : nothing
                  }
                </span>
              </div>
            `,
          )}
        </div>
      `
      : props.searchQuery
        ? html`
            <div class="board-empty">No matches found.</div>
          `
        : html`
            <div class="board-empty">Type to search across board cards.</div>
          `
  }
`;

/**
 * Render the Board tab view.
 * @param {object} props
 */
export const renderBoard = (props) => html`
  <div class="board-tabs">
    <button
      class="chip ${props.section === "kanban" ? "chip-ok" : ""}"
      @click=${() => props.onSectionChange("kanban")}
    >
      Kanban
    </button>
    <button
      class="chip ${props.section === "activity" ? "chip-ok" : ""}"
      @click=${() => props.onSectionChange("activity")}
    >
      Activity
    </button>
    <button
      class="chip ${props.section === "search" ? "chip-ok" : ""}"
      @click=${() => props.onSectionChange("search")}
    >
      Search
    </button>
  </div>

  ${props.section === "kanban" ? renderKanban(props) : nothing}
  ${props.section === "activity" ? renderActivitySection(props) : nothing}
  ${props.section === "search" ? renderSearchSection(props) : nothing}
`;
