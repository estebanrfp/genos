let formatTime = function (value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleTimeString();
  },
  matchesFilter = function (entry, needle) {
    if (!needle) {
      return true;
    }
    const haystack = [entry.message, entry.subsystem, entry.raw]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  };
import { html, nothing } from "lit";
const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
export function renderLogs(props) {
  const needle = props.filterText.trim().toLowerCase();
  const levelFiltered = LEVELS.some((level) => !props.levelFilters[level]);
  const filtered = props.entries.filter((entry) => {
    if (entry.level && !props.levelFilters[entry.level]) {
      return false;
    }
    return matchesFilter(entry, needle);
  });
  const exportLabel = needle || levelFiltered ? "filtered" : "visible";
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Logs</div>
          <div class="card-sub">Gateway file logs (JSONL).</div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Loading\u2026" : "Refresh"}
          </button>
          <button
            class="btn"
            ?disabled=${filtered.length === 0}
            @click=${() =>
              props.onExport(
                filtered.map((entry) => entry.raw),
                exportLabel,
              )}
          >
            Export ${exportLabel}
          </button>
        </div>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="min-width: 220px;">
          <span>Filter</span>
          <input
            .value=${props.filterText}
            @input=${(e) => props.onFilterTextChange(e.target.value)}
            placeholder="Search logs"
          />
        </label>
        <label class="field checkbox">
          <span>Auto-follow</span>
          <input
            type="checkbox"
            .checked=${props.autoFollow}
            @change=${(e) => props.onToggleAutoFollow(e.target.checked)}
          />
        </label>
      </div>

      <div class="chip-row" style="margin-top: 12px;">
        ${LEVELS.map(
          (level) => html`
            <label class="chip log-chip ${level}">
              <input
                type="checkbox"
                .checked=${props.levelFilters[level]}
                @change=${(e) => props.onLevelToggle(level, e.target.checked)}
              />
              <span>${level}</span>
            </label>
          `,
        )}
      </div>

      ${props.file ? html`<div class="muted" style="margin-top: 10px;">File: ${props.file}</div>` : nothing}
      ${
        props.truncated
          ? html`
              <div class="callout" style="margin-top: 10px">Log output truncated; showing latest chunk.</div>
            `
          : nothing
      }
      ${props.error ? html`<div class="callout danger" style="margin-top: 10px;">${props.error}</div>` : nothing}

      <div class="log-stream" style="margin-top: 12px;" @scroll=${props.onScroll}>
        ${
          filtered.length === 0
            ? html`
                <div class="muted" style="padding: 12px">No log entries.</div>
              `
            : filtered.map(
                (entry) => html`
                <div class="log-row">
                  <div class="log-time mono">${formatTime(entry.time)}</div>
                  <div class="log-level ${entry.level ?? ""}">${entry.level ?? ""}</div>
                  <div class="log-subsystem mono">${entry.subsystem ?? ""}</div>
                  <div class="log-message mono">${entry.message ?? entry.raw}</div>
                </div>
              `,
              )
        }
      </div>
    </section>
  `;
}
