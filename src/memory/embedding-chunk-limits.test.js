let createProvider = function (maxInputTokens) {
  return {
    id: "mock",
    model: "mock-embed",
    maxInputTokens,
    embedQuery: async () => [0],
    embedBatch: async () => [[0]],
  };
};
import { describe, expect, it } from "vitest";
import { enforceEmbeddingMaxInputTokens } from "./embedding-chunk-limits.js";
import { estimateUtf8Bytes } from "./embedding-input-limits.js";
describe("embedding chunk limits", () => {
  it("splits oversized chunks so each embedding input stays <= maxInputTokens bytes", () => {
    const provider = createProvider(8192);
    const input = {
      startLine: 1,
      endLine: 1,
      text: "x".repeat(9000),
      hash: "ignored",
    };
    const out = enforceEmbeddingMaxInputTokens(provider, [input]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.map((chunk) => chunk.text).join("")).toBe(input.text);
    expect(out.every((chunk) => estimateUtf8Bytes(chunk.text) <= 8192)).toBe(true);
    expect(out.every((chunk) => chunk.startLine === 1 && chunk.endLine === 1)).toBe(true);
    expect(out.every((chunk) => typeof chunk.hash === "string" && chunk.hash.length > 0)).toBe(
      true,
    );
  });
  it("does not split inside surrogate pairs (emoji)", () => {
    const provider = createProvider(8192);
    const emoji = "\uD83D\uDE00";
    const inputText = `${emoji.repeat(2100)}\n${emoji.repeat(2100)}`;
    const out = enforceEmbeddingMaxInputTokens(provider, [
      { startLine: 1, endLine: 2, text: inputText, hash: "ignored" },
    ]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.map((chunk) => chunk.text).join("")).toBe(inputText);
    expect(out.every((chunk) => estimateUtf8Bytes(chunk.text) <= 8192)).toBe(true);
    expect(out.map((chunk) => chunk.text).join("")).not.toContain("\uFFFD");
  });
});
