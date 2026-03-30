let createMonitorRuntime = function () {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: (code) => {
        throw new Error(`exit ${code}`);
      },
    };
  },
  setSignalAutoStartConfig = function (overrides = {}) {
    setSignalToolResultTestConfig(createSignalConfig(overrides));
  },
  createSignalConfig = function (overrides = {}) {
    const base = config;
    const channels = base.channels ?? {};
    const signal = channels.signal ?? {};
    return {
      ...base,
      channels: {
        ...channels,
        signal: {
          ...signal,
          autoStart: true,
          dmPolicy: "open",
          allowFrom: ["*"],
          ...overrides,
        },
      },
    };
  },
  createAutoAbortController = function () {
    const abortController = new AbortController();
    streamMock.mockImplementation(async () => {
      abortController.abort();
      return;
    });
    return abortController;
  },
  getDirectSignalEventsFor = function (sender) {
    const route = resolveAgentRoute({
      cfg: config,
      channel: "signal",
      accountId: "default",
      peer: { kind: "direct", id: normalizeE164(sender) },
    });
    return peekSystemEvents(route.sessionKey);
  },
  makeBaseEnvelope = function (overrides = {}) {
    return {
      sourceNumber: "+15550001111",
      sourceName: "Ada",
      timestamp: 1,
      ...overrides,
    };
  },
  expectNoReplyDeliveryOrRouteUpdate = function () {
    expect(replyMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(updateLastRouteMock).not.toHaveBeenCalled();
  },
  setReactionNotificationConfig = function (mode, extra = {}) {
    setSignalToolResultTestConfig(
      createSignalConfig({
        autoStart: false,
        dmPolicy: "open",
        allowFrom: ["*"],
        reactionNotifications: mode,
        ...extra,
      }),
    );
  },
  expectWaitForTransportReadyTimeout = function (timeoutMs) {
    expect(waitForTransportReadyMock).toHaveBeenCalledTimes(1);
    expect(waitForTransportReadyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs,
      }),
    );
  };
