import { vi } from "vitest";
const mocks = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  readAllowFromStoreMock: vi.fn(),
  upsertPairingRequestMock: vi.fn(),
  resolveAgentRouteMock: vi.fn(),
  finalizeInboundContextMock: vi.fn(),
  resolveConversationLabelMock: vi.fn(),
  createReplyPrefixOptionsMock: vi.fn(),
}));
vi.mock("../../auto-reply/reply/provider-dispatcher.js", () => ({
  dispatchReplyWithDispatcher: (...args) => mocks.dispatchMock(...args),
}));
vi.mock("../../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: (...args) => mocks.readAllowFromStoreMock(...args),
  upsertChannelPairingRequest: (...args) => mocks.upsertPairingRequestMock(...args),
}));
vi.mock("../../routing/resolve-route.js", () => ({
  resolveAgentRoute: (...args) => mocks.resolveAgentRouteMock(...args),
}));
vi.mock("../../auto-reply/reply/inbound-context.js", () => ({
  finalizeInboundContext: (...args) => mocks.finalizeInboundContextMock(...args),
}));
vi.mock("../../channels/conversation-label.js", () => ({
  resolveConversationLabel: (...args) => mocks.resolveConversationLabelMock(...args),
}));
vi.mock("../../channels/reply-prefix.js", () => ({
  createReplyPrefixOptions: (...args) => mocks.createReplyPrefixOptionsMock(...args),
}));
export function getSlackSlashMocks() {
  return mocks;
}
export function resetSlackSlashMocks() {
  mocks.dispatchMock.mockReset().mockResolvedValue({ counts: { final: 1, tool: 0, block: 0 } });
  mocks.readAllowFromStoreMock.mockReset().mockResolvedValue([]);
  mocks.upsertPairingRequestMock.mockReset().mockResolvedValue({ code: "PAIRCODE", created: true });
  mocks.resolveAgentRouteMock.mockReset().mockReturnValue({
    agentId: "main",
    sessionKey: "session:1",
    accountId: "acct",
  });
  mocks.finalizeInboundContextMock.mockReset().mockImplementation((ctx) => ctx);
  mocks.resolveConversationLabelMock.mockReset().mockReturnValue(undefined);
  mocks.createReplyPrefixOptionsMock.mockReset().mockReturnValue({ onModelSelected: () => {} });
}
