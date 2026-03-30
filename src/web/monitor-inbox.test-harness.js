let createMockSock = function () {
  const ev = new EventEmitter();
  return {
    ev,
    ws: { close: vi.fn() },
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    readMessages: vi.fn().mockResolvedValue(undefined),
    updateMediaMessage: vi.fn(),
    logger: {},
    signalRepository: {
      lidMapping: {
        getPNForLID: vi.fn().mockResolvedValue(null),
      },
    },
    user: { id: "123@s.whatsapp.net" },
  };
};
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { resetLogger, setLoggerOverride } from "../logging.js";
export const DEFAULT_ACCOUNT_ID = "default";
export const DEFAULT_WEB_INBOX_CONFIG = {
  channels: {
    whatsapp: {
      allowFrom: ["*"],
    },
  },
  messages: {
    messagePrefix: undefined,
    responsePrefix: undefined,
  },
};
export const mockLoadConfig = vi.fn().mockReturnValue(DEFAULT_WEB_INBOX_CONFIG);
export const readAllowFromStoreMock = vi.fn().mockResolvedValue([]);
export const upsertPairingRequestMock = vi
  .fn()
  .mockResolvedValue({ code: "PAIRCODE", created: true });
const sock = createMockSock();
vi.mock("../media/store.js", () => ({
  saveMediaBuffer: vi.fn().mockResolvedValue({
    id: "mid",
    path: "/tmp/mid",
    size: 1,
    contentType: "image/jpeg",
  }),
}));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => mockLoadConfig(),
  };
});
vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: (...args) => readAllowFromStoreMock(...args),
  upsertChannelPairingRequest: (...args) => upsertPairingRequestMock(...args),
}));
vi.mock("./session.js", () => ({
  createWaSocket: vi.fn().mockResolvedValue(sock),
  waitForWaConnection: vi.fn().mockResolvedValue(undefined),
  getStatusCode: vi.fn(() => 500),
}));
export function getSock() {
  return sock;
}
let authDir;
export function getAuthDir() {
  if (!authDir) {
    throw new Error("authDir not initialized; call installWebMonitorInboxUnitTestHooks()");
  }
  return authDir;
}
export function installWebMonitorInboxUnitTestHooks(opts) {
  const createAuthDir = opts?.authDir ?? true;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(DEFAULT_WEB_INBOX_CONFIG);
    readAllowFromStoreMock.mockResolvedValue([]);
    upsertPairingRequestMock.mockResolvedValue({
      code: "PAIRCODE",
      created: true,
    });
    const { resetWebInboundDedupe } = await import("./inbound.js");
    resetWebInboundDedupe();
    if (createAuthDir) {
      authDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "genosos-auth-"));
    } else {
      authDir = undefined;
    }
  });
  afterEach(() => {
    resetLogger();
    setLoggerOverride(null);
    vi.useRealTimers();
    if (authDir) {
      fsSync.rmSync(authDir, { recursive: true, force: true });
      authDir = undefined;
    }
  });
}
