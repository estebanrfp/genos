let getLatestWs = function () {
  const ws = wsInstances.at(-1);
  if (!ws) {
    throw new Error("missing mock websocket instance");
  }
  return ws;
};
import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
const wsInstances = vi.hoisted(() => []);
const clearDeviceAuthTokenMock = vi.hoisted(() => vi.fn());
const logDebugMock = vi.hoisted(() => vi.fn());

class MockWebSocket {
  openHandlers = [];
  messageHandlers = [];
  closeHandlers = [];
  errorHandlers = [];
  constructor(_url, _options) {
    wsInstances.push(this);
  }
  on(event, handler) {
    switch (event) {
      case "open":
        this.openHandlers.push(handler);
        return;
      case "message":
        this.messageHandlers.push(handler);
        return;
      case "close":
        this.closeHandlers.push(handler);
        return;
      case "error":
        this.errorHandlers.push(handler);
        return;
      default:
        return;
    }
  }
  close(_code, _reason) {}
  emitClose(code, reason) {
    for (const handler of this.closeHandlers) {
      handler(code, Buffer.from(reason));
    }
  }
}
vi.mock("ws", () => ({
  WebSocket: MockWebSocket,
}));
vi.mock("../infra/device-auth-store.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    clearDeviceAuthToken: (...args) => clearDeviceAuthTokenMock(...args),
  };
});
vi.mock("../logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logDebug: (...args) => logDebugMock(...args),
  };
});
const { GatewayClient } = await import("./client.js");
describe("GatewayClient close handling", () => {
  beforeEach(() => {
    wsInstances.length = 0;
    clearDeviceAuthTokenMock.mockReset();
    logDebugMock.mockReset();
  });
  it("clears stale token on device token mismatch close", () => {
    const onClose = vi.fn();
    const identity = {
      deviceId: "dev-1",
      privateKeyPem: "private-key",
      publicKeyPem: "public-key",
    };
    const client = new GatewayClient({
      url: "ws://127.0.0.1:18789",
      deviceIdentity: identity,
      onClose,
    });
    client.start();
    getLatestWs().emitClose(
      1008,
      "unauthorized: DEVICE token mismatch (rotate/reissue device token)",
    );
    expect(clearDeviceAuthTokenMock).toHaveBeenCalledWith({ deviceId: "dev-1", role: "operator" });
    expect(onClose).toHaveBeenCalledWith(
      1008,
      "unauthorized: DEVICE token mismatch (rotate/reissue device token)",
    );
    client.stop();
  });
  it("does not break close flow when token clear throws", () => {
    clearDeviceAuthTokenMock.mockImplementation(() => {
      throw new Error("disk unavailable");
    });
    const onClose = vi.fn();
    const identity = {
      deviceId: "dev-2",
      privateKeyPem: "private-key",
      publicKeyPem: "public-key",
    };
    const client = new GatewayClient({
      url: "ws://127.0.0.1:18789",
      deviceIdentity: identity,
      onClose,
    });
    client.start();
    expect(() => {
      getLatestWs().emitClose(1008, "unauthorized: device token mismatch");
    }).not.toThrow();
    expect(logDebugMock).toHaveBeenCalledWith(
      expect.stringContaining("failed clearing stale device-auth token"),
    );
    expect(onClose).toHaveBeenCalledWith(1008, "unauthorized: device token mismatch");
    client.stop();
  });
});
