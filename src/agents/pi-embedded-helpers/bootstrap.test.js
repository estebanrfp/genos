import { describe, expect, it } from "vitest";
import { compressBootstrapContent, buildBootstrapContextFiles } from "./bootstrap.js";

describe("compressBootstrapContent", () => {
  it("collapses 3+ blank lines to 2", () => {
    const input = "Paragraph 1\n\n\n\nParagraph 2\n\n\n\nParagraph 3";
    expect(compressBootstrapContent(input)).toBe("Paragraph 1\n\nParagraph 2\n\nParagraph 3");
  });

  it("strips HTML comments", () => {
    const input = "Content <!-- hidden --> more";
    expect(compressBootstrapContent(input)).toBe("Content  more");
  });

  it("strips multiline HTML comments", () => {
    const input = "Before\n<!--\n  multi\n  line\n-->\nAfter";
    expect(compressBootstrapContent(input)).toBe("Before\n\nAfter");
  });

  it("strips trailing whitespace per line", () => {
    const input = "line1   \nline2\t\nline3";
    expect(compressBootstrapContent(input)).toBe("line1\nline2\nline3");
  });

  it("removes blank line after heading when followed by content", () => {
    const input = "## Heading\n\nParagraph text";
    expect(compressBootstrapContent(input)).toBe("## Heading\nParagraph text");
  });

  it("preserves double blank lines between non-heading blocks", () => {
    const input = "Paragraph 1\n\nParagraph 2";
    expect(compressBootstrapContent(input)).toBe("Paragraph 1\n\nParagraph 2");
  });

  it("trims trailing whitespace from end of content", () => {
    const input = "Content\n\n\n";
    expect(compressBootstrapContent(input)).toBe("Content");
  });

  it("handles empty string", () => {
    expect(compressBootstrapContent("")).toBe("");
  });
});

describe("buildBootstrapContextFiles with compression", () => {
  it("compresses content before trimming", () => {
    const files = [
      {
        name: "test.md",
        path: "/test.md",
        content: "# Title\n\n\n\n\nContent <!-- remove me -->\nline   \n",
      },
    ];
    const result = buildBootstrapContextFiles(files, { maxChars: 50000 });
    expect(result).toHaveLength(1);
    expect(result[0].content).not.toContain("<!-- remove me -->");
    expect(result[0].content).not.toContain("\n\n\n");
    expect(result[0].content).not.toContain("   \n");
  });
});
