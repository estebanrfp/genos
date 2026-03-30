import { PREVIEW_MAX_CHARS, PREVIEW_MAX_LINES } from "./constants.js";
/**
 * Format tool output for the sidebar panel with syntax highlighting.
 * @param {string} text - Raw tool output
 * @returns {string} Markdown-formatted output
 */
export function formatToolOutputForSidebar(text) {
  const trimmed = text.trim();
  // JSON: pretty-print with syntax highlighting
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    } catch {}
  }
  // Multi-line plain text: wrap in code block for monospace rendering
  if (trimmed.includes("\n")) {
    return "```\n" + trimmed + "\n```";
  }
  return trimmed;
}
export function getTruncatedPreview(text) {
  const allLines = text.split("\n");
  const lines = allLines.slice(0, PREVIEW_MAX_LINES);
  const preview = lines.join("\n");
  if (preview.length > PREVIEW_MAX_CHARS) {
    return preview.slice(0, PREVIEW_MAX_CHARS) + "\u2026";
  }
  return lines.length < allLines.length ? preview + "\u2026" : preview;
}
