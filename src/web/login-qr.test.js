import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./session.js", () => {
  const createWaSocket = vi.fn(async (_printQr, _verbose, opts) => {
    const sock = { ws: { close: vi.fn() } };
    if (opts?.onQr) {
      setImmediate(() => opts.onQr?.("qr-data"));
    }
    return sock;
  });
  const waitForWaConnection = vi.fn();
  const formatError = vi.fn((err) => `formatted:${String(err)}`);
  const getStatusCode = vi.fn(
    (err) => err?.output?.statusCode ?? err?.error?.output?.statusCode ?? err?.status,
  );
  const webAuthExists = vi.fn(async () => false);
  const readWebSelfId = vi.fn(() => ({ e164: null, jid: null }));
  const logoutWeb = vi.fn(async () => true);
  const flushCredsSaveQueue = vi.fn(async () => {});
  return {
    createWaSocket,
    waitForWaConnection,
    flushCredsSaveQueue,
    formatError,
    getStatusCode,
    webAuthExists,
    readWebSelfId,
    logoutWeb,
  };
});
vi.mock("./qr-image.js", () => ({
  renderQrPngBase64: vi.fn(async () => "base64"),
}));
const { startWebLoginWithQr, waitForWebLogin } = await import("./login-qr.js");
const { createWaSocket, waitForWaConnection, logoutWeb } = await import("./session.js");
const createWaSocketMock = vi.mocked(createWaSocket);
const waitForWaConnectionMock = vi.mocked(waitForWaConnection);
const logoutWebMock = vi.mocked(logoutWeb);
describe("login-qr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("restarts login once on status 515 and completes", async () => {
    waitForWaConnectionMock
      .mockRejectedValueOnce({ error: { output: { statusCode: 515 } } })
      .mockResolvedValueOnce(undefined);
    const start = await startWebLoginWithQr({ timeoutMs: 5000 });
    expect(start.qrDataUrl).toBe("data:image/png;base64,base64");
    const result = await waitForWebLogin({ timeoutMs: 5000 });
    expect(result.connected).toBe(true);
    expect(createWaSocketMock).toHaveBeenCalledTimes(2);
    expect(logoutWebMock).not.toHaveBeenCalled();
  });
});
