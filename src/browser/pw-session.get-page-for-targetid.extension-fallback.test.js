import { describe, expect, it, vi } from "vitest";
import { closePlaywrightBrowserConnection, getPageForTargetId } from "./pw-session.js";
const connectOverCdpMock = vi.fn();
const getChromeWebSocketUrlMock = vi.fn();
vi.mock("playwright-core", () => ({
  chromium: {
    connectOverCDP: (...args) => connectOverCdpMock(...args),
  },
}));
vi.mock("./chrome.js", () => ({
  getChromeWebSocketUrl: (...args) => getChromeWebSocketUrlMock(...args),
}));
describe("pw-session getPageForTargetId", () => {
  it("falls back to the only page when CDP session attachment is blocked (extension relays)", async () => {
    connectOverCdpMock.mockReset();
    getChromeWebSocketUrlMock.mockReset();
    const pageOn = vi.fn();
    const contextOn = vi.fn();
    const browserOn = vi.fn();
    const browserClose = vi.fn(async () => {});
    const context = {
      pages: () => [],
      on: contextOn,
      newCDPSession: vi.fn(async () => {
        throw new Error("Not allowed");
      }),
    };
    const page = {
      on: pageOn,
      context: () => context,
    };
    context.pages = () => [page];
    const browser = {
      contexts: () => [context],
      on: browserOn,
      close: browserClose,
    };
    connectOverCdpMock.mockResolvedValue(browser);
    getChromeWebSocketUrlMock.mockResolvedValue(null);
    const resolved = await getPageForTargetId({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "NOT_A_TAB",
    });
    expect(resolved).toBe(page);
    await closePlaywrightBrowserConnection();
    expect(browserClose).toHaveBeenCalled();
  });
});
