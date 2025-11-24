let createDispatcher = function (record) {
  return {
    sendToolResult: () => true,
    sendBlockReply: () => true,
    sendFinalReply: () => true,
    getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    markComplete: () => {
      record.push("markComplete");
    },
    waitForIdle: async () => {
      record.push("waitForIdle");
    },
  };
};
import { describe, expect, it, vi } from "vitest";
import { dispatchInboundMessage, withReplyDispatcher } from "./dispatch.js";
import { buildTestCtx } from "./reply/test-ctx.js";
describe("withReplyDispatcher", () => {
  it("always marks complete and waits for idle after success", async () => {
    const order = [];
    const dispatcher = createDispatcher(order);
    const result = await withReplyDispatcher({
      dispatcher,
      run: async () => {
        order.push("run");
        return "ok";
      },
      onSettled: () => {
        order.push("onSettled");
      },
    });
    expect(result).toBe("ok");
    expect(order).toEqual(["run", "markComplete", "waitForIdle", "onSettled"]);
  });
  it("still drains dispatcher after run throws", async () => {
    const order = [];
    const dispatcher = createDispatcher(order);
    const onSettled = vi.fn(() => {
      order.push("onSettled");
    });
    await expect(
      withReplyDispatcher({
        dispatcher,
        run: async () => {
          order.push("run");
          throw new Error("boom");
        },
        onSettled,
      }),
    ).rejects.toThrow("boom");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["run", "markComplete", "waitForIdle", "onSettled"]);
  });
  it("dispatchInboundMessage owns dispatcher lifecycle", async () => {
    const order = [];
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: () => {
        order.push("sendFinalReply");
        return true;
      },
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: () => {
        order.push("markComplete");
      },
      waitForIdle: async () => {
        order.push("waitForIdle");
      },
    };
    await dispatchInboundMessage({
      ctx: buildTestCtx(),
      cfg: {},
      dispatcher,
      replyResolver: async () => ({ text: "ok" }),
    });
    expect(order).toEqual(["sendFinalReply", "markComplete", "waitForIdle"]);
  });
});
