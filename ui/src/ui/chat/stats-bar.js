import { html, nothing } from "lit";

/**
 * Format token count to human-readable (e.g., 12400 → "12.4K").
 * @param {number|undefined} n
 * @returns {string}
 */
const formatTokens = (n) => {
  if (!n || n <= 0) {
    return "0";
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
};

/**
 * Calculate cache hit percentage from usage data.
 * @param {object} usage
 * @returns {number|undefined}
 */
const calcCacheHitPct = (usage) => {
  const { input, cacheRead } = usage;
  if (!input && !cacheRead) {
    return undefined;
  }
  const total = (input ?? 0) + (cacheRead ?? 0);
  if (total === 0) {
    return undefined;
  }
  return Math.round(((cacheRead ?? 0) / total) * 100);
};

const EXEC_TOOLS = new Set(["bash", "exec", "shell", "run_command", "computer"]);
const MEMORY_TOOLS = new Set(["memory_search", "memory_write"]);
const SEARCH_TOOLS = new Set(["web_search", "search", "tavily_search"]);

/**
 * Resolve source indicator from stats.source metadata.
 * @param {object|undefined} source
 * @returns {{ color: string, label: string, title: string }|null}
 */
const resolveSourceIndicator = (source) => {
  if (!source) {
    return null;
  }
  const tools = source.toolNames ?? [];
  const hasExec = tools.some((t) => EXEC_TOOLS.has(t));
  const hasMemoryTool = tools.some((t) => MEMORY_TOOLS.has(t));
  const hasSearchTool = tools.some((t) => SEARCH_TOOLS.has(t));
  const hasPrefetch = (source.prefetchChunks ?? 0) > 0;
  const hasAnyTool = tools.length > 0;

  if (hasExec) {
    return {
      color: "var(--source-exec)",
      label: "exec",
      title: `Executed: ${tools.filter((t) => EXEC_TOOLS.has(t)).join(", ")}`,
    };
  }
  if (hasMemoryTool || hasSearchTool) {
    const names = tools.filter((t) => MEMORY_TOOLS.has(t) || SEARCH_TOOLS.has(t)).join(", ");
    return { color: "var(--source-tool)", label: "tool", title: `Tool calls: ${names}` };
  }
  if (hasPrefetch) {
    return {
      color: "var(--source-prefetch)",
      label: "memory",
      title: `Memory prefetch: ${source.prefetchChunks} chunks`,
    };
  }
  if (hasAnyTool) {
    return { color: "var(--source-tool)", label: "tool", title: `Tools: ${tools.join(", ")}` };
  }
  return null;
};

/**
 * Derive short model name from full model ID.
 * @param {string|null|undefined} id
 * @returns {string|null}
 */
const shortModelName = (id) => {
  if (!id) {
    return null;
  }
  if (id.includes("opus")) {
    return "opus";
  }
  if (id.includes("sonnet")) {
    return "sonnet";
  }
  if (id.includes("haiku")) {
    return "haiku";
  }
  if (id.includes("gpt-4")) {
    return "gpt-4";
  }
  if (id.includes("gpt-5")) {
    return "gpt-5";
  }
  if (id.includes("gemini")) {
    return "gemini";
  }
  if (id.includes("deepseek")) {
    return "deepseek";
  }
  return id.split("/").pop().split("-").slice(0, 2).join("-");
};

/**
 * Render a stats bar below an assistant message bubble.
 * @param {object|undefined} stats - Usage/stats object from the gateway
 * @param {string|null} [model] - Active model ID for display
 * @returns {import("lit").TemplateResult}
 */
export function renderStatsBar(stats, model) {
  if (!stats) {
    return nothing;
  }

  const { input, output, cacheRead, durationMs, compactionCount, source } = stats;
  const hasTokens = (input ?? 0) > 0 || (output ?? 0) > 0;
  if (!hasTokens) {
    return nothing;
  }

  const cacheHit = calcCacheHitPct(stats);
  const totalTokens = (input ?? 0) + (output ?? 0) + (cacheRead ?? 0);
  const sourceIndicator = resolveSourceIndicator(source);

  return html`
    <div class="stats-bar" aria-label="Response metrics">
      ${
        sourceIndicator
          ? html`
        <span class="stats-bar__source" title="${sourceIndicator.title}">
          <span class="stats-bar__dot" style="background:${sourceIndicator.color}"></span>
          <span class="stats-bar__label">${sourceIndicator.label}</span>
        </span>
        <span class="stats-bar__sep"></span>
      `
          : nothing
      }
      ${
        shortModelName(model)
          ? html`
        <span class="stats-bar__item" title="Model used for this response">
          <span class="stats-bar__value">${shortModelName(model)}</span>
        </span>
        <span class="stats-bar__sep"></span>
      `
          : nothing
      }
      <span class="stats-bar__item" title="Total tokens (input + output + cache read)">
        <span class="stats-bar__label">tokens</span>
        <span class="stats-bar__value">${formatTokens(totalTokens)}</span>
      </span>
      <span class="stats-bar__sep"></span>
      <span class="stats-bar__item" title="Input tokens / Output tokens">
        <span class="stats-bar__label">in/out</span>
        <span class="stats-bar__value">${formatTokens(input)}/${formatTokens(output)}</span>
      </span>
      ${
        cacheHit !== undefined
          ? html`
        <span class="stats-bar__sep"></span>
        <span class="stats-bar__item" title="Prompt cache hit rate">
          <span class="stats-bar__label">cache</span>
          <span class="stats-bar__value">${cacheHit}%</span>
        </span>
      `
          : nothing
      }
      ${
        durationMs
          ? html`
        <span class="stats-bar__sep"></span>
        <span class="stats-bar__item" title="Total response time">
          <span class="stats-bar__label">time</span>
          <span class="stats-bar__value">${durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`}</span>
        </span>
      `
          : nothing
      }
      ${
        compactionCount
          ? html`
        <span class="stats-bar__sep"></span>
        <span class="stats-bar__item" title="Context compactions during this run">
          <span class="stats-bar__label">compactions</span>
          <span class="stats-bar__value">${compactionCount}</span>
        </span>
      `
          : nothing
      }
    </div>
  `;
}
