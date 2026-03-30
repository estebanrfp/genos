import { stripAnsi } from "../../src/terminal/ansi.js";
export function normalizeTestText(input) {
  return stripAnsi(input)
    .replaceAll("\r\n", "\n")
    .replaceAll("\u2026", "...")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "?")
    .replace(/[\uD800-\uDFFF]/g, "?");
}
