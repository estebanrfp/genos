import { vi } from "vitest";
import { createMockBaileys } from "../../test/mocks/baileys.js";
const CONFIG_KEY = Symbol.for("genosos:testConfigMock");
const DEFAULT_CONFIG = {
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
if (!globalThis[CONFIG_KEY]) {
  globalThis[CONFIG_KEY] = () => DEFAULT_CONFIG;
}
export function setLoadConfigMock(fn) {
  globalThis[CONFIG_KEY] = typeof fn === "function" ? fn : () => fn;
}
export function resetLoadConfigMock() {
  globalThis[CONFIG_KEY] = () => DEFAULT_CONFIG;
}
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => {
      const getter = globalThis[CONFIG_KEY];
      if (typeof getter === "function") {
        return getter();
      }
      return DEFAULT_CONFIG;
    },
  };
});
vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => {
      const getter = globalThis[CONFIG_KEY];
      if (typeof getter === "function") {
        return getter();
      }
      return DEFAULT_CONFIG;
    },
  };
});
vi.mock("../media/store.js", () => ({
  saveMediaBuffer: vi.fn().mockImplementation(async (_buf, contentType) => ({
    id: "mid",
    path: "/tmp/mid",
    size: _buf.length,
    contentType,
  })),
}));
vi.mock("@whiskeysockets/baileys", () => {
  const created = createMockBaileys();
  globalThis[Symbol.for("genosos:lastSocket")] = created.lastSocket;
  return created.mod;
});
vi.mock("qrcode-terminal", () => ({
  default: { generate: vi.fn() },
  generate: vi.fn(),
}));
export const baileys = await import("@whiskeysockets/baileys");
export function resetBaileysMocks() {
  const recreated = createMockBaileys();
  globalThis[Symbol.for("genosos:lastSocket")] = recreated.lastSocket;
  const makeWASocket = vi.mocked(baileys.makeWASocket);
  const makeWASocketImpl = (...args) => recreated.mod.makeWASocket(...args);
  makeWASocket.mockReset();
  makeWASocket.mockImplementation(makeWASocketImpl);
  const useMultiFileAuthState = vi.mocked(baileys.useMultiFileAuthState);
  const useMultiFileAuthStateImpl = (...args) => recreated.mod.useMultiFileAuthState(...args);
  useMultiFileAuthState.mockReset();
  useMultiFileAuthState.mockImplementation(useMultiFileAuthStateImpl);
  const fetchLatestBaileysVersion = vi.mocked(baileys.fetchLatestBaileysVersion);
  const fetchLatestBaileysVersionImpl = (...args) =>
    recreated.mod.fetchLatestBaileysVersion(...args);
  fetchLatestBaileysVersion.mockReset();
  fetchLatestBaileysVersion.mockImplementation(fetchLatestBaileysVersionImpl);
  const makeCacheableSignalKeyStore = vi.mocked(baileys.makeCacheableSignalKeyStore);
  const makeCacheableSignalKeyStoreImpl = (...args) =>
    recreated.mod.makeCacheableSignalKeyStore(...args);
  makeCacheableSignalKeyStore.mockReset();
  makeCacheableSignalKeyStore.mockImplementation(makeCacheableSignalKeyStoreImpl);
}
export function getLastSocket() {
  const getter = globalThis[Symbol.for("genosos:lastSocket")];
  if (typeof getter === "function") {
    return getter();
  }
  if (!getter) {
    throw new Error("Baileys mock not initialized");
  }
  throw new Error("Invalid Baileys socket getter");
}
