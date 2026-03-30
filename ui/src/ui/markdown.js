let getCachedMarkdown = function (key) {
    const cached = markdownCache.get(key);
    if (cached === undefined) {
      return null;
    }
    markdownCache.delete(key);
    markdownCache.set(key, cached);
    return cached;
  },
  setCachedMarkdown = function (key, value) {
    markdownCache.set(key, value);
    if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
      return;
    }
    const oldest = markdownCache.keys().next().value;
    if (oldest) {
      markdownCache.delete(oldest);
    }
  },
  installHooks = function () {
    if (hooksInstalled) {
      return;
    }
    hooksInstalled = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (!(node instanceof HTMLAnchorElement)) {
        return;
      }
      const href = node.getAttribute("href");
      if (!href) {
        return;
      }
      node.setAttribute("rel", "noreferrer noopener");
      node.setAttribute("target", "_blank");
    });
  },
  escapeHtml = function (value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";
import { truncateText } from "./format.js";
import { renderInteractiveComponent } from "./interactive/renderers.js";
marked.setOptions({
  gfm: true,
  breaks: true,
});
const allowedTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "button",
  "code",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "img",
];
const allowedAttrs = [
  "class",
  "id",
  "href",
  "rel",
  "target",
  "title",
  "start",
  "src",
  "alt",
  "data-action",
  "data-value",
  "data-rpc",
  "data-chart",
  "disabled",
];
const sanitizeOptions = {
  ALLOWED_TAGS: allowedTags,
  ALLOWED_ATTR: allowedAttrs,
  ADD_DATA_URI_TAGS: ["img"],
};
let hooksInstalled = false;
const MARKDOWN_CHAR_LIMIT = 140000;
const MARKDOWN_PARSE_LIMIT = 40000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50000;
const markdownCache = new Map();
export function toSanitizedMarkdownHtml(markdown) {
  let input = markdown.trim();
  if (!input) {
    return "";
  }
  // Hide incomplete nyx-ui blocks during streaming (no closing ```)
  const nyxUiOpen = input.lastIndexOf("```nyx-ui");
  if (nyxUiOpen !== -1 && input.indexOf("```", nyxUiOpen + 9) === -1) {
    input = input.slice(0, nyxUiOpen).trimEnd();
    if (!input) {
      return "";
    }
  }
  installHooks();
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(input);
    if (cached !== null) {
      return cached;
    }
  }
  const truncated = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const suffix = truncated.truncated
    ? `

\u2026 truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
    : "";
  if (truncated.text.length > MARKDOWN_PARSE_LIMIT) {
    const escaped = escapeHtml(`${truncated.text}${suffix}`);
    const html = `<pre class="code-block">${escaped}</pre>`;
    const sanitized = DOMPurify.sanitize(html, sanitizeOptions);
    if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
      setCachedMarkdown(input, sanitized);
    }
    return sanitized;
  }
  const rendered = marked.parse(`${truncated.text}${suffix}`, {
    renderer: htmlEscapeRenderer,
  });
  const sanitized = DOMPurify.sanitize(rendered, sanitizeOptions);
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(input, sanitized);
  }
  return sanitized;
}
const htmlEscapeRenderer = new marked.Renderer();
htmlEscapeRenderer.html = ({ text }) => escapeHtml(text);

/**
 * Highlight code with language auto-detection.
 * @param {{ text: string, lang?: string }} opts
 * @returns {string}
 */
htmlEscapeRenderer.code = ({ text, lang }) => {
  const code = text ?? "";
  const language = lang?.trim().toLowerCase() ?? "";
  if (language === "nyx-ui") {
    try {
      const data = JSON.parse(code);
      const rendered = renderInteractiveComponent(data);
      if (rendered) {
        return rendered;
      }
    } catch {
      /* fall through to normal code block */
    }
  }
  try {
    const result =
      language && hljs.getLanguage(language)
        ? hljs.highlight(code, { language })
        : hljs.highlightAuto(code);
    const langClass = result.language ? ` language-${result.language}` : "";
    const langLabel = result.language
      ? `<span class="code-lang-label">${result.language}</span>`
      : "";
    return `<pre>${langLabel}<code class="hljs${langClass}">${result.value}</code></pre>`;
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
};
