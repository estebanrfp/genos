// GenosOS — Interactive chat component renderers (nyx-ui system)

/**
 * Escape HTML entities in user-provided text.
 * @param {string} text
 * @returns {string}
 */
const escapeHtml = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Render a button element with data-action attributes.
 * @param {object} action
 * @returns {string}
 */
const renderButton = (action) => {
  if (action.rpc) {
    return `<button class="ix-btn" data-action="rpc" data-rpc="${escapeHtml(action.rpc)}" data-value='${escapeHtml(JSON.stringify(action.value ?? {}))}'>${escapeHtml(action.label)}</button>`;
  }
  return `<button class="ix-btn" data-action="chat" data-value="${escapeHtml(action.chat ?? action.label)}">${escapeHtml(action.label)}</button>`;
};

/**
 * Render action buttons for an item.
 * @param {Array} actions
 * @returns {string}
 */
const renderActions = (actions) => {
  if (!actions?.length) {
    return "";
  }
  return `<div class="ix-actions">${actions.map(renderButton).join("")}</div>`;
};

/**
 * Render a semaphore dot span.
 * @param {string} [color]
 * @returns {string}
 */
const renderDot = (color) => {
  if (!color) {
    return "";
  }
  const cls = ["green", "yellow", "red", "gray"].includes(color) ? color : "gray";
  return `<span class="ix-dot ix-dot--${cls}"></span>`;
};

/**
 * Render a status-grid component — cards with semaphore dots.
 * @param {object} data
 * @returns {string}
 */
const renderStatusGrid = (data) => {
  const title = data.title ? `<div class="ix-title">${escapeHtml(data.title)}</div>` : "";
  const cards = (data.items ?? [])
    .map(
      (item) =>
        `<div class="ix-card">${`<div class="ix-card__header">${renderDot(item.dot)}<span class="ix-card__label">${escapeHtml(item.label)}</span></div>`}${
          item.status ? `<div class="ix-card__status">${escapeHtml(item.status)}</div>` : ""
        }${renderActions(item.actions)}</div>`,
    )
    .join("");
  return `<div class="ix-component ix-component--status-grid">${title}<div class="ix-grid">${cards}</div></div>`;
};

/**
 * Render a stat-bars component — horizontal bar chart.
 * @param {object} data
 * @returns {string}
 */
const renderStatBars = (data) => {
  const title = data.title ? `<div class="ix-title">${escapeHtml(data.title)}</div>` : "";
  const bars = (data.items ?? [])
    .map((item) => {
      const pct = Math.min(100, Math.max(0, Math.round((item.value / (item.max || 100)) * 100)));
      const step = Math.round(pct / 5) * 5;
      return `<div class="ix-bar"><div class="ix-bar__label">${escapeHtml(item.label)}</div><div class="ix-bar__track"><div class="ix-bar__fill ix-bar-w-${step}"></div></div>${
        item.detail ? `<div class="ix-bar__detail">${escapeHtml(item.detail)}</div>` : ""
      }</div>`;
    })
    .join("");
  return `<div class="ix-component ix-component--stat-bars">${title}${bars}</div>`;
};

/**
 * Detect if a string looks numeric (for right-alignment).
 * @param {string} val
 * @returns {boolean}
 */
const isNumeric = (val) => /^[$€£¥]?\s*[\d,.]+[%KMBkmb]?$/.test(String(val).trim());

/**
 * Render a data-table component — table with optional row actions.
 * @param {object} data
 * @returns {string}
 */