import { describe, expect, it, vi } from "vitest";
import { peekSystemEvents } from "../infra/system-events.js";
import { resolveAgentRoute } from "../routing/resolve-route.js";
import { normalizeE164 } from "../utils.js";
import {
  config,
  flush,
  getSignalToolResultTestMocks,
  installSignalToolResultTestHooks,
  setSignalToolResultTestConfig,
} from "./monitor.tool-result.test-harness.js";
installSignalToolResultTestHooks();
await import("./monitor.js");
const {
  replyMock,
  sendMock,
  streamMock,
  updateLastRouteMock,
  upsertPairingRequestMock,
  waitForTransportReadyMock,
} = getSignalToolResultTestMocks();
const SIGNAL_BASE_URL = "http://127.0.0.1:8080";
async function runMonitorWithMocks(opts) {
  const { monitorSignalProvider } = await import("./monitor.js");
  return monitorSignalProvider(opts);
}
async function receiveSignalPayloads(params) {
  const abortController = new AbortController();
  streamMock.mockImplementation(async ({ onEvent }) => {
    for (const payload of params.payloads) {
      await onEvent({
        event: "receive",
        data: JSON.stringify(payload),
      });
    }
    abortController.abort();
  });
  await runMonitorWithMocks({
    autoStart: false,
    baseUrl: SIGNAL_BASE_URL,
    abortSignal: abortController.signal,
    ...params.opts,
  });
  await flush();
}
async function receiveSingleEnvelope(envelope, opts) {
  await receiveSignalPayloads({
    payloads: [{ envelope }],
    opts,
  });
}
describe("monitorSignalProvider tool results", () => {
  it("uses bounded readiness checks when auto-starting the daemon", async () => {
    const runtime = createMonitorRuntime();
    setSignalAutoStartConfig();
    const abortController = createAutoAbortController();
    await runMonitorWithMocks({
      autoStart: true,
      baseUrl: SIGNAL_BASE_URL,
      abortSignal: abortController.signal,
      runtime,
    });
    expect(waitForTransportReadyMock).toHaveBeenCalledTimes(1);
    expect(waitForTransportReadyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "signal daemon",
        timeoutMs: 30000,
        logAfterMs: 1e4,
        logIntervalMs: 1e4,
        pollIntervalMs: 150,
        runtime,
        abortSignal: abortController.signal,
      }),
    );
  });
  it("uses startupTimeoutMs override when provided", async () => {
    const runtime = createMonitorRuntime();
    setSignalAutoStartConfig({ startupTimeoutMs: 60000 });
    const abortController = createAutoAbortController();
    await runMonitorWithMocks({
      autoStart: true,
      baseUrl: SIGNAL_BASE_URL,
      abortSignal: abortController.signal,
      runtime,
      startupTimeoutMs: 90000,
    });
    expectWaitForTransportReadyTimeout(90000);
  });
  it("caps startupTimeoutMs at 2 minutes", async () => {
    const runtime = createMonitorRuntime();
    setSignalAutoStartConfig({ startupTimeoutMs: 180000 });
    const abortController = createAutoAbortController();
    await runMonitorWithMocks({
      autoStart: true,
      baseUrl: SIGNAL_BASE_URL,
      abortSignal: abortController.signal,
      runtime,
    });
    expectWaitForTransportReadyTimeout(120000);
  });
  it("skips tool summaries with responsePrefix", async () => {
    replyMock.mockResolvedValue({ text: "final reply" });
    await receiveSignalPayloads({
      payloads: [
        {
          envelope: {
            sourceNumber: "+15550001111",
            sourceName: "Ada",
            timestamp: 1,
            dataMessage: {
              message: "hello",
            },
          },
        },
      ],
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toBe("PFX final reply");
  });
  it("replies with pairing code when dmPolicy is pairing and no allowFrom is set", async () => {
    setSignalToolResultTestConfig(
      createSignalConfig({ autoStart: false, dmPolicy: "pairing", allowFrom: [] }),
    );
    await receiveSignalPayloads({
      payloads: [
        {
          envelope: {
            sourceNumber: "+15550001111",
            sourceName: "Ada",
            timestamp: 1,
            dataMessage: {
              message: "hello",
            },
          },
        },
      ],
    });
    expect(replyMock).not.toHaveBeenCalled();
    expect(upsertPairingRequestMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(String(sendMock.mock.calls[0]?.[1] ?? "")).toContain("Your Signal number: +15550001111");
    expect(String(sendMock.mock.calls[0]?.[1] ?? "")).toContain("Pairing code: PAIRCODE");
  });
  it("ignores reaction-only messages", async () => {
    await receiveSingleEnvelope({
      ...makeBaseEnvelope(),
      reactionMessage: {
        emoji: "\uD83D\uDC4D",
        targetAuthor: "+15550002222",
        targetSentTimestamp: 2,
      },
    });
    expectNoReplyDeliveryOrRouteUpdate();
  });
  it("ignores reaction-only dataMessage.reaction events (don\u2019t treat as broken attachments)", async () => {
    await receiveSingleEnvelope({
      ...makeBaseEnvelope(),
      dataMessage: {
        reaction: {
          emoji: "\uD83D\uDC4D",
          targetAuthor: "+15550002222",
          targetSentTimestamp: 2,
        },
        attachments: [{}],
      },
    });
    expectNoReplyDeliveryOrRouteUpdate();
  });
  it("enqueues system events for reaction notifications", async () => {
    setReactionNotificationConfig("all");
    await receiveSingleEnvelope({
      ...makeBaseEnvelope(),
      reactionMessage: {
        emoji: "\u2705",
        targetAuthor: "+15550002222",
        targetSentTimestamp: 2,
      },
    });
    const events = getDirectSignalEventsFor("+15550001111");
    expect(events.some((text) => text.includes("Signal reaction added"))).toBe(true);
  });
  it("notifies on own reactions when target includes uuid + phone", async () => {
    setReactionNotificationConfig("own", { account: "+15550002222" });
    await receiveSingleEnvelope({
      ...makeBaseEnvelope(),
      reactionMessage: {
        emoji: "\u2705",
        targetAuthor: "+15550002222",
        targetAuthorUuid: "123e4567-e89b-12d3-a456-426614174000",
        targetSentTimestamp: 2,
      },
    });
    const events = getDirectSignalEventsFor("+15550001111");
    expect(events.some((text) => text.includes("Signal reaction added"))).toBe(true);
  });
  it("processes messages when reaction metadata is present", async () => {
    replyMock.mockResolvedValue({ text: "pong" });
    await receiveSignalPayloads({
      payloads: [
        {
          envelope: {
            sourceNumber: "+15550001111",
            sourceName: "Ada",
            timestamp: 1,
            reactionMessage: {
              emoji: "\uD83D\uDC4D",
              targetAuthor: "+15550002222",
              targetSentTimestamp: 2,
            },
            dataMessage: {
              message: "ping",
            },
          },
        },
      ],
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateLastRouteMock).toHaveBeenCalled();
  });
  it("does not resend pairing code when a request is already pending", async () => {
    setSignalToolResultTestConfig(
      createSignalConfig({ autoStart: false, dmPolicy: "pairing", allowFrom: [] }),
    );
    upsertPairingRequestMock
      .mockResolvedValueOnce({ code: "PAIRCODE", created: true })
      .mockResolvedValueOnce({ code: "PAIRCODE", created: false });
    const payload = {
      envelope: {
        sourceNumber: "+15550001111",
        sourceName: "Ada",
        timestamp: 1,
        dataMessage: {
          message: "hello",
        },
      },
    };
    await receiveSignalPayloads({
      payloads: [
        payload,
        {
          ...payload,
          envelope: { ...payload.envelope, timestamp: 2 },
        },
      ],
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
