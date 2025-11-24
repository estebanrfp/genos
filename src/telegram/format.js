let escapeHtml = function (text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },
  escapeHtmlAttr = function (text) {
    return escapeHtml(text).replace(/"/g, "&quot;");
  },
  isAutoLinkedFileRef = function (href, label) {
    const stripped = href.replace(/^https?:\/\//i, "");
    if (stripped !== label) {
      return false;
    }
    const dotIndex = label.lastIndexOf(".");
    if (dotIndex < 1) {
      return false;
    }
    const ext = label.slice(dotIndex + 1).toLowerCase();
    if (!FILE_EXTENSIONS_WITH_TLD.has(ext)) {
      return false;
    }
    const segments = label.split("/");
    if (segments.length > 1) {
      for (let i = 0; i < segments.length - 1; i++) {
        if (segments[i].includes(".")) {
          return false;
        }
      }
    }
    return true;
  },
  buildTelegramLink = function (link, text) {
    const href = link.href.trim();
    if (!href) {
      return null;
    }
    if (link.start === link.end) {
      return null;
    }
    const label = text.slice(link.start, link.end);
    if (isAutoLinkedFileRef(href, label)) {
      return null;
    }
    const safeHref = escapeHtmlAttr(href);
    return {
      start: link.start,
      end: link.end,
      open: `<a href="${safeHref}">`,
      close: "</a>",
    };
  },
  renderTelegramHtml = function (ir) {
    return renderMarkdownWithMarkers(ir, {
      styleMarkers: {
        bold: { open: "<b>", close: "</b>" },
        italic: { open: "<i>", close: "</i>" },
        strikethrough: { open: "<s>", close: "</s>" },
        code: { open: "<code>", close: "</code>" },
        code_block: { open: "<pre><code>", close: "</code></pre>" },
        spoiler: { open: "<tg-spoiler>", close: "</tg-spoiler>" },
        blockquote: { open: "<blockquote>", close: "</blockquote>" },
      },
      escapeText: escapeHtml,
      buildLink: buildTelegramLink,
    });
  },
  escapeRegex = function (str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },
  wrapStandaloneFileRef = function (match, prefix, filename) {
    if (filename.startsWith("//")) {
      return match;
    }
    if (/https?:\/\/$/i.test(prefix)) {
      return match;
    }
    return `${prefix}<code>${escapeHtml(filename)}</code>`;
  },
  wrapSegmentFileRefs = function (text, codeDepth, preDepth, anchorDepth) {
    if (!text || codeDepth > 0 || preDepth > 0 || anchorDepth > 0) {
      return text;
    }
    const wrappedStandalone = text.replace(FILE_REFERENCE_PATTERN, wrapStandaloneFileRef);
    return wrappedStandalone.replace(ORPHANED_TLD_PATTERN, (match, prefix, tld) =>
      prefix === ">" ? match : `${prefix}<code>${escapeHtml(tld)}</code>`,
    );
  };
import { chunkMarkdownIR, markdownToIR } from "../markdown/ir.js";
import { renderMarkdownWithMarkers } from "../markdown/render.js";
const FILE_EXTENSIONS_WITH_TLD = new Set(["md", "go", "py", "pl", "sh", "am", "at", "be", "cc"]);
export function markdownToTelegramHtml(markdown, options = {}) {
  const ir = markdownToIR(markdown ?? "", {
    linkify: true,
    enableSpoilers: true,
    headingStyle: "none",
    blockquotePrefix: "",
    tableMode: options.tableMode,
  });
  const html = renderTelegramHtml(ir);
  if (options.wrapFileRefs !== false) {
    return wrapFileReferencesInHtml(html);
  }
  return html;
}
const FILE_EXTENSIONS_PATTERN = Array.from(FILE_EXTENSIONS_WITH_TLD).map(escapeRegex).join("|");
const AUTO_LINKED_ANCHOR_PATTERN = /<a\s+href="https?:\/\/([^"]+)"[^>]*>\1<\/a>/gi;
const FILE_REFERENCE_PATTERN = new RegExp(
  `(^|[^a-zA-Z0-9_\\-/])([a-zA-Z0-9_.\\-./]+\\.(?:${FILE_EXTENSIONS_PATTERN}))(?=$|[^a-zA-Z0-9_\\-/])`,
  "gi",
);
const ORPHANED_TLD_PATTERN = new RegExp(
  `([^a-zA-Z0-9]|^)([A-Za-z]\\.(?:${FILE_EXTENSIONS_PATTERN}))(?=[^a-zA-Z0-9/]|$)`,
  "g",
);
const HTML_TAG_PATTERN = /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/gi;
export function wrapFileReferencesInHtml(html) {
  AUTO_LINKED_ANCHOR_PATTERN.lastIndex = 0;
  const deLinkified = html.replace(AUTO_LINKED_ANCHOR_PATTERN, (_match, label) => {
    if (!isAutoLinkedFileRef(`http://${label}`, label)) {
      return _match;
    }
    return `<code>${escapeHtml(label)}</code>`;
  });
  let codeDepth = 0;
  let preDepth = 0;
  let anchorDepth = 0;
  let result = "";
  let lastIndex = 0;
  HTML_TAG_PATTERN.lastIndex = 0;
  let match;
  while ((match = HTML_TAG_PATTERN.exec(deLinkified)) !== null) {
    const tagStart = match.index;
    const tagEnd = HTML_TAG_PATTERN.lastIndex;
    const isClosing = match[1] === "</";
    const tagName = match[2].toLowerCase();
    const textBefore = deLinkified.slice(lastIndex, tagStart);
    result += wrapSegmentFileRefs(textBefore, codeDepth, preDepth, anchorDepth);
    if (tagName === "code") {
      codeDepth = isClosing ? Math.max(0, codeDepth - 1) : codeDepth + 1;
    } else if (tagName === "pre") {
      preDepth = isClosing ? Math.max(0, preDepth - 1) : preDepth + 1;
    } else if (tagName === "a") {
      anchorDepth = isClosing ? Math.max(0, anchorDepth - 1) : anchorDepth + 1;
    }
    result += deLinkified.slice(tagStart, tagEnd);
    lastIndex = tagEnd;
  }
  const remainingText = deLinkified.slice(lastIndex);
  result += wrapSegmentFileRefs(remainingText, codeDepth, preDepth, anchorDepth);
  return result;
}
export function renderTelegramHtmlText(text, options = {}) {
  const textMode = options.textMode ?? "markdown";
  if (textMode === "html") {
    return text;
  }
  return markdownToTelegramHtml(text, { tableMode: options.tableMode });
}
export function markdownToTelegramChunks(markdown, limit, options = {}) {
  const ir = markdownToIR(markdown ?? "", {
    linkify: true,
    enableSpoilers: true,
    headingStyle: "none",
    blockquotePrefix: "",
    tableMode: options.tableMode,
  });
  const chunks = chunkMarkdownIR(ir, limit);
  return chunks.map((chunk) => ({
    html: wrapFileReferencesInHtml(renderTelegramHtml(chunk)),
    text: chunk.text,
  }));
}
export function markdownToTelegramHtmlChunks(markdown, limit) {
  return markdownToTelegramChunks(markdown, limit).map((chunk) => chunk.html);
}
