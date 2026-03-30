import { describe, expect, it } from "vitest";
import { formatRelativeTimestamp, stripThinkingTags } from "./format.js";
describe("formatAgo", () => {
  it("returns 'in <1m' for timestamps less than 60s in the future", () => {
    expect(formatRelativeTimestamp(Date.now() + 30000)).toBe("in <1m");
  });
  it("returns 'Xm from now' for future timestamps", () => {
    expect(formatRelativeTimestamp(Date.now() + 300000)).toBe("in 5m");
  });
  it("returns 'Xh from now' for future timestamps", () => {
    expect(formatRelativeTimestamp(Date.now() + 10800000)).toBe("in 3h");
  });
  it("returns 'Xd from now' for future timestamps beyond 48h", () => {
    expect(formatRelativeTimestamp(Date.now() + 259200000)).toBe("in 3d");
  });
  it("returns 'Xs ago' for recent past timestamps", () => {
    expect(formatRelativeTimestamp(Date.now() - 1e4)).toBe("just now");
  });
  it("returns 'Xm ago' for past timestamps", () => {
    expect(formatRelativeTimestamp(Date.now() - 300000)).toBe("5m ago");
  });
  it("returns 'n/a' for null/undefined", () => {
    expect(formatRelativeTimestamp(null)).toBe("n/a");
    expect(formatRelativeTimestamp(undefined)).toBe("n/a");
  });
});
describe("stripThinkingTags", () => {
  it("strips <think>\u2026</think> segments", () => {
    const input = ["<think>", "secret", "</think>", "", "Hello"].join("\n");
    expect(stripThinkingTags(input)).toBe("Hello");
  });
  it("strips <thinking>\u2026</thinking> segments", () => {
    const input = ["<thinking>", "secret", "</thinking>", "", "Hello"].join("\n");
    expect(stripThinkingTags(input)).toBe("Hello");
  });
  it("keeps text when tags are unpaired", () => {
    expect(stripThinkingTags("<think>\nsecret\nHello")).toBe("secret\nHello");
    expect(stripThinkingTags("Hello\n</think>")).toBe("Hello\n");
  });
  it("returns original text when no tags exist", () => {
    expect(stripThinkingTags("Hello")).toBe("Hello");
  });
  it("strips <final>\u2026</final> segments", () => {
    const input = "<final>\n\nHello there\n\n</final>";
    expect(stripThinkingTags(input)).toBe("Hello there\n\n");
  });
  it("strips mixed <think> and <final> tags", () => {
    const input = "<think>reasoning</think>\n\n<final>Hello</final>";
    expect(stripThinkingTags(input)).toBe("Hello");
  });
  it("handles incomplete <final tag gracefully", () => {
    expect(stripThinkingTags("<final\nHello")).toBe("<final\nHello");
    expect(stripThinkingTags("Hello</final>")).toBe("Hello");
  });
});
