let assistantToolCall = function (id) {
    return {
      role: "assistant",
      content: [{ type: "toolCall", id, name: "exec", arguments: {} }],
      stopReason: "toolUse",
    };
  },
  toolResult = function (id, text) {
    return {
      role: "toolResult",
      toolCallId: id,
      content: [{ type: "text", text }],
      isError: false,
    };
  },
  deferred = function () {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  },
  getMessages = function (sm) {
    return sm
      .getEntries()
      .filter((e) => e.type === "message")
      .map((e) => e.message);
  };
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPendingToolResultsAfterIdle } from "./pi-embedded-runner/wait-for-idle-before-flush.js";
import { guardSessionManager } from "./session-tool-result-guard-wrapper.js";
describe("flushPendingToolResultsAfterIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("waits for idle so real tool results can land before flush", async () => {
    const sm = guardSessionManager(SessionManager.inMemory());
    const appendMessage = sm.appendMessage.bind(sm);
    const idle = deferred();
    const agent = { waitForIdle: () => idle.promise };
    appendMessage(assistantToolCall("call_retry_1"));
    const flushPromise = flushPendingToolResultsAfterIdle({
      agent,
      sessionManager: sm,
      timeoutMs: 1000,
    });
    await Promise.resolve();
    expect(getMessages(sm).map((m) => m.role)).toEqual(["assistant"]);
    appendMessage(toolResult("call_retry_1", "command output here"));
    idle.resolve();
    await flushPromise;
    const messages = getMessages(sm);
    expect(messages.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
    expect(messages[1].isError).not.toBe(true);
    expect(messages[1].content?.[0]?.text).toBe("command output here");
  });
  it("flushes pending tool call after timeout when idle never resolves", async () => {
    const sm = guardSessionManager(SessionManager.inMemory());
    const appendMessage = sm.appendMessage.bind(sm);
    vi.useFakeTimers();
    const agent = { waitForIdle: () => new Promise(() => {}) };
    appendMessage(assistantToolCall("call_orphan_1"));
    const flushPromise = flushPendingToolResultsAfterIdle({
      agent,
      sessionManager: sm,
      timeoutMs: 30,
    });
    await vi.advanceTimersByTimeAsync(30);
    await flushPromise;
    const entries = getMessages(sm);
    expect(entries.length).toBe(2);
    expect(entries[1].role).toBe("toolResult");
    expect(entries[1].isError).toBe(true);
    expect(entries[1].content?.[0]?.text).toContain("missing tool result");
  });
  it("clears timeout handle when waitForIdle resolves first", async () => {
    const sm = guardSessionManager(SessionManager.inMemory());
    vi.useFakeTimers();
    const agent = {
      waitForIdle: async () => {},
    };
    await flushPendingToolResultsAfterIdle({
      agent,
      sessionManager: sm,
      timeoutMs: 30000,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
