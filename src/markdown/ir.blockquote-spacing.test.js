import { describe, it, expect } from "vitest";
import { markdownToIR } from "./ir.js";
describe("blockquote spacing", () => {
  describe("blockquote followed by paragraph", () => {
    it("should have double newline (one blank line) between blockquote and paragraph", () => {
      const input = "> quote\n\nparagraph";
      const result = markdownToIR(input);
      expect(result.text).toBe("quote\n\nparagraph");
    });
    it("should not produce triple newlines", () => {
      const input = "> quote\n\nparagraph";
      const result = markdownToIR(input);
      expect(result.text).not.toContain("\n\n\n");
    });
  });
  describe("consecutive blockquotes", () => {
    it("should have double newline between two blockquotes", () => {
      const input = "> first\n\n> second";
      const result = markdownToIR(input);
      expect(result.text).toBe("first\n\nsecond");
    });
    it("should not produce triple newlines between blockquotes", () => {
      const input = "> first\n\n> second";
      const result = markdownToIR(input);
      expect(result.text).not.toContain("\n\n\n");
    });
  });
  describe("nested blockquotes", () => {
    it("should handle nested blockquotes correctly", () => {
      const input = "> outer\n>> inner";
      const result = markdownToIR(input);
      expect(result.text).toBe("outer\n\ninner");
    });
    it("should not produce triple newlines in nested blockquotes", () => {
      const input = "> outer\n>> inner\n\nparagraph";
      const result = markdownToIR(input);
      expect(result.text).not.toContain("\n\n\n");
    });
    it("should handle deeply nested blockquotes", () => {
      const input = "> level 1\n>> level 2\n>>> level 3";
      const result = markdownToIR(input);
      expect(result.text).not.toContain("\n\n\n");
    });
  });
  describe("blockquote followed by other block elements", () => {
    it("should have double newline between blockquote and heading", () => {
      const input = "> quote\n\n# Heading";
      const result = markdownToIR(input);
      expect(result.text).toBe("quote\n\nHeading");
      expect(result.text).not.toContain("\n\n\n");
    });
    it("should have double newline between blockquote and list", () => {
      const input = "> quote\n\n- item";
      const result = markdownToIR(input);
      expect(result.text).toBe(`quote

\u2022 item`);
      expect(result.text).not.toContain("\n\n\n");
    });
    it("should have double newline between blockquote and code block", () => {
      const input = "> quote\n\n```\ncode\n```";
      const result = markdownToIR(input);
      expect(result.text.startsWith("quote\n\ncode")).toBe(true);
      expect(result.text).not.toContain("\n\n\n");
    });
    it("should have double newline between blockquote and horizontal rule", () => {
      const input = "> quote\n\n---\n\nparagraph";
      const result = markdownToIR(input);
      expect(result.text).not.toContain("\n\n\n");
    });
  });
  describe("blockquote with multi-paragraph content", () => {
    it("should handle multi-paragraph blockquote followed by paragraph", () => {
      const input = "> first paragraph\n>\n> second paragraph\n\nfollowing paragraph";
      const result = markdownToIR(input);
      expect(result.text).toContain("first paragraph\n\nsecond paragraph");
      expect(result.text).not.toContain("\n\n\n");
    });
  });
  describe("blockquote prefix option", () => {
    it("should include prefix and maintain proper spacing", () => {
      const input = "> quote\n\nparagraph";
      const result = markdownToIR(input, { blockquotePrefix: "> " });
      expect(result.text).toBe("> quote\n\nparagraph");
      expect(result.text).not.toContain("\n\n\n");
    });
  });
  describe("edge cases", () => {
    it("should handle empty blockquote followed by paragraph", () => {
      const input = ">\n\nparagraph";
      const result = markdownToIR(input);
      expect(result.text).not.toContain("\n\n\n");
    });
    it("should handle blockquote at end of document", () => {
      const input = "paragraph\n\n> quote";
      const result = markdownToIR(input);
      expect(result.text).not.toContain("\n\n\n");
    });
    it("should handle multiple blockquotes with paragraphs between", () => {
      const input = "> first\n\nparagraph\n\n> second";
      const result = markdownToIR(input);
      expect(result.text).toBe("first\n\nparagraph\n\nsecond");
      expect(result.text).not.toContain("\n\n\n");
    });
  });
});
describe("comparison with other block elements (control group)", () => {
  it("paragraphs should have double newline separation", () => {
    const input = "paragraph 1\n\nparagraph 2";
    const result = markdownToIR(input);
    expect(result.text).toBe("paragraph 1\n\nparagraph 2");
    expect(result.text).not.toContain("\n\n\n");
  });
  it("list followed by paragraph should have double newline", () => {
    const input = "- item 1\n- item 2\n\nparagraph";
    const result = markdownToIR(input);
    expect(result.text).toContain(`\u2022 item 2

paragraph`);
    expect(result.text).not.toContain("\n\n\n");
  });
  it("heading followed by paragraph should have double newline", () => {
    const input = "# Heading\n\nparagraph";
    const result = markdownToIR(input);
    expect(result.text).toBe("Heading\n\nparagraph");
    expect(result.text).not.toContain("\n\n\n");
  });
});
