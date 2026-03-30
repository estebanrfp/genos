import { describe, expect, it, vi } from "vitest";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";
describe("subscribeEmbeddedPiSession", () => {
  it("does not call onBlockReplyFlush when callback is not provided", () => {
    let handler;
    const session = {
      subscribe: (fn) => {
        handler = fn;
        return () => {};
      },
    };
    const onBlockReply = vi.fn();
    subscribeEmbeddedPiSession({
      session,
      runId: "run-no-flush",
      onBlockReply,
      blockReplyBreak: "text_end",
    });
    expect(() => {
      handler?.({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "tool-no-flush",
        args: { command: "echo test" },
      });
    }).not.toThrow();
  });
});
