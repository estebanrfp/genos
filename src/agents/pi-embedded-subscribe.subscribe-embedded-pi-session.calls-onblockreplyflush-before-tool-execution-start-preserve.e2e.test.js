import { describe, expect, it, vi } from "vitest";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";
describe("subscribeEmbeddedPiSession", () => {
  it("calls onBlockReplyFlush before tool_execution_start to preserve message boundaries", () => {
    let handler;
    const session = {
      subscribe: (fn) => {
        handler = fn;
        return () => {};
      },
    };
    const onBlockReplyFlush = vi.fn();
    const onBlockReply = vi.fn();
    subscribeEmbeddedPiSession({
      session,
      runId: "run-flush-test",
      onBlockReply,
      onBlockReplyFlush,
      blockReplyBreak: "text_end",
    });
    handler?.({
      type: "message_start",
      message: { role: "assistant" },
    });
    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        delta: "First message before tool.",
      },
    });
    expect(onBlockReplyFlush).not.toHaveBeenCalled();
    handler?.({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "tool-flush-1",
      args: { command: "echo hello" },
    });
    expect(onBlockReplyFlush).toHaveBeenCalledTimes(1);
    handler?.({
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: "tool-flush-2",
      args: { path: "/tmp/test.txt" },
    });
    expect(onBlockReplyFlush).toHaveBeenCalledTimes(2);
  });
  it("flushes buffered block chunks before tool execution", () => {
    let handler;
    const session = {
      subscribe: (fn) => {
        handler = fn;
        return () => {};
      },
    };
    const onBlockReply = vi.fn();
    const onBlockReplyFlush = vi.fn();
    subscribeEmbeddedPiSession({
      session,
      runId: "run-flush-buffer",
      onBlockReply,
      onBlockReplyFlush,
      blockReplyBreak: "text_end",
      blockReplyChunking: { minChars: 50, maxChars: 200 },
    });
    handler?.({
      type: "message_start",
      message: { role: "assistant" },
    });
    handler?.({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Short chunk.",
      },
    });
    expect(onBlockReply).not.toHaveBeenCalled();
    handler?.({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "tool-flush-buffer-1",
      args: { command: "echo flush" },
    });
    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply.mock.calls[0]?.[0]?.text).toBe("Short chunk.");
    expect(onBlockReplyFlush).toHaveBeenCalledTimes(1);
    expect(onBlockReply.mock.invocationCallOrder[0]).toBeLessThan(
      onBlockReplyFlush.mock.invocationCallOrder[0],
    );
  });
});
