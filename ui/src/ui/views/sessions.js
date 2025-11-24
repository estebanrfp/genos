let normalizeProviderId = function (provider) {
    if (!provider) {
      return "";
    }
    const normalized = provider.trim().toLowerCase();
    if (normalized === "z.ai" || normalized === "z-ai") {
      return "zai";
    }
    return normalized;
  },
  isBinaryThinkingProvider = function (provider) {
    return normalizeProviderId(provider) === "zai";
  },
  resolveThinkLevelOptions = function (provider) {
    return isBinaryThinkingProvider(provider) ? BINARY_THINK_LEVELS : THINK_LEVELS;
  },
  withCurrentOption = function (options, current) {
    if (!current) {
      return [...options];
    }
    if (options.includes(current)) {
      return [...options];
    }
    return [...options, current];
  },
  withCurrentLabeledOption = function (options, current) {
    if (!current) {
      return [...options];
    }
    if (options.some((option) => option.value === current)) {
      return [...options];
    }
    return [...options, { value: current, label: `${current} (custom)` }];
  },
  resolveThinkLevelDisplay = function (value, isBinary) {
    if (!isBinary) {
      return value;
    }
    if (!value || value === "off") {
      return value;
    }
    return "on";
  },
  resolveThinkLevelPatchValue = function (value, isBinary) {
    if (!value) {
      return null;
    }
    if (!isBinary) {
      return value;
    }
    if (value === "on") {
      return "low";
    }
    return value;
  },
  renderRow = function (row, basePath, onPatch, onDelete, disabled) {
    const updated = row.updatedAt ? formatRelativeTimestamp(row.updatedAt) : "n/a";
    const rawThinking = row.thinkingLevel ?? "";
    const isBinaryThinking = isBinaryThinkingProvider(row.modelProvider);
    const thinking = resolveThinkLevelDisplay(rawThinking, isBinaryThinking);
    const thinkLevels = withCurrentOption(resolveThinkLevelOptions(row.modelProvider), thinking);
    const verbose = row.verboseLevel ?? "";
    const verboseLevels = withCurrentLabeledOption(VERBOSE_LEVELS, verbose);
    const reasoning = row.reasoningLevel ?? "";
    const reasoningLevels = withCurrentOption(REASONING_LEVELS, reasoning);
    const displayName =
      typeof row.displayName === "string" && row.displayName.trim().length > 0
        ? row.displayName.trim()
        : null;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const showDisplayName = Boolean(
      displayName && displayName !== row.key && displayName !== label,
    );
    const canLink = row.kind !== "global";
    const chatUrl = canLink
      ? `${pathForTab("chat", basePath)}?session=${encodeURIComponent(row.key)}`
      : null;
    return html`
    <div class="table-row">
      <div class="mono session-key-cell">
        ${canLink ? html`<a href=${chatUrl} class="session-link">${row.key}</a>` : row.key}
        ${showDisplayName ? html`<span class="muted session-key-display-name">${displayName}</span>` : nothing}
      </div>
      <div>
        <input
          .value=${row.label ?? ""}
          ?disabled=${disabled}
          placeholder="(optional)"
          @change=${(e) => {
            const value = e.target.value.trim();
            onPatch(row.key, { label: value || null });
          }}
        />
      </div>
      <div>${row.kind}</div>
      <div>${updated}</div>
      <div>${formatSessionTokens(row)}</div>
      <div>
        <select
          ?disabled=${disabled}
          @change=${(e) => {
            const value = e.target.value;
            onPatch(row.key, {
              thinkingLevel: resolveThinkLevelPatchValue(value, isBinaryThinking),
            });
          }}
        >
          ${thinkLevels.map(
            (level) => html`<option value=${level} ?selected=${thinking === level}>
                ${level || "inherit"}
              </option>`,
          )}
        </select>
      </div>
      <div>
        <select
          ?disabled=${disabled}
          @change=${(e) => {
            const value = e.target.value;
            onPatch(row.key, { verboseLevel: value || null });
          }}
        >
          ${verboseLevels.map(
            (level) => html`<option value=${level.value} ?selected=${verbose === level.value}>
                ${level.label}
              </option>`,
          )}
        </select>
      </div>
      <div>
        <select
          ?disabled=${disabled}
          @change=${(e) => {
            const value = e.target.value;
            onPatch(row.key, { reasoningLevel: value || null });
          }}
        >
          ${reasoningLevels.map(
            (level) => html`<option value=${level} ?selected=${reasoning === level}>
                ${level || "inherit"}
              </option>`,
          )}
        </select>
      </div>
      <div>
        <button class="btn danger" ?disabled=${disabled} @click=${() => onDelete(row.key)}>
          Delete
        </button>
      </div>
    </div>
  `;
  };
import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.js";
import { pathForTab } from "../navigation.js";
import { formatSessionTokens } from "../presenter.js";
export {
  isBinaryThinkingProvider,
  resolveThinkLevelOptions,
  resolveThinkLevelDisplay,
  resolveThinkLevelPatchValue,
  withCurrentOption,
  withCurrentLabeledOption,
};
export const THINK_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"];
export const BINARY_THINK_LEVELS = ["", "off", "on"];
export const VERBOSE_LEVELS = [
  { value: "", label: "inherit" },
  { value: "off", label: "off (explicit)" },
  { value: "on", label: "on" },
  { value: "full", label: "full" },
];
export const REASONING_LEVELS = ["", "off", "on", "stream"];
export function renderSessions(props) {
  const rows = props.result?.sessions ?? [];
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Sessions</div>
          <div class="card-sub">Active session keys and per-session overrides.</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading\u2026" : "Refresh"}
        </button>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field">
          <span>Active within (minutes)</span>
          <input
            .value=${props.activeMinutes}
            @input=${(e) =>
              props.onFiltersChange({
                activeMinutes: e.target.value,
                limit: props.limit,
                includeGlobal: props.includeGlobal,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field">
          <span>Limit</span>
          <input
            .value=${props.limit}
            @input=${(e) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: e.target.value,
                includeGlobal: props.includeGlobal,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field checkbox">
          <span>Include global</span>
          <input
            type="checkbox"
            .checked=${props.includeGlobal}
            @change=${(e) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: props.limit,
                includeGlobal: e.target.checked,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field checkbox">
          <span>Include unknown</span>
          <input
            type="checkbox"
            .checked=${props.includeUnknown}
            @change=${(e) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: props.limit,
                includeGlobal: props.includeGlobal,
                includeUnknown: e.target.checked,
              })}
          />
        </label>
      </div>

      ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}

      <div class="muted" style="margin-top: 12px;">
        ${props.result ? `Store: ${props.result.path}` : ""}
      </div>

      <div class="table" style="margin-top: 16px;">
        <div class="table-head">
          <div>Key</div>
          <div>Label</div>
          <div>Kind</div>
          <div>Updated</div>
          <div>Tokens</div>
          <div>Thinking</div>
          <div>Verbose</div>
          <div>Reasoning</div>
          <div>Actions</div>
        </div>
        ${
          rows.length === 0
            ? html`
                <div class="muted">No sessions found.</div>
              `
            : rows.map((row) =>
                renderRow(row, props.basePath, props.onPatch, props.onDelete, props.loading),
              )
        }
      </div>
    </section>
  `;
}
