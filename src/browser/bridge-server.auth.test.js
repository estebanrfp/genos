let buildResolvedConfig = function () {
  return {
    enabled: true,
    evaluateEnabled: false,
    controlPort: 0,
    cdpProtocol: "http",
    cdpHost: "127.0.0.1",
    cdpIsLoopback: true,
    remoteCdpTimeoutMs: 1500,
    remoteCdpHandshakeTimeoutMs: 3000,
    extraArgs: [],
    color: DEFAULT_GENOS_BROWSER_COLOR,
    executablePath: undefined,
    headless: true,
    noSandbox: false,
    attachOnly: true,
    defaultProfile: DEFAULT_GENOS_BROWSER_PROFILE_NAME,
    profiles: {
      [DEFAULT_GENOS_BROWSER_PROFILE_NAME]: {
        cdpPort: 1,
        color: DEFAULT_GENOS_BROWSER_COLOR,
      },
    },
  };
};
import { afterEach, describe, expect, it } from "vitest";
import { startBrowserBridgeServer, stopBrowserBridgeServer } from "./bridge-server.js";
import { DEFAULT_GENOS_BROWSER_COLOR, DEFAULT_GENOS_BROWSER_PROFILE_NAME } from "./constants.js";
describe("startBrowserBridgeServer auth", () => {
  const servers = [];
  afterEach(async () => {
    while (servers.length) {
      const s = servers.pop();
      if (s) {
        await s.stop();
      }
    }
  });
  it("rejects unauthenticated requests when authToken is set", async () => {
    const bridge = await startBrowserBridgeServer({
      resolved: buildResolvedConfig(),
      authToken: "secret-token",
    });
    servers.push({ stop: () => stopBrowserBridgeServer(bridge.server) });
    const unauth = await fetch(`${bridge.baseUrl}/`);
    expect(unauth.status).toBe(401);
    const authed = await fetch(`${bridge.baseUrl}/`, {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(authed.status).toBe(200);
  });
  it("accepts x-genosos-password when authPassword is set", async () => {
    const bridge = await startBrowserBridgeServer({
      resolved: buildResolvedConfig(),
      authPassword: "secret-password",
    });
    servers.push({ stop: () => stopBrowserBridgeServer(bridge.server) });
    const unauth = await fetch(`${bridge.baseUrl}/`);
    expect(unauth.status).toBe(401);
    const authed = await fetch(`${bridge.baseUrl}/`, {
      headers: { "x-genosos-password": "secret-password" },
    });
    expect(authed.status).toBe(200);
  });
  it("requires auth params", async () => {
    await expect(
      startBrowserBridgeServer({
        resolved: buildResolvedConfig(),
      }),
    ).rejects.toThrow(/requires auth/i);
  });
});
