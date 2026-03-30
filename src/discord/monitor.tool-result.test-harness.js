import { vi } from "vitest";
export const sendMock = vi.fn();
export const reactMock = vi.fn();
export const updateLastRouteMock = vi.fn();
export const dispatchMock = vi.fn();
export const readAllowFromStoreMock = vi.fn();
export const upsertPairingRequestMock = vi.fn();
vi.mock("./send.js", () => ({
  sendMessageDiscord: (...args) => sendMock(...args),
  reactMessageDiscord: async (...args) => {
    reactMock(...args);
  },
}));
vi.mock("../auto-reply/dispatch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    dispatchInboundMessage: (...args) => dispatchMock(...args),
    dispatchInboundMessageWithDispatcher: (...args) => dispatchMock(...args),
    dispatchInboundMessageWithBufferedDispatcher: (...args) => dispatchMock(...args),
  };
});
vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: (...args) => readAllowFromStoreMock(...args),
  upsertChannelPairingRequest: (...args) => upsertPairingRequestMock(...args),
}));
vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveStorePath: vi.fn(() => "/tmp/genosos-sessions.json"),
    updateLastRoute: (...args) => updateLastRouteMock(...args),
    resolveSessionKey: vi.fn(),
  };
});
