import { describe, it, expect } from "vitest";
import { markdownToIR } from "./ir.js";
describe("Nested Lists - 2 Level Nesting", () => {
  it("renders bullet items nested inside bullet items with proper indentation", () => {
    const input = `- Item 1
  - Nested 1.1
  - Nested 1.2
- Item 2`;
    const result = markdownToIR(input);
    const expected = `\u2022 Item 1
  \u2022 Nested 1.1
  \u2022 Nested 1.2
\u2022 Item 2`;
    expect(result.text).toBe(expected);
  });
  it("renders ordered items nested inside bullet items", () => {
    const input = `- Bullet item
  1. Ordered sub-item 1
  2. Ordered sub-item 2
- Another bullet`;
    const result = markdownToIR(input);
    const expected = `\u2022 Bullet item
  1. Ordered sub-item 1
  2. Ordered sub-item 2
\u2022 Another bullet`;
    expect(result.text).toBe(expected);
  });
  it("renders bullet items nested inside ordered items", () => {
    const input = `1. Ordered 1
   - Bullet sub 1
   - Bullet sub 2
2. Ordered 2`;
    const result = markdownToIR(input);
    const expected = `1. Ordered 1
  \u2022 Bullet sub 1
  \u2022 Bullet sub 2
2. Ordered 2`;
    expect(result.text).toBe(expected);
  });
  it("renders ordered items nested inside ordered items", () => {
    const input = `1. First
   1. Sub-first
   2. Sub-second
2. Second`;
    const result = markdownToIR(input);
    const expected = `1. First
  1. Sub-first
  2. Sub-second
2. Second`;
    expect(result.text).toBe(expected);
  });
});
describe("Nested Lists - 3+ Level Deep Nesting", () => {
  it("renders 3 levels of bullet nesting", () => {
    const input = `- Level 1
  - Level 2
    - Level 3
- Back to 1`;
    const result = markdownToIR(input);
    const expected = `\u2022 Level 1
  \u2022 Level 2
    \u2022 Level 3
\u2022 Back to 1`;
    expect(result.text).toBe(expected);
  });
  it("renders 4 levels of bullet nesting", () => {
    const input = `- L1
  - L2
    - L3
      - L4
- Back`;
    const result = markdownToIR(input);
    const expected = `\u2022 L1
  \u2022 L2
    \u2022 L3
      \u2022 L4
\u2022 Back`;
    expect(result.text).toBe(expected);
  });
  it("renders 3 levels with multiple items at each level", () => {
    const input = `- A1
  - B1
    - C1
    - C2
  - B2
- A2`;
    const result = markdownToIR(input);
    const expected = `\u2022 A1
  \u2022 B1
    \u2022 C1
    \u2022 C2
  \u2022 B2
\u2022 A2`;
    expect(result.text).toBe(expected);
  });
});
describe("Nested Lists - Mixed Nesting", () => {
  it("renders complex mixed nesting (bullet > ordered > bullet)", () => {
    const input = `- Bullet 1
  1. Ordered 1.1
     - Deep bullet
  2. Ordered 1.2
- Bullet 2`;
    const result = markdownToIR(input);
    const expected = `\u2022 Bullet 1
  1. Ordered 1.1
    \u2022 Deep bullet
  2. Ordered 1.2
\u2022 Bullet 2`;
    expect(result.text).toBe(expected);
  });
  it("renders ordered > bullet > ordered nesting", () => {
    const input = `1. First
   - Sub bullet
     1. Deep ordered
   - Another bullet
2. Second`;
    const result = markdownToIR(input);
    const expected = `1. First
  \u2022 Sub bullet
    1. Deep ordered
  \u2022 Another bullet
2. Second`;
    expect(result.text).toBe(expected);
  });
});
describe("Nested Lists - Newline Handling", () => {
  it("does not produce triple newlines in nested lists", () => {
    const input = `- Item 1
  - Nested
- Item 2`;
    const result = markdownToIR(input);
    expect(result.text).not.toContain("\n\n\n");
  });
  it("does not produce double newlines between nested items", () => {
    const input = `- A
  - B
  - C
- D`;
    const result = markdownToIR(input);
    expect(result.text).toContain(`  \u2022 B
  \u2022 C`);
    expect(result.text).not.toContain(`  \u2022 B

  \u2022 C`);
  });
  it("properly terminates top-level list (trimmed output)", () => {
    const input = `- Item 1
  - Nested
- Item 2`;
    const result = markdownToIR(input);
    expect(result.text).toMatch(/Item 2$/);
    expect(result.text).not.toContain(`

\u2022 Item 2`);
  });
});
describe("Nested Lists - Edge Cases", () => {
  it("handles empty parent with nested items", () => {
    const input = `-
  - Nested only
- Normal`;
    const result = markdownToIR(input);
    expect(result.text).toContain("  \u2022 Nested only");
  });
  it("handles nested list as first child of parent item", () => {
    const input = `- Parent text
  - Child
- Another parent`;
    const result = markdownToIR(input);
    expect(result.text).toContain(`\u2022 Parent text
  \u2022 Child`);
  });
  it("handles sibling nested lists at same level", () => {
    const input = `- A
  - A1
- B
  - B1`;
    const result = markdownToIR(input);
    const expected = `\u2022 A
  \u2022 A1
\u2022 B
  \u2022 B1`;
    expect(result.text).toBe(expected);
  });
});
describe("list paragraph spacing", () => {
  it("adds blank line between bullet list and following paragraph", () => {
    const input = `- item 1
- item 2

Paragraph after`;
    const result = markdownToIR(input);
    expect(result.text).toContain("item 2\n\nParagraph");
  });
  it("adds blank line between ordered list and following paragraph", () => {
    const input = `1. item 1
2. item 2

Paragraph after`;
    const result = markdownToIR(input);
    expect(result.text).toContain("item 2\n\nParagraph");
  });
  it("does not produce triple newlines", () => {
    const input = `- item 1
- item 2

Paragraph after`;
    const result = markdownToIR(input);
    expect(result.text).not.toContain("\n\n\n");
  });
});
