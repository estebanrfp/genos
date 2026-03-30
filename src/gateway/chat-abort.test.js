let createActiveEntry = function (sessionKey) {
    const now = Date.now();
    return {
      controller: new AbortController(),
      sessionId: "sess-1",
      sessionKey,
      startedAtMs: now,
      expiresAtMs: now + 1e4,
    };
  },
  createOps = function (params) {
    const { runId, entry, buffer } = params;
    const broadcast = vi.fn();
    const nodeSendToSession = vi.fn();
    const removeChatRun = vi.fn();
    return {
      chatAbortControllers: new Map([[runId, entry]]),
      chatRunBuffers: new Map(buffer !== undefined ? [[runId, buffer]] : []),
      chatDeltaSentAt: new Map([[runId, Date.now()]]),
      chatAbortedRuns: new Map(),
      removeChatRun,
      agentRunSeq: new Map(),
      broadcast,
      nodeSendToSession,
    };
  };
import { describe, expect, it, vi } from "vitest";
import { abortChatRunById } from "./chat-abort.js";
describe("abortChatRunById", () => {
  it("broadcasts aborted payload with partial message when buffered text exists", () => {
    const runId = "run-1";
    const sessionKey = "main";
    const entry = createActiveEntry(sessionKey);
    const ops = createOps({ runId, entry, buffer: "  Partial reply  " });
    ops.agentRunSeq.set(runId, 2);
    ops.agentRunSeq.set("client-run-1", 4);
    ops.removeChatRun.mockReturnValue({ sessionKey, clientRunId: "client-run-1" });
    const result = abortChatRunById(ops, { runId, sessionKey, stopReason: "user" });
    expect(result).toEqual({ aborted: true });
    expect(entry.controller.signal.aborted).toBe(true);
    expect(ops.chatAbortControllers.has(runId)).toBe(false);
    expect(ops.chatRunBuffers.has(runId)).toBe(false);
    expect(ops.chatDeltaSentAt.has(runId)).toBe(false);
    expect(ops.removeChatRun).toHaveBeenCalledWith(runId, runId, sessionKey);
    expect(ops.agentRunSeq.has(runId)).toBe(false);
    expect(ops.agentRunSeq.has("client-run-1")).toBe(false);
    expect(ops.broadcast).toHaveBeenCalledTimes(1);
    const payload = ops.broadcast.mock.calls[0]?.[1];
    expect(payload).toEqual(
      expect.objectContaining({
        runId,
        sessionKey,
        seq: 3,
        state: "aborted",
        stopReason: "user",
      }),
    );
    expect(payload.message).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "  Partial reply  " }],
      }),
    );
    expect(payload.message.timestamp).toEqual(expect.any(Number));
    expect(ops.nodeSendToSession).toHaveBeenCalledWith(sessionKey, "chat", payload);
  });
  it("omits aborted message when buffered text is empty", () => {
    const runId = "run-1";
    const sessionKey = "main";
    const entry = createActiveEntry(sessionKey);
    const ops = createOps({ runId, entry, buffer: "   " });
    const result = abortChatRunById(ops, { runId, sessionKey });
    expect(result).toEqual({ aborted: true });
    const payload = ops.broadcast.mock.calls[0]?.[1];
    expect(payload.message).toBeUndefined();
  });
  it("preserves partial message even when abort listeners clear buffers synchronously", () => {
    const runId = "run-1";
    const sessionKey = "main";
    const entry = createActiveEntry(sessionKey);
    const ops = createOps({ runId, entry, buffer: "streamed text" });
    entry.controller.signal.addEventListener("abort", () => {
      ops.chatRunBuffers.delete(runId);
    });
    const result = abortChatRunById(ops, { runId, sessionKey });
    expect(result).toEqual({ aborted: true });
    const payload = ops.broadcast.mock.calls[0]?.[1];
    expect(payload.message).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "streamed text" }],
      }),
    );
  });
});
