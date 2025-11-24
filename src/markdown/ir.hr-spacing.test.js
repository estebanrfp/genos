import { describe, it, expect } from "vitest";
import { markdownToIR } from "./ir.js";
describe("hr (thematic break) spacing", () => {
  describe("current behavior documentation", () => {
    it("just hr alone renders as separator", () => {
      const result = markdownToIR("---");
      expect(result.text).toBe("\u2500\u2500\u2500");
    });
    it("hr interrupting paragraph (setext heading case)", () => {
      const input = `Para 1
***
Para 2`;
      const result = markdownToIR(input);
      expect(result.text).toContain("\u2500\u2500\u2500");
    });
  });
  describe("expected behavior (tests assert CORRECT behavior)", () => {
    it("hr between paragraphs should render with separator", () => {
      const input = `Para 1

---

Para 2`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`Para 1

\u2500\u2500\u2500

Para 2`);
    });
    it("hr between paragraphs using *** should render with separator", () => {
      const input = `Para 1

***

Para 2`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`Para 1

\u2500\u2500\u2500

Para 2`);
    });
    it("hr between paragraphs using ___ should render with separator", () => {
      const input = `Para 1

___

Para 2`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`Para 1

\u2500\u2500\u2500

Para 2`);
    });
    it("consecutive hrs should produce multiple separators", () => {
      const input = `---
---
---`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`\u2500\u2500\u2500

\u2500\u2500\u2500

\u2500\u2500\u2500`);
    });
    it("hr at document end renders separator", () => {
      const input = `Para

---`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`Para

\u2500\u2500\u2500`);
    });
    it("hr at document start renders separator", () => {
      const input = `---

Para`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`\u2500\u2500\u2500

Para`);
    });
    it("should not produce triple newlines regardless of hr placement", () => {
      const inputs = [
        "Para 1\n\n---\n\nPara 2",
        "Para 1\n---\nPara 2",
        "---\nPara",
        "Para\n---",
        "Para 1\n\n---\n\n---\n\nPara 2",
        "Para 1\n\n***\n\n---\n\n___\n\nPara 2",
      ];
      for (const input of inputs) {
        const result = markdownToIR(input);
        expect(result.text, `Input: ${JSON.stringify(input)}`).not.toMatch(/\n{3,}/);
      }
    });
    it("multiple consecutive hrs between paragraphs should each render as separator", () => {
      const input = `Para 1

---

---

---

Para 2`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`Para 1

\u2500\u2500\u2500

\u2500\u2500\u2500

\u2500\u2500\u2500

Para 2`);
    });
  });
  describe("edge cases", () => {
    it("hr between list items renders as separator without extra spacing", () => {
      const input = `- Item 1
- ---
- Item 2`;
      const result = markdownToIR(input);
      expect(result.text).toBe(`\u2022 Item 1

\u2500\u2500\u2500

\u2022 Item 2`);
      expect(result.text).not.toMatch(/\n{3,}/);
    });
    it("hr followed immediately by heading", () => {
      const input = `---

# Heading

Para`;
      const result = markdownToIR(input);
      expect(result.text).not.toMatch(/\n{3,}/);
      expect(result.text).toContain("\u2500\u2500\u2500");
    });
    it("heading followed by hr", () => {
      const input = `# Heading

---

Para`;
      const result = markdownToIR(input);
      expect(result.text).not.toMatch(/\n{3,}/);
      expect(result.text).toContain("\u2500\u2500\u2500");
    });
  });
});
