import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { icons } from "../icons.js";
import { toSanitizedMarkdownHtml } from "../markdown.js";

/** Naive HTML pretty-print: insert newlines before opening/closing block tags. */
const prettyHtml = (raw) =>
  raw
    .replace(/></g, ">\n<")
    .replace(/\{([^}]{60,})\}/g, (m) => m.replace(/;/g, ";\n  "))
    .trim();

/** Detect raw HTML content and wrap it in a fenced code block. */
const preprocessContent = (content) => {
  const trimmed = content.trim();
  if (!trimmed) {
    return content;
  }
  if (trimmed.startsWith("```") || trimmed.startsWith("# ")) {
    return content;
  }
  const looksLikeHtml =
    /^<(!doctype|html|head|meta|div|span|body|style|script|link|p|table|form|section|header|footer|nav|article)\b/i.test(
      trimmed,
    );
  if (!looksLikeHtml) {
    return content;
  }
  return "```html\n" + prettyHtml(trimmed) + "\n```";
};

export function renderMarkdownSidebar(props) {
  return html`
    <div class="sidebar-panel">
      <div class="sidebar-header">
        <div class="sidebar-title">Output</div>
        <button @click=${props.onClose} class="btn btn--sm btn--icon" title="Close sidebar">
          ${icons.x}
        </button>
      </div>
      <div class="sidebar-content">
        ${
          props.error
            ? html`
              <div class="callout danger">${props.error}</div>
              <button @click=${props.onViewRawText} class="btn" style="margin-top: 12px;">
                View Raw Text
              </button>
            `
            : props.content
              ? html`<div class="sidebar-markdown">${unsafeHTML(toSanitizedMarkdownHtml(preprocessContent(props.content)))}</div>`
              : html`
                  <div class="muted">No content available</div>
                `
        }
      </div>
    </div>
  `;
}
