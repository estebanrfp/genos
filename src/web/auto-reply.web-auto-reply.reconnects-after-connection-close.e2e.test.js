let createRuntime = function () {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
  },
  startMonitorWebChannel = function (params) {
    const runtime = createRuntime();
    const controller = new AbortController();
    const run = params.monitorWebChannelFn(
      false,
      params.listenerFactory,
      true,
      async () => ({ text: "ok" }),
      runtime,
      params.signal ?? controller.signal,
      {
        heartbeatSeconds: 1,
        reconnect: params.reconnect ?? { initialMs: 10, maxMs: 10, maxAttempts: 3, factor: 1.1 },
        sleep: params.sleep,
      },
    );
    return { runtime, controller, run };
  },
  makeInboundMessage = function (params) {
    return {
      body: params.body,
      from: params.from,
      to: params.to,
      id: params.id,
      timestamp: params.timestamp,
      conversationId: params.from,
      accountId: "default",
      chatType: "direct",
      chatId: params.from,
      sendComposing: params.sendComposing,
      reply: params.reply,
      sendMedia: params.sendMedia,
    };
  };
import { beforeAll, describe, expect, it, vi } from "vitest";
import { escapeRegExp, formatEnvelopeTimestamp } from "../../test/helpers/envelope-timestamp.js";
import {
  installWebAutoReplyTestHomeHooks,
  installWebAutoReplyUnitTestHooks,
  makeSessionStore,
  setLoadConfigMock,
} from "./auto-reply.test-harness.js";
installWebAutoReplyTestHomeHooks();
describe("web auto-reply", () => {
  installWebAutoReplyUnitTestHooks();
  let monitorWebChannel;
  beforeAll(async () => {
    ({ monitorWebChannel } = await import("./auto-reply.js"));
  });
  it("handles helper envelope timestamps with trimmed timezones (regression)", () => {
    const d = new Date("2025-01-01T00:00:00.000Z");
    expect(() => formatEnvelopeTimestamp(d, " America/Los_Angeles ")).not.toThrow();
  });
  it("reconnects after a connection close", async () => {
    const closeResolvers = [];
    const sleep = vi.fn(async () => {});
    const listenerFactory = vi.fn(async () => {
      let _resolve;
      const onClose = new Promise((res) => {
        _resolve = res;
        closeResolvers.push(res);
      });
      return { close: vi.fn(), onClose };
    });
    const { runtime, controller, run } = startMonitorWebChannel({
      monitorWebChannelFn: monitorWebChannel,
      listenerFactory,
      sleep,
    });
    await Promise.resolve();
    expect(listenerFactory).toHaveBeenCalledTimes(1);
    closeResolvers[0]?.();
    await vi.waitFor(
      () => {
        expect(listenerFactory).toHaveBeenCalledTimes(2);
      },
      { timeout: 500, interval: 5 },
    );
    expect(listenerFactory).toHaveBeenCalledTimes(2);
    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("Retry 1"));
    controller.abort();
    closeResolvers[1]?.();
    await Promise.resolve();
    await run;
  });
  it("forces reconnect when watchdog closes without onClose", async () => {
    vi.useFakeTimers();
    try {
      const sleep = vi.fn(async () => {});
      const closeResolvers = [];
      let capturedOnMessage;
      const listenerFactory = vi.fn(async (opts) => {
        capturedOnMessage = opts.onMessage;
        let resolveClose = () => {};
        const onClose = new Promise((res) => {
          resolveClose = res;
          closeResolvers.push(res);
        });
        return {
          close: vi.fn(),
          onClose,
          signalClose: (reason) => resolveClose(reason),
        };
      });
      const { controller, run } = startMonitorWebChannel({
        monitorWebChannelFn: monitorWebChannel,
        listenerFactory,
        sleep,
      });
      await Promise.resolve();
      expect(listenerFactory).toHaveBeenCalledTimes(1);
      const reply = vi.fn().mockResolvedValue(undefined);
      const sendComposing = vi.fn();
      const sendMedia = vi.fn();
      capturedOnMessage?.(
        makeInboundMessage({
          body: "hi",
          from: "+1",
          to: "+2",
          id: "m1",
          sendComposing,
          reply,
          sendMedia,
        }),
      );
      await vi.advanceTimersByTimeAsync(1860000);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(listenerFactory).toHaveBeenCalledTimes(2);
      controller.abort();
      closeResolvers[1]?.({ status: 499, isLoggedOut: false });
      await Promise.resolve();
      await run;
    } finally {
      vi.useRealTimers();
    }
  }, 15000);
  it("stops after hitting max reconnect attempts", { timeout: 60000 }, async () => {
    const closeResolvers = [];
    const sleep = vi.fn(async () => {});
    const listenerFactory = vi.fn(async () => {
      const onClose = new Promise((res) => closeResolvers.push(res));
      return { close: vi.fn(), onClose };
    });
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
    const run = monitorWebChannel(
      false,
      listenerFactory,
      true,
      async () => ({ text: "ok" }),
      runtime,
      undefined,
      {
        heartbeatSeconds: 1,
        reconnect: { initialMs: 5, maxMs: 5, maxAttempts: 2, factor: 1.1 },
        sleep,
      },
    );
    await Promise.resolve();
    expect(listenerFactory).toHaveBeenCalledTimes(1);
    closeResolvers.shift()?.();
    await vi.waitFor(
      () => {
        expect(listenerFactory).toHaveBeenCalledTimes(2);
      },
      { timeout: 500, interval: 5 },
    );
    expect(listenerFactory).toHaveBeenCalledTimes(2);
    closeResolvers.shift()?.();
    await run;
    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("max attempts reached"));
  });
  it("processes inbound messages without batching and preserves timestamps", async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "Europe/Vienna";
    const originalMax = process.getMaxListeners();
    process.setMaxListeners?.(1);
    const store = await makeSessionStore({
      main: { sessionId: "sid", updatedAt: Date.now() },
    });
    try {
      const sendMedia = vi.fn();
      const reply = vi.fn().mockResolvedValue(undefined);
      const sendComposing = vi.fn();
      const resolver = vi.fn().mockResolvedValue({ text: "ok" });
      let capturedOnMessage;
      const listenerFactory = async (opts) => {
        capturedOnMessage = opts.onMessage;
        return { close: vi.fn() };
      };
      setLoadConfigMock(() => ({
        agents: {
          defaults: {
            envelopeTimezone: "utc",
          },
        },
        session: { store: store.storePath },
      }));
      await monitorWebChannel(false, listenerFactory, false, resolver);
      expect(capturedOnMessage).toBeDefined();
      await capturedOnMessage?.(
        makeInboundMessage({
          body: "first",
          from: "+1",
          to: "+2",
          id: "m1",
          timestamp: 1735689600000,
          sendComposing,
          reply,
          sendMedia,
        }),
      );
      await capturedOnMessage?.(
        makeInboundMessage({
          body: "second",
          from: "+1",
          to: "+2",
          id: "m2",
          timestamp: 1735693200000,
          sendComposing,
          reply,
          sendMedia,
        }),
      );
      expect(resolver).toHaveBeenCalledTimes(2);
      const firstArgs = resolver.mock.calls[0][0];
      const secondArgs = resolver.mock.calls[1][0];
      const firstTimestamp = formatEnvelopeTimestamp(new Date("2025-01-01T00:00:00Z"));
      const secondTimestamp = formatEnvelopeTimestamp(new Date("2025-01-01T01:00:00Z"));
      const firstPattern = escapeRegExp(firstTimestamp);
      const secondPattern = escapeRegExp(secondTimestamp);
      expect(firstArgs.Body).toMatch(
        new RegExp(`\\[WhatsApp \\+1 (\\+\\d+[smhd] )?${firstPattern}\\] \\[genosos\\] first`),
      );
      expect(firstArgs.Body).not.toContain("second");
      expect(secondArgs.Body).toMatch(
        new RegExp(`\\[WhatsApp \\+1 (\\+\\d+[smhd] )?${secondPattern}\\] \\[genosos\\] second`),
      );
      expect(secondArgs.Body).not.toContain("first");
      expect(process.getMaxListeners?.()).toBeGreaterThanOrEqual(50);
    } finally {
      process.setMaxListeners?.(originalMax);
      process.env.TZ = originalTz;
      await store.cleanup();
    }
  });
});
