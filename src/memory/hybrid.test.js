import { describe, expect, it } from "vitest";
import { bm25RankToScore, buildFtsQuery, mergeHybridResults } from "./hybrid.js";
describe("memory hybrid helpers", () => {
  it("buildFtsQuery tokenizes and AND-joins", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" AND "world"');
    expect(buildFtsQuery("FOO_bar baz-1")).toBe('"FOO_bar" AND "baz" AND "1"');
    expect(buildFtsQuery("\u91D1\u94F6\u4EF7\u683C")).toBe('"\u91D1\u94F6\u4EF7\u683C"');
    expect(buildFtsQuery("\u4FA1\u683C 2026\u5E74")).toBe('"\u4FA1\u683C" AND "2026\u5E74"');
    expect(buildFtsQuery("   ")).toBeNull();
  });
  it("buildFtsQuery filters Spanish stop words", () => {
    expect(buildFtsQuery("venta de la casa fiscal")).toBe('"venta" AND "casa" AND "fiscal"');
  });
  it("buildFtsQuery filters English stop words", () => {
    expect(buildFtsQuery("the solution for the bug")).toBe('"solution" AND "bug"');
  });
  it("buildFtsQuery falls back to all tokens when all are stop words", () => {
    expect(buildFtsQuery("de la")).toBe('"de" AND "la"');
  });
  it("bm25RankToScore is monotonic and clamped", () => {
    expect(bm25RankToScore(0)).toBeCloseTo(1);
    expect(bm25RankToScore(1)).toBeCloseTo(0.5);
    expect(bm25RankToScore(10)).toBeLessThan(bm25RankToScore(1));
    expect(bm25RankToScore(-100)).toBeCloseTo(1);
  });
  it("mergeHybridResults unions by id and combines weighted scores", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 0.7,
      textWeight: 0.3,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.9,
        },
      ],
      keyword: [
        {
          id: "b",
          path: "memory/b.md",
          startLine: 3,
          endLine: 4,
          source: "memory",
          snippet: "kw-b",
          textScore: 1,
        },
      ],
    });
    expect(merged).toHaveLength(2);
    const a = merged.find((r) => r.path === "memory/a.md");
    const b = merged.find((r) => r.path === "memory/b.md");
    expect(a?.score).toBeCloseTo(0.63);
    expect(b?.score).toBeCloseTo(0.3);
  });
  it("mergeHybridResults prefers keyword snippet when ids overlap", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 0.5,
      textWeight: 0.5,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.2,
        },
      ],
      keyword: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "kw-a",
          textScore: 1,
        },
      ],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.snippet).toBe("kw-a");
    expect(merged[0]?.score).toBeCloseTo(0.6);
  });
});
