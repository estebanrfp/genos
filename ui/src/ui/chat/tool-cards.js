let normalizeContent = function (content) {
    if (!Array.isArray(content)) {
      return [];
    }
    return content.filter(Boolean);
  },
  coerceArgs = function (value) {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return value;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  },
  extractToolText = function (item) {
    if (typeof item.text === "string") {
      return item.text;
    }
    if (typeof item.content === "string") {
      return item.content;
    }
    return;
  };
import { html, nothing } from "lit";
import { icons } from "../icons.js";
import { formatToolDetail, resolveToolDisplay } from "../tool-display.js";
import { extractTextCached } from "./message-extract.js";
import { isToolResultMessage } from "./message-normalizer.js";
import { formatToolOutputForSidebar } from "./tool-helpers.js";
export function extractToolCards(message) {
  const m = message;
  const content = normalizeContent(m.content);
  const cards = [];
  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    const isToolCall =
      ["toolcall", "tool_call", "tooluse", "tool_use"].includes(kind) ||
      (typeof item.name === "string" && item.arguments != null);
    if (isToolCall) {
      cards.push({
        kind: "call",
        name: item.name ?? "tool",
        args: coerceArgs(item.arguments ?? item.args),
      });
    }
  }
  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    if (kind !== "toolresult" && kind !== "tool_result") {
      continue;
    }
    const text = extractToolText(item);
    const name = typeof item.name === "string" ? item.name : "tool";
    cards.push({ kind: "result", name, text });
  }
  if (isToolResultMessage(message) && !cards.some((card) => card.kind === "result")) {
    const name =
      (typeof m.toolName === "string" && m.toolName) ||
      (typeof m.tool_name === "string" && m.tool_name) ||
      "tool";
    const text = extractTextCached(message) ?? undefined;
    cards.push({ kind: "result", name, text });
  }
  return cards;
}
/**
 * Extract a meaningful target value from tool args, skipping generic scope identifiers.
 * @param {object} args
 * @returns {string|undefined}
 */
function resolveTarget(args) {
  if (!args || typeof args !== "object") {
    return;
  }
  // Prioritize specific targets over generic scopes
  for (const key of ["value", "query", "label"]) {
    const val = args[key];
    if (typeof val === "string" && val.trim() && val.length < 80) {
      return val.trim();
    }
  }
  // Include path only if it looks like a config path (dots) or file path (slashes)
  const path = args.path;
  if (typeof path === "string" && path.trim() && (path.includes(".") || path.includes("/"))) {
    return path
      .trim()
      .replace(/^\/Users\/[^/]+\//, "~/")
      .replace(/^\/home\/[^/]+\//, "~/");
  }
  return;
}

/**
 * Extract a one-line hint from the tool result text (JSON or plain text).
 * @param {string} text
 * @returns {string|undefined}
 */
function extractResultHint(text) {
  if (!text) {
    return;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(trimmed);
      if (Array.isArray(obj)) {
        return `${obj.length} items`;
      }
      if (typeof obj === "object" && obj !== null) {
        for (const key of ["written", "file", "deleted", "renamed"]) {
          const val = obj[key];
          if (typeof val === "string" && val.length > 0) {
            return val.includes("/") ? val.split("/").pop() : val;
          }
        }
        for (const key of ["label", "name", "message", "description"]) {
          const val = obj[key];
          if (typeof val === "string" && val.length > 0 && val.length < 60) {
            return val;
          }
        }
      }
    } catch {}
  }
  const firstLine = trimmed
    .split("\n")
    .find((l) => l.trim())
    ?.trim();
  if (!firstLine) {
    return;
  }
  return firstLine.length > 50 ? firstLine.slice(0, 47) + "\u2026" : firstLine;
}

/**
 * Build a rich description from verb, sub-action, args, and result text.
 * @param {object} display
 * @param {string|undefined} detail
 * @param {object} card
 * @returns {string|undefined}
 */
function buildDescription(display, detail, card) {
  const toolNameNorm = display.name.toLowerCase().replace(/_/g, " ");
  const verbIsAction = display.verb && display.verb !== toolNameNorm;
  const args = card.args;
  const sub = args?.subAction;

  if (verbIsAction) {
    const target = resolveTarget(args);
    if (sub) {
      // Compound: "files set AGENTS.md"
      return [display.verb, sub, target].filter(Boolean).join(" ");
    }
    // Simple action: "set agents.defaults.model"
    return [display.verb, detail || target].filter(Boolean).join(" ");
  }

  // No verb action — try detail, then result hint
  return detail || extractResultHint(card.text);
}

export function renderToolCardSidebar(card, onOpenSidebar, toolState) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const description = buildDescription(display, detail, card);
  const index = toolState ? ++toolState.index : undefined;
  const hasText = Boolean(card.text?.trim());
  const canClick = Boolean(onOpenSidebar);
  const handleClick = canClick
    ? () => {
        if (hasText) {
          onOpenSidebar(formatToolOutputForSidebar(card.text));
          return;
        }
        const info = `## ${display.label}\n\n${description ? `**Command:** \`${description}\`\n\n` : ""}*No output \u2014 tool completed successfully.*`;
        onOpenSidebar(info);
      }
    : undefined;
  return html`
    <div
      class="chat-tool-line ${canClick ? "chat-tool-line--clickable" : ""}"
      @click=${handleClick}
      role=${canClick ? "button" : nothing}
      tabindex=${canClick ? "0" : nothing}
      @keydown=${
        canClick
          ? (e) => {
              if (e.key !== "Enter" && e.key !== " ") {
                return;
              }
              e.preventDefault();
              handleClick?.();
            }
          : nothing
      }
    >
      <span class="chat-tool-line__icon">${icons[display.icon]}</span>
      <span class="chat-tool-line__label">${display.label}${index ? html`<span class="chat-tool-line__index">#${index}</span>` : nothing}</span>
      ${description ? html`<span class="chat-tool-line__detail">\u00b7 ${description}</span>` : nothing}
      ${card.kind !== "call" ? html`<span class="chat-tool-line__check">${icons.check}</span>` : nothing}
    </div>
  `;
}
