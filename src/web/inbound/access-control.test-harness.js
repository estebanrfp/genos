import { beforeEach, vi } from "vitest";
export const sendMessageMock = vi.fn();
export const readAllowFromStoreMock = vi.fn();
export const upsertPairingRequestMock = vi.fn();
let config = {};
export function setAccessControlTestConfig(next) {
  config = next;
}
export function setupAccessControlTestHarness() {
  beforeEach(() => {
    config = {
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          allowFrom: [],
        },
      },
    };
    sendMessageMock.mockReset().mockResolvedValue(undefined);
    readAllowFromStoreMock.mockReset().mockResolvedValue([]);
    upsertPairingRequestMock.mockReset().mockResolvedValue({ code: "PAIRCODE", created: true });
  });
}
vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => config,
  };
});
vi.mock("../../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: (...args) => readAllowFromStoreMock(...args),
  upsertChannelPairingRequest: (...args) => upsertPairingRequestMock(...args),
}));