const renderDataTable = (data) => {
  const title = data.title ? `<div class="ix-title">${escapeHtml(data.title)}</div>` : "";
  const cols = data.columns ?? [];
  const allRows = data.rows ?? [];
  // Detect numeric columns for right-alignment
  const numericCols = cols.map(
    (_, i) => allRows.length > 0 && allRows.every((r) => isNumeric(r.cells?.[i] ?? "")),
  );
  // Detect min/max per numeric column for highlights
  const colValues = cols.map((_, i) =>
    numericCols[i]
      ? allRows.map(
          (r) => parseFloat(String(r.cells?.[i] ?? "0").replace(/[$€£¥,%KMBkmb\s]/g, "")) || 0,
        )
      : null,
  );
  const colMax = colValues.map((v) => (v ? Math.max(...v) : null));
  const colMin = colValues.map((v) => (v ? Math.min(...v) : null));
  const hasActions = allRows.some((r) => r.actions?.length);
  const thead = cols.length
    ? `<thead><tr>${cols.map((c, i) => `<th${numericCols[i] ? ' class="ix-num"' : ""}>${escapeHtml(c)}</th>`).join("")}${hasActions ? "<th></th>" : ""}</tr></thead>`
    : "";
  const rows = allRows
    .map((row, ri) => {
      const dotHtml = row.dot ? renderDot(row.dot) : "";
      const cells = (row.cells ?? [])
        .map((cell, i) => {
          const cls = [];
          if (numericCols[i]) {
            cls.push("ix-num");
          }
          if (colValues[i] && colValues[i][ri] === colMax[i] && allRows.length > 2) {
            cls.push("ix-val-max");
          }
          if (
            colValues[i] &&
            colValues[i][ri] === colMin[i] &&
            colMin[i] !== colMax[i] &&
            allRows.length > 2
          ) {
            cls.push("ix-val-min");
          }
          const clsAttr = cls.length ? ` class="${cls.join(" ")}"` : "";
          return `<td${clsAttr}>${i === 0 ? dotHtml : ""}${escapeHtml(cell)}</td>`;
        })
        .join("");
      const actionCell = hasActions
        ? `<td>${row.actions?.length ? renderActions(row.actions) : ""}</td>`
        : "";
      return `<tr>${cells}${actionCell}</tr>`;
    })
    .join("");
  return `<div class="ix-component ix-component--data-table">${title}<table class="ix-table">${thead}<tbody>${rows}</tbody></table></div>`;
};

/**
 * Render a key-value component — detail pairs.
 * @param {object} data
 * @returns {string}
 */
const renderKeyValue = (data) => {
  const title = data.title ? `<div class="ix-title">${escapeHtml(data.title)}</div>` : "";
  const pairs = (data.pairs ?? [])
    .map(
      (pair) =>
        `<div class="ix-kv">${renderDot(pair.dot)}<span class="ix-kv__key">${escapeHtml(pair.key)}</span><span class="ix-kv__value">${escapeHtml(pair.value)}</span></div>`,
    )
    .join("");
  return `<div class="ix-component ix-component--key-value">${title}${pairs}</div>`;
};

let _chartSeq = 0;

/**
 * Render a chart component — placeholder that gets initialized post-render.
 * Supports: line, bar, pie, donut, percentage, heatmap, mixed-axis.
 * @param {object} data
 * @returns {string}
 */
const renderChart = (data) => {
  const id = `ix-chart-${Date.now()}-${++_chartSeq}`;
  const title = data.title ? `<div class="ix-title">${escapeHtml(data.title)}</div>` : "";
  const config = JSON.stringify({
    chartType: data.chartType ?? "bar",
    data: data.data ?? {},
    height: data.height ?? 220,
    colors: data.colors,
    axisOptions: data.axisOptions,
    barOptions: data.barOptions,
    lineOptions: data.lineOptions,
    tooltipOptions: data.tooltipOptions,
    isNavigable: data.isNavigable,
    valuesOverPoints: data.valuesOverPoints,
  });
  return `<div class="ix-component ix-component--chart">${title}<div class="ix-chart" id="${id}" data-chart='${escapeHtml(config)}'></div></div>`;
};

const RENDERERS = {
  "status-grid": renderStatusGrid,
  "stat-bars": renderStatBars,
  "data-table": renderDataTable,
  "key-value": renderKeyValue,
  chart: renderChart,
};

/**
 * Dispatch to the appropriate renderer by component type.
 * Returns HTML string or null if unknown component.
 * @param {object} data - Parsed nyx-ui JSON
 * @returns {string|null}
 */
export const renderInteractiveComponent = (data) => {
  const renderer = RENDERERS[data?.component];
  return renderer?.(data) ?? null;
};
