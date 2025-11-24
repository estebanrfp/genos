import { beforeEach, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import { resetSystemEventsForTest } from "../infra/system-events.js";
const waitForTransportReadyMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
const replyMock = vi.hoisted(() => vi.fn());
const updateLastRouteMock = vi.hoisted(() => vi.fn());
const readAllowFromStoreMock = vi.hoisted(() => vi.fn());
const upsertPairingRequestMock = vi.hoisted(() => vi.fn());
const streamMock = vi.hoisted(() => vi.fn());
const signalCheckMock = vi.hoisted(() => vi.fn());
const signalRpcRequestMock = vi.hoisted(() => vi.fn());
export function getSignalToolResultTestMocks() {
  return {
    waitForTransportReadyMock,
    sendMock,
    replyMock,
    updateLastRouteMock,
    readAllowFromStoreMock,
    upsertPairingRequestMock,
    streamMock,
    signalCheckMock,
    signalRpcRequestMock,
  };
}
export let config = {};
export function setSignalToolResultTestConfig(next) {
  config = next;
}
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => config,
  };
});
vi.mock("../auto-reply/reply.js", () => ({
  getReplyFromConfig: (...args) => replyMock(...args),
}));
vi.mock("./send.js", () => ({
  sendMessageSignal: (...args) => sendMock(...args),
  sendTypingSignal: vi.fn().mockResolvedValue(true),
  sendReadReceiptSignal: vi.fn().mockResolvedValue(true),
}));
vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: (...args) => readAllowFromStoreMock(...args),
  upsertChannelPairingRequest: (...args) => upsertPairingRequestMock(...args),
}));
vi.mock("../config/sessions.js", () => ({
  resolveStorePath: vi.fn(() => "/tmp/genosos-sessions.json"),
  updateLastRoute: (...args) => updateLastRouteMock(...args),
  readSessionUpdatedAt: vi.fn(() => {
    return;
  }),
  recordSessionMetaFromInbound: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./client.js", () => ({
  streamSignalEvents: (...args) => streamMock(...args),
  signalCheck: (...args) => signalCheckMock(...args),
  signalRpcRequest: (...args) => signalRpcRequestMock(...args),
}));
vi.mock("./daemon.js", () => ({
  spawnSignalDaemon: vi.fn(() => ({ stop: vi.fn() })),
}));
vi.mock("../infra/transport-ready.js", () => ({
  waitForTransportReady: (...args) => waitForTransportReadyMock(...args),
}));
export function installSignalToolResultTestHooks() {
  beforeEach(() => {
    resetInboundDedupe();
    config = {
      messages: { responsePrefix: "PFX" },
      channels: {
        signal: { autoStart: false, dmPolicy: "open", allowFrom: ["*"] },
      },
    };
    sendMock.mockReset().mockResolvedValue(undefined);
    replyMock.mockReset();
    updateLastRouteMock.mockReset();
    streamMock.mockReset();
    signalCheckMock.mockReset().mockResolvedValue({});
    signalRpcRequestMock.mockReset().mockResolvedValue({});
    readAllowFromStoreMock.mockReset().mockResolvedValue([]);
    upsertPairingRequestMock.mockReset().mockResolvedValue({ code: "PAIRCODE", created: true });
    waitForTransportReadyMock.mockReset().mockResolvedValue(undefined);
    resetSystemEventsForTest();
  });
}
