import { describe, expect, it } from "vitest";
import { markdownToIR } from "./ir.js";
describe("markdownToIR tableMode code - style overlap", () => {
  it("should not have overlapping styles when cell has bold text", () => {
    const md = `
| Name | Value |
|------|-------|
| **Bold** | Normal |
`.trim();
    const ir = markdownToIR(md, { tableMode: "code" });
    const codeBlockSpan = ir.styles.find((s) => s.style === "code_block");
    const boldSpan = ir.styles.find((s) => s.style === "bold");
    if (codeBlockSpan && boldSpan) {
      const overlaps = boldSpan.start < codeBlockSpan.end && boldSpan.end > codeBlockSpan.start;
      expect(overlaps).toBe(false);
    }
  });
  it("should not have overlapping styles when cell has italic text", () => {
    const md = `
| Name | Value |
|------|-------|
| *Italic* | Normal |
`.trim();
    const ir = markdownToIR(md, { tableMode: "code" });
    const codeBlockSpan = ir.styles.find((s) => s.style === "code_block");
    const italicSpan = ir.styles.find((s) => s.style === "italic");
    if (codeBlockSpan && italicSpan) {
      const overlaps = italicSpan.start < codeBlockSpan.end && italicSpan.end > codeBlockSpan.start;
      expect(overlaps).toBe(false);
    }
  });
  it("should not have overlapping styles when cell has inline code", () => {
    const md = `
| Name | Value |
|------|-------|
| \`code\` | Normal |
`.trim();
    const ir = markdownToIR(md, { tableMode: "code" });
    const codeBlockSpan = ir.styles.find((s) => s.style === "code_block");
    const codeSpan = ir.styles.find((s) => s.style === "code");
    if (codeBlockSpan && codeSpan) {
      const overlaps = codeSpan.start < codeBlockSpan.end && codeSpan.end > codeBlockSpan.start;
      expect(overlaps).toBe(false);
    }
  });
  it("should not have overlapping styles with multiple styled cells", () => {
    const md = `
| Name | Value |
|------|-------|
| **A** | *B* |
| _C_ | ~~D~~ |
`.trim();
    const ir = markdownToIR(md, { tableMode: "code" });
    const codeBlockSpan = ir.styles.find((s) => s.style === "code_block");
    if (!codeBlockSpan) {
      return;
    }
    for (const style of ir.styles) {
      if (style.style === "code_block") {
        continue;
      }
      const overlaps = style.start < codeBlockSpan.end && style.end > codeBlockSpan.start;
      expect(overlaps).toBe(false);
    }
  });
});
