import { describe, expect, it } from "vitest";
import {
  getCompactionSafeguardRuntime,
  setCompactionSafeguardRuntime,
} from "./compaction-safeguard-runtime.js";
import { __testing } from "./compaction-safeguard.js";
const {
  collectToolFailures,
  formatToolFailuresSection,
  computeAdaptiveChunkRatio,
  isOversizedForSummary,
  BASE_CHUNK_RATIO,
  MIN_CHUNK_RATIO,
  SAFETY_MARGIN,
} = __testing;
describe("compaction-safeguard tool failures", () => {
  it("formats tool failures with meta and summary", () => {
    const messages = [
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "exec",
        isError: true,
        details: { status: "failed", exitCode: 1 },
        content: [{ type: "text", text: "ENOENT: missing file" }],
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "ok" }],
        timestamp: Date.now(),
      },
    ];
    const failures = collectToolFailures(messages);
    expect(failures).toHaveLength(1);
    const section = formatToolFailuresSection(failures);
    expect(section).toContain("## Tool Failures");
    expect(section).toContain("exec (status=failed exitCode=1): ENOENT: missing file");
  });
  it("dedupes by toolCallId and handles empty output", () => {
    const messages = [
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "exec",
        isError: true,
        details: { exitCode: 2 },
        content: [],
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "exec",
        isError: true,
        content: [{ type: "text", text: "ignored" }],
        timestamp: Date.now(),
      },
    ];
    const failures = collectToolFailures(messages);
    expect(failures).toHaveLength(1);
    const section = formatToolFailuresSection(failures);
    expect(section).toContain("exec (exitCode=2): failed");
  });
  it("caps the number of failures and adds overflow line", () => {
    const messages = Array.from({ length: 9 }, (_, idx) => ({
      role: "toolResult",
      toolCallId: `call-${idx}`,
      toolName: "exec",
      isError: true,
      content: [{ type: "text", text: `error ${idx}` }],
      timestamp: Date.now(),
    }));
    const failures = collectToolFailures(messages);
    const section = formatToolFailuresSection(failures);
    expect(section).toContain("## Tool Failures");
    expect(section).toContain("...and 1 more");
  });
  it("omits section when there are no tool failures", () => {
    const messages = [
      {
        role: "toolResult",
        toolCallId: "ok",
        toolName: "exec",
        isError: false,
        content: [{ type: "text", text: "ok" }],
        timestamp: Date.now(),
      },
    ];
    const failures = collectToolFailures(messages);
    const section = formatToolFailuresSection(failures);
    expect(section).toBe("");
  });
});
describe("computeAdaptiveChunkRatio", () => {
  const CONTEXT_WINDOW = 200000;
  it("returns BASE_CHUNK_RATIO for normal messages", () => {
    const messages = [
      { role: "user", content: "x".repeat(1000), timestamp: Date.now() },
      {
        role: "assistant",
        content: [{ type: "text", text: "y".repeat(1000) }],
        timestamp: Date.now(),
      },
    ];
    const ratio = computeAdaptiveChunkRatio(messages, CONTEXT_WINDOW);
    expect(ratio).toBe(BASE_CHUNK_RATIO);
  });
  it("reduces ratio when average message > 10% of context", () => {
    const messages = [
      { role: "user", content: "x".repeat(200000), timestamp: Date.now() },
      {
        role: "assistant",
        content: [{ type: "text", text: "y".repeat(200000) }],
        timestamp: Date.now(),
      },
    ];
    const ratio = computeAdaptiveChunkRatio(messages, CONTEXT_WINDOW);
    expect(ratio).toBeLessThan(BASE_CHUNK_RATIO);
    expect(ratio).toBeGreaterThanOrEqual(MIN_CHUNK_RATIO);
  });
  it("respects MIN_CHUNK_RATIO floor", () => {
    const messages = [{ role: "user", content: "x".repeat(600000), timestamp: Date.now() }];
    const ratio = computeAdaptiveChunkRatio(messages, CONTEXT_WINDOW);
    expect(ratio).toBeGreaterThanOrEqual(MIN_CHUNK_RATIO);
  });
  it("handles empty message array", () => {
    const ratio = computeAdaptiveChunkRatio([], CONTEXT_WINDOW);
    expect(ratio).toBe(BASE_CHUNK_RATIO);
  });
  it("handles single huge message", () => {
    const messages = [{ role: "user", content: "x".repeat(720000), timestamp: Date.now() }];
    const ratio = computeAdaptiveChunkRatio(messages, CONTEXT_WINDOW);
    expect(ratio).toBeGreaterThanOrEqual(MIN_CHUNK_RATIO);
    expect(ratio).toBeLessThanOrEqual(BASE_CHUNK_RATIO);
  });
});
describe("isOversizedForSummary", () => {
  const CONTEXT_WINDOW = 200000;
  it("returns false for small messages", () => {
    const msg = {
      role: "user",
      content: "Hello, world!",
      timestamp: Date.now(),
    };
    expect(isOversizedForSummary(msg, CONTEXT_WINDOW)).toBe(false);
  });
  it("returns true for messages > 50% of context", () => {
    const msg = {
      role: "user",
      content: "x".repeat(480000),
      timestamp: Date.now(),
    };
    expect(isOversizedForSummary(msg, CONTEXT_WINDOW)).toBe(true);
  });
  it("applies safety margin", () => {
    const halfContextChars = (CONTEXT_WINDOW * 0.5) / SAFETY_MARGIN;
    const msg = {
      role: "user",
      content: "x".repeat(Math.floor(halfContextChars * 4)),
      timestamp: Date.now(),
    };
    const isOversized = isOversizedForSummary(msg, CONTEXT_WINDOW);
    expect(typeof isOversized).toBe("boolean");
  });
});
describe("compaction-safeguard runtime registry", () => {
  it("stores and retrieves config by session manager identity", () => {
    const sm = {};
    setCompactionSafeguardRuntime(sm, { maxHistoryShare: 0.3 });
    const runtime = getCompactionSafeguardRuntime(sm);
    expect(runtime).toEqual({ maxHistoryShare: 0.3 });
  });
  it("returns null for unknown session manager", () => {
    const sm = {};
    expect(getCompactionSafeguardRuntime(sm)).toBeNull();
  });
  it("clears entry when value is null", () => {
    const sm = {};
    setCompactionSafeguardRuntime(sm, { maxHistoryShare: 0.7 });
    expect(getCompactionSafeguardRuntime(sm)).not.toBeNull();
    setCompactionSafeguardRuntime(sm, null);
    expect(getCompactionSafeguardRuntime(sm)).toBeNull();
  });
  it("ignores non-object session managers", () => {
    setCompactionSafeguardRuntime(null, { maxHistoryShare: 0.5 });
    expect(getCompactionSafeguardRuntime(null)).toBeNull();
    setCompactionSafeguardRuntime(undefined, { maxHistoryShare: 0.5 });
    expect(getCompactionSafeguardRuntime(undefined)).toBeNull();
  });
  it("isolates different session managers", () => {
    const sm1 = {};
    const sm2 = {};
    setCompactionSafeguardRuntime(sm1, { maxHistoryShare: 0.3 });
    setCompactionSafeguardRuntime(sm2, { maxHistoryShare: 0.8 });
    expect(getCompactionSafeguardRuntime(sm1)).toEqual({ maxHistoryShare: 0.3 });
    expect(getCompactionSafeguardRuntime(sm2)).toEqual({ maxHistoryShare: 0.8 });
  });
});
