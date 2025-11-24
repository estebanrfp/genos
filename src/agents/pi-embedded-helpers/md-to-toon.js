/**
 * Convert markdown bootstrap content to pure TOON encoding.
 * Total minification: if a character is format and not content, it goes.
 * Code block fences stripped, inner content preserved as-is.
 * @param {string} md - Compressed markdown content
 * @returns {string}
 */
export function convertBootstrapToToon(md) {
  try {
    if (!md || typeof md !== "string") {
      return "";
    }

    // 1. Extract fenced code blocks → placeholders (strip fences, keep inner content)
    const codeBlocks = [];
    let processed = md.replace(/```\w*\n?([\s\S]*?)```/g, (_, inner) => {
      const idx = codeBlocks.length;
      codeBlocks.push(inner.trimEnd());
      return `\x00CB${idx}\x00`;
    });

    // 2. Walk lines with block detection
    const lines = processed.split("\n");
    const output = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code block placeholder → pass through
      if (line.includes("\x00CB")) {
        output.push(line);
        i++;
        continue;
      }

      // Header: ## Title → compact "Title:"
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        const raw = stripInline(headerMatch[2]);
        const title = raw
          .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "")
          .replace(/\s+/g, " ")
          .trim();
        if (title) {
          const dashSplit = title.match(/^\S+\.md\s*[-—]\s*(.+)$/);
          output.push(`${dashSplit ? dashSplit[1].trim() : title}:`);
        }
        i++;
        continue;
      }

      // Key-value bullet: "- **Key:** Value"
      if (/^- \*\*[^*]+:\*\*\s/.test(line)) {
        const { items, consumed } = collectWhile(lines, i, (l) => /^- \*\*[^*]+:\*\*\s/.test(l));
        for (const l of items) {
          const m = l.match(/^- \*\*([^*]+):\*\*\s+(.+)$/);
          if (m) {
            output.push(`${m[1]}: ${stripInline(m[2])}`);
          } else {
            output.push(stripInline(l));
          }
        }
        i += consumed;
        continue;
      }

      // Bold-key paragraph: "**Key.** Desc" or "**Key:** Desc"
      if (/^\*\*[^*]+[.:]\*\*\s/.test(line)) {
        const { items, consumed } = collectWhile(lines, i, (l) => /^\*\*[^*]+[.:]\*\*\s/.test(l));
        for (const l of items) {
          const m = l.match(/^\*\*([^*]+)[.:]\*\*\s+(.+)$/);
          if (m) {
            output.push(`${m[1]}: ${stripInline(m[2])}`);
          } else {
            output.push(stripInline(l));
          }
        }
        i += consumed;
        continue;
      }

      // Bullet (any indent level): "- Item" or "  - Sub"
      if (/^\s*- /.test(line)) {
        const { items, consumed } = collectWhile(lines, i, (l) => /^\s*- /.test(l));
        for (const l of items) {
          const bm = l.match(/^(\s*)- (.+)$/);
          if (bm) {
            output.push(`${bm[1]}· ${stripInline(bm[2])}`);
          } else {
            output.push(stripInline(l));
          }
        }
        i += consumed;
        continue;
      }

      // Horizontal rules
      if (/^---+\s*$/.test(line)) {
        i++;
        continue;
      }

      // Everything else: strip inline markdown
      output.push(stripInline(line));
      i++;
    }

    // 3. Collapse excessive blank lines
    let result = output.join("\n").replace(/\n{3,}/g, "\n\n");

    // 4. Restore code block content (fences already stripped)
    for (let idx = 0; idx < codeBlocks.length; idx++) {
      result = result.replace(`\x00CB${idx}\x00`, codeBlocks[idx]);
    }

    return result.trimEnd();
  } catch {
    // Any error → return raw markdown unchanged
    return md;
  }
}

/**
 * Strip inline markdown formatting from a line.
 * Bold, italic, inline code, links → plain text.
 * @param {string} line
 * @returns {string}
 */
function stripInline(line) {
  return line
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/\*([^*]+)\*/g, "$1") // *italic* → italic
    .replace(/`([^`]+)`/g, "$1") // `code` → code
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"); // [text](url) → text (url)
}

/**
 * Collect consecutive lines from index that match a predicate, skipping blank lines between them.
 * @param {string[]} lines
 * @param {number} start
 * @param {function(string): boolean} predicate
 * @returns {{ items: string[], consumed: number }}
 */
function collectWhile(lines, start, predicate) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (predicate(line)) {
      items.push(line);
      i++;
    } else if (line.trim() === "" && i + 1 < lines.length && predicate(lines[i + 1])) {
      // skip blank line between matching lines
      i++;
    } else {
      break;
    }
  }
  return { items, consumed: i - start };
}
