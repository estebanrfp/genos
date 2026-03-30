let restoreGatewayToken = function (prevToken) {
    if (prevToken === undefined) {
      delete process.env.GENOS_GATEWAY_TOKEN;
    } else {
      process.env.GENOS_GATEWAY_TOKEN = prevToken;
    }
  },
  resolveGatewayTokenOrEnv = function () {
    const token =
      typeof testState.gatewayAuth?.token === "string"
        ? (testState.gatewayAuth.token ?? undefined)
        : process.env.GENOS_GATEWAY_TOKEN;
    expect(typeof token).toBe("string");
    return String(token ?? "");
  },
  isConnectResMessage = function (id) {
    return (o) => {
      if (!o || typeof o !== "object" || Array.isArray(o)) {
        return false;
      }
      const rec = o;
      return rec.type === "res" && rec.id === id;
    };
  };
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { withEnvAsync } from "../test-utils/env.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { getHandshakeTimeoutMs } from "./server-constants.js";
import {
  connectReq,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startGatewayServer,
  startServerWithClient,
  testTailscaleWhois,
  testState,
  withGatewayServer,
} from "./test-helpers.js";
installGatewayTestHooks({ scope: "suite" });
async function waitForWsClose(ws, timeoutMs) {
  if (ws.readyState === WebSocket.CLOSED) {
    return true;
  }
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(ws.readyState === WebSocket.CLOSED), timeoutMs);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
const openWs = async (port, headers) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, headers ? { headers } : undefined);
  await new Promise((resolve) => ws.once("open", resolve));
  return ws;
};
const openTailscaleWs = async (port) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: {
      origin: "https://gateway.tailnet.ts.net",
      "x-forwarded-for": "100.64.0.1",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "gateway.tailnet.ts.net",
      "tailscale-user-login": "peter",
      "tailscale-user-name": "Peter",
    },
  });
  await new Promise((resolve) => ws.once("open", resolve));
  return ws;
};
const originForPort = (port) => `http://127.0.0.1:${port}`;
async function withRuntimeVersionEnv(env, run) {
  return withEnvAsync(env, run);
}
const TEST_OPERATOR_CLIENT = {
  id: GATEWAY_CLIENT_NAMES.TEST,
  version: "1.0.0",
  platform: "test",
  mode: GATEWAY_CLIENT_MODES.TEST,
};
const CONTROL_UI_CLIENT = {
  id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
  version: "1.0.0",
  platform: "web",
  mode: GATEWAY_CLIENT_MODES.WEBCHAT,
};
async function expectHelloOkServerVersion(port, expectedVersion) {
  const ws = await openWs(port);
  try {
    const res = await connectReq(ws);
    expect(res.ok).toBe(true);
    const payload = res.payload;
    expect(payload?.type).toBe("hello-ok");
    expect(payload?.server?.version).toBe(expectedVersion);
  } finally {
    ws.close();
  }
}
async function expectMissingScopeAfterConnect(port, opts) {
  const ws = await openWs(port);
  try {
    const res = await connectReq(ws, opts);
    expect(res.ok).toBe(true);
    const health = await rpcReq(ws, "health");
    expect(health.ok).toBe(false);
    expect(health.error?.message).toContain("missing scope");
  } finally {
    ws.close();
  }
}
async function createSignedDevice(params) {
  const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem, signDevicePayload } =
    await import("../infra/device-identity.js");
  const identity = params.identityPath
    ? loadOrCreateDeviceIdentity(params.identityPath)
    : loadOrCreateDeviceIdentity();
  const signedAtMs = params.signedAtMs ?? Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: "operator",
    scopes: params.scopes,
    signedAtMs,
    token: params.token,
    nonce: params.nonce,
  });
  return {
    identity,
    signedAtMs,
    device: {
      id: identity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      signature: signDevicePayload(identity.privateKeyPem, payload),
      signedAt: signedAtMs,
      nonce: params.nonce,
    },
  };
}
async function approvePendingPairingIfNeeded() {
  const { approveDevicePairing, listDevicePairing } = await import("../infra/device-pairing.js");
  const list = await listDevicePairing();
  const pending = list.pending.at(0);
  expect(pending?.requestId).toBeDefined();
  if (pending?.requestId) {
    await approveDevicePairing(pending.requestId);
  }
}
async function sendRawConnectReq(ws, params) {
  ws.send(
    JSON.stringify({
      type: "req",
      id: params.id,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: TEST_OPERATOR_CLIENT,
        caps: [],
        role: "operator",
        auth: params.token ? { token: params.token } : undefined,
        device: params.device,
      },
    }),
  );
  return onceMessage(ws, isConnectResMessage(params.id));
}
async function startRateLimitedTokenServerWithPairedDeviceToken() {
  const { loadOrCreateDeviceIdentity } = await import("../infra/device-identity.js");
  const { getPairedDevice } = await import("../infra/device-pairing.js");
  testState.gatewayAuth = {
    mode: "token",
    token: "secret",
    rateLimit: { maxAttempts: 1, windowMs: 60000, lockoutMs: 60000, exemptLoopback: false },
  };
  const { server, ws, port, prevToken } = await startServerWithClient();
  try {
    const initial = await connectReq(ws, { token: "secret" });
    if (!initial.ok) {
      await approvePendingPairingIfNeeded();
    }
    const identity = loadOrCreateDeviceIdentity();
    const paired = await getPairedDevice(identity.deviceId);
    const deviceToken = paired?.tokens?.operator?.token;
    expect(deviceToken).toBeDefined();
    ws.close();
    return { server, port, prevToken, deviceToken: String(deviceToken ?? "") };
  } catch (err) {
    ws.close();
    await server.close();
    restoreGatewayToken(prevToken);
    throw err;
  }
}
async function ensurePairedDeviceTokenForCurrentIdentity(ws) {
  const { loadOrCreateDeviceIdentity } = await import("../infra/device-identity.js");
  const { getPairedDevice } = await import("../infra/device-pairing.js");
  const res = await connectReq(ws, { token: "secret" });
  if (!res.ok) {
    await approvePendingPairingIfNeeded();
  }
  const identity = loadOrCreateDeviceIdentity();
  const paired = await getPairedDevice(identity.deviceId);
  const deviceToken = paired?.tokens?.operator?.token;
  expect(deviceToken).toBeDefined();
  return { identity: { deviceId: identity.deviceId }, deviceToken: String(deviceToken ?? "") };
}
describe("gateway server auth/connect", () => {
  describe("default auth (token)", () => {
    let server;
    let port;
    beforeAll(async () => {
      port = await getFreePort();
      server = await startGatewayServer(port);
    });
    afterAll(async () => {
      await server.close();
    });
    test("closes silent handshakes after timeout", { timeout: 60000 }, async () => {
      vi.useRealTimers();
      const prevHandshakeTimeout = process.env.GENOS_TEST_HANDSHAKE_TIMEOUT_MS;
      process.env.GENOS_TEST_HANDSHAKE_TIMEOUT_MS = "50";
      try {
        const ws = await openWs(port);
        const handshakeTimeoutMs = getHandshakeTimeoutMs();
        const closed = await waitForWsClose(ws, handshakeTimeoutMs + 250);
        expect(closed).toBe(true);
      } finally {
        if (prevHandshakeTimeout === undefined) {
          delete process.env.GENOS_TEST_HANDSHAKE_TIMEOUT_MS;
        } else {
          process.env.GENOS_TEST_HANDSHAKE_TIMEOUT_MS = prevHandshakeTimeout;
        }
      }
    });
    test("connect (req) handshake returns hello-ok payload", async () => {
      const { CONFIG_PATH, STATE_DIR } = await import("../config/config.js");
      const ws = await openWs(port);
      const res = await connectReq(ws);
      expect(res.ok).toBe(true);
      const payload = res.payload;
      expect(payload?.type).toBe("hello-ok");
      expect(payload?.snapshot?.configPath).toBe(CONFIG_PATH);
      expect(payload?.snapshot?.stateDir).toBe(STATE_DIR);
      ws.close();
    });
    test("connect (req) handshake prefers service version fallback in hello-ok payload", async () => {
      await withRuntimeVersionEnv(
        {
          GENOS_VERSION: " ",
          GENOS_SERVICE_VERSION: "2.4.6-service",
          npm_package_version: "1.0.0-package",
        },
        async () => expectHelloOkServerVersion(port, "2.4.6-service"),
      );
    });
    test("connect (req) handshake prefers GENOS_VERSION over service version", async () => {
      await withRuntimeVersionEnv(
        {
          GENOS_VERSION: "9.9.9-cli",
          GENOS_SERVICE_VERSION: "2.4.6-service",
          npm_package_version: "1.0.0-package",
        },
        async () => expectHelloOkServerVersion(port, "9.9.9-cli"),
      );
    });
    test("connect (req) handshake falls back to npm_package_version when higher-precedence env values are blank", async () => {
      await withRuntimeVersionEnv(
        {
          GENOS_VERSION: " ",
          GENOS_SERVICE_VERSION: "\t",
          npm_package_version: "1.0.0-package",
        },
        async () => expectHelloOkServerVersion(port, "1.0.0-package"),
      );
    });
    test("does not grant admin when scopes are empty", async () => {
      await expectMissingScopeAfterConnect(port, { scopes: [] });
    });
    test("ignores requested scopes when device identity is omitted", async () => {
      await expectMissingScopeAfterConnect(port, { device: null });
    });
    test("does not grant admin when scopes are omitted", async () => {
      const ws = await openWs(port);
      const token = resolveGatewayTokenOrEnv();
      const { randomUUID } = await import("node:crypto");
      const os = await import("node:os");
      const path = await import("node:path");
      const { identity, device } = await createSignedDevice({
        token,
        scopes: [],
        clientId: GATEWAY_CLIENT_NAMES.TEST,
        clientMode: GATEWAY_CLIENT_MODES.TEST,
        identityPath: path.join(os.tmpdir(), `genosos-test-device-${randomUUID()}.json`),
      });
      const connectRes = await sendRawConnectReq(ws, {
        id: "c-no-scopes",
        token,
        device,
      });
      expect(connectRes.ok).toBe(true);
      const helloOk = connectRes.payload;
      const presence = helloOk?.snapshot?.presence;
      expect(Array.isArray(presence)).toBe(true);
      const mine = presence?.find((entry) => entry.deviceId === identity.deviceId);
      expect(mine).toBeTruthy();
      const presenceScopes = Array.isArray(mine?.scopes) ? mine?.scopes : [];
      expect(presenceScopes).toEqual([]);
      expect(presenceScopes).not.toContain("operator.admin");
      const health = await rpcReq(ws, "health");
      expect(health.ok).toBe(false);
      expect(health.error?.message).toContain("missing scope");
      ws.close();
    });
    test("rejects device signature when scopes are omitted but signed with admin", async () => {
      const ws = await openWs(port);
      const token = resolveGatewayTokenOrEnv();
      const { device } = await createSignedDevice({
        token,
        scopes: ["operator.admin"],
        clientId: GATEWAY_CLIENT_NAMES.TEST,
        clientMode: GATEWAY_CLIENT_MODES.TEST,
      });
      const connectRes = await sendRawConnectReq(ws, {
        id: "c-no-scopes-signed-admin",
        token,
        device,
      });
      expect(connectRes.ok).toBe(false);
      expect(connectRes.error?.message ?? "").toContain("device signature invalid");
      await new Promise((resolve) => ws.once("close", () => resolve()));
    });
    test("sends connect challenge on open", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const evtPromise = onceMessage(
        ws,
        (o) => o.type === "event" && o.event === "connect.challenge",
      );
      await new Promise((resolve) => ws.once("open", resolve));
      const evt = await evtPromise;
      const nonce = evt.payload?.nonce;
      expect(typeof nonce).toBe("string");
      ws.close();
    });
    test("rejects protocol mismatch", async () => {
      const ws = await openWs(port);
      try {
        const res = await connectReq(ws, {
          minProtocol: PROTOCOL_VERSION + 1,
          maxProtocol: PROTOCOL_VERSION + 2,
        });
        expect(res.ok).toBe(false);
      } catch {}
      ws.close();
    });
    test("rejects non-connect first request", async () => {
      const ws = await openWs(port);
      ws.send(JSON.stringify({ type: "req", id: "h1", method: "health" }));
      const res = await onceMessage(ws, (o) => o.type === "res" && o.id === "h1");
      expect(res.ok).toBe(false);
      await new Promise((resolve) => ws.once("close", () => resolve()));
    });
    test("requires nonce when host is non-local", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { host: "example.com" },
      });
      await new Promise((resolve) => ws.once("open", resolve));
      const res = await connectReq(ws);
      expect(res.ok).toBe(false);
      expect(res.error?.message).toBe("device nonce required");
      await new Promise((resolve) => ws.once("close", () => resolve()));
    });
    test(
      "invalid connect params surface in response and close reason",
      { timeout: 60000 },
      async () => {
        const ws = await openWs(port);
        const closeInfoPromise = new Promise((resolve) => {
          ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
        });
        ws.send(
          JSON.stringify({
            type: "req",
            id: "h-bad",
            method: "connect",
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: "bad-client",
                version: "dev",
                platform: "web",
                mode: "webchat",
              },
              device: {
                id: 123,
                publicKey: "bad",
                signature: "bad",
                signedAt: "bad",
              },
            },
          }),
        );
        const res = await onceMessage(ws, (o) => o.type === "res" && o.id === "h-bad");
        expect(res.ok).toBe(false);
        expect(String(res.error?.message ?? "")).toContain("invalid connect params");
        const closeInfo = await closeInfoPromise;
        expect(closeInfo.code).toBe(1008);
        expect(closeInfo.reason).toContain("invalid connect params");
      },
    );
  });
  describe("password auth", () => {
    let server;
    let port;
    beforeAll(async () => {
      testState.gatewayAuth = { mode: "password", password: "secret" };
      port = await getFreePort();
      server = await startGatewayServer(port);
    });
    afterAll(async () => {
      await server.close();
    });
    test("accepts password auth when configured", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { password: "secret" });
      expect(res.ok).toBe(true);
      ws.close();
    });
    test("rejects invalid password", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { password: "wrong" });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unauthorized");
      ws.close();
    });
  });
  describe("token auth", () => {
    let server;
    let port;
    let prevToken;
    beforeAll(async () => {
      prevToken = process.env.GENOS_GATEWAY_TOKEN;
      process.env.GENOS_GATEWAY_TOKEN = "secret";
      port = await getFreePort();
      server = await startGatewayServer(port);
    });
    afterAll(async () => {
      await server.close();
      if (prevToken === undefined) {
        delete process.env.GENOS_GATEWAY_TOKEN;
      } else {
        process.env.GENOS_GATEWAY_TOKEN = prevToken;
      }
    });
    test("rejects invalid token", async () => {
      const ws = await openWs(port);
      const res = await connectReq(ws, { token: "wrong" });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("unauthorized");
      ws.close();
    });
    test("returns control ui hint when token is missing", async () => {
      const ws = await openWs(port, { origin: originForPort(port) });
      const res = await connectReq(ws, {
        skipDefaultAuth: true,
        client: {
          ...CONTROL_UI_CLIENT,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("Control UI settings");
      ws.close();
    });
    test("rejects control ui without device identity by default", async () => {
      const ws = await openWs(port, { origin: originForPort(port) });
      const res = await connectReq(ws, {
        token: "secret",
        device: null,
        client: {
          ...CONTROL_UI_CLIENT,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("secure context");
      ws.close();
    });
  });
  describe("tailscale auth", () => {
    let server;
    let port;
    beforeAll(async () => {
      testState.gatewayAuth = { mode: "token", token: "secret", allowTailscale: true };
      port = await getFreePort();
      server = await startGatewayServer(port);
    });
    afterAll(async () => {
      await server.close();
    });
    beforeEach(() => {
      testTailscaleWhois.value = { login: "peter", name: "Peter" };
    });
    afterEach(() => {
      testTailscaleWhois.value = null;
    });
    test("requires device identity when only tailscale auth is available", async () => {
      const ws = await openTailscaleWs(port);
      const res = await connectReq(ws, { token: "dummy", device: null });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("device identity required");
      ws.close();
    });
    test("allows shared token to skip device when tailscale auth is enabled", async () => {
      const ws = await openTailscaleWs(port);
      const res = await connectReq(ws, { token: "secret", device: null });
      expect(res.ok).toBe(true);
      const health = await rpcReq(ws, "health");
      expect(health.ok).toBe(false);
      expect(health.error?.message).toContain("missing scope");
      ws.close();
    });
  });
  test("allows control ui without device identity when insecure auth is enabled", async () => {
    testState.gatewayControlUi = { allowInsecureAuth: true };
    const { server, ws, prevToken } = await startServerWithClient("secret", {
      wsHeaders: { origin: "http://127.0.0.1" },
    });
    const res = await connectReq(ws, {
      token: "secret",
      device: null,
      client: {
        id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
        version: "1.0.0",
        platform: "web",
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      },
    });
    expect(res.ok).toBe(true);
    ws.close();
    await server.close();
    restoreGatewayToken(prevToken);
  });
  test("allows control ui with device identity when insecure auth is enabled", async () => {
    testState.gatewayControlUi = { allowInsecureAuth: true };
    testState.gatewayAuth = { mode: "token", token: "secret" };
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        trustedProxies: ["127.0.0.1"],
      },
    });
    const prevToken = process.env.GENOS_GATEWAY_TOKEN;
    process.env.GENOS_GATEWAY_TOKEN = "secret";
    try {
      await withGatewayServer(async ({ port }) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
          headers: {
            origin: "https://localhost",
            "x-forwarded-for": "203.0.113.10",
          },
        });
        const challengePromise = onceMessage(
          ws,
          (o) => o.type === "event" && o.event === "connect.challenge",
        );
        await new Promise((resolve) => ws.once("open", resolve));
        const challenge = await challengePromise;
        const nonce = challenge.payload?.nonce;
        expect(typeof nonce).toBe("string");
        const scopes = ["operator.admin", "operator.approvals", "operator.pairing"];
        const { device } = await createSignedDevice({
          token: "secret",
          scopes,
          clientId: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          clientMode: GATEWAY_CLIENT_MODES.WEBCHAT,
          nonce: String(nonce),
        });
        const res = await connectReq(ws, {
          token: "secret",
          scopes,
          device,
          client: {
            ...CONTROL_UI_CLIENT,
          },
        });
        expect(res.ok).toBe(true);
        ws.close();
      });
    } finally {
      restoreGatewayToken(prevToken);
    }
  });
  test("allows control ui with stale device identity when device auth is disabled", async () => {
    testState.gatewayControlUi = { dangerouslyDisableDeviceAuth: true };
    testState.gatewayAuth = { mode: "token", token: "secret" };
    const prevToken = process.env.GENOS_GATEWAY_TOKEN;
    process.env.GENOS_GATEWAY_TOKEN = "secret";
    try {
      await withGatewayServer(async ({ port }) => {
        const ws = await openWs(port, { origin: originForPort(port) });
        const { device } = await createSignedDevice({
          token: "secret",
          scopes: [],
          clientId: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          clientMode: GATEWAY_CLIENT_MODES.WEBCHAT,
          signedAtMs: Date.now() - 3600000,
        });
        const res = await connectReq(ws, {
          token: "secret",
          scopes: ["operator.read"],
          device,
          client: {
            ...CONTROL_UI_CLIENT,
          },
        });
        expect(res.ok).toBe(true);
        expect(res.payload?.auth).toBeUndefined();
        const health = await rpcReq(ws, "health");
        expect(health.ok).toBe(true);
        ws.close();
      });
    } finally {
      restoreGatewayToken(prevToken);
    }
  });
  test("accepts device token auth for paired device", async () => {
    const { server, ws, port, prevToken } = await startServerWithClient("secret");
    const { deviceToken } = await ensurePairedDeviceTokenForCurrentIdentity(ws);
    ws.close();
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws2.once("open", resolve));
    const res2 = await connectReq(ws2, { token: deviceToken });
    expect(res2.ok).toBe(true);
    ws2.close();
    await server.close();
    restoreGatewayToken(prevToken);
  });
  test("keeps shared-secret lockout separate from device-token auth", async () => {
    const { server, port, prevToken, deviceToken } =
      await startRateLimitedTokenServerWithPairedDeviceToken();
    try {
      const wsBadShared = await openWs(port);
      const badShared = await connectReq(wsBadShared, { token: "wrong", device: null });
      expect(badShared.ok).toBe(false);
      wsBadShared.close();
      const wsSharedLocked = await openWs(port);
      const sharedLocked = await connectReq(wsSharedLocked, { token: "secret", device: null });
      expect(sharedLocked.ok).toBe(false);
      expect(sharedLocked.error?.message ?? "").toContain("retry later");
      wsSharedLocked.close();
      const wsDevice = await openWs(port);
      const deviceOk = await connectReq(wsDevice, { token: deviceToken });
      expect(deviceOk.ok).toBe(true);
      wsDevice.close();
    } finally {
      await server.close();
      restoreGatewayToken(prevToken);
    }
  });
  test("keeps device-token lockout separate from shared-secret auth", async () => {
    const { server, port, prevToken, deviceToken } =
      await startRateLimitedTokenServerWithPairedDeviceToken();
    try {
      const wsBadDevice = await openWs(port);
      const badDevice = await connectReq(wsBadDevice, { token: "wrong" });
      expect(badDevice.ok).toBe(false);
      wsBadDevice.close();
      const wsDeviceLocked = await openWs(port);
      const deviceLocked = await connectReq(wsDeviceLocked, { token: "wrong" });
      expect(deviceLocked.ok).toBe(false);
      expect(deviceLocked.error?.message ?? "").toContain("retry later");
      wsDeviceLocked.close();
      const wsShared = await openWs(port);
      const sharedOk = await connectReq(wsShared, { token: "secret", device: null });
      expect(sharedOk.ok).toBe(true);
      wsShared.close();
      const wsDeviceReal = await openWs(port);
      const deviceStillLocked = await connectReq(wsDeviceReal, { token: deviceToken });
      expect(deviceStillLocked.ok).toBe(false);
      expect(deviceStillLocked.error?.message ?? "").toContain("retry later");
      wsDeviceReal.close();
    } finally {
      await server.close();
      restoreGatewayToken(prevToken);
    }
  });
  test("requires pairing for scope upgrades", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { buildDeviceAuthPayload } = await import("./device-auth.js");
    const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem, signDevicePayload } =
      await import("../infra/device-identity.js");
    const { getPairedDevice } = await import("../infra/device-pairing.js");
    const { server, ws, port, prevToken } = await startServerWithClient("secret");
    const identityDir = await mkdtemp(join(tmpdir(), "genosos-device-scope-"));
    const identity = loadOrCreateDeviceIdentity(join(identityDir, "device.json"));
    const client = {
      id: GATEWAY_CLIENT_NAMES.TEST,
      version: "1.0.0",
      platform: "test",
      mode: GATEWAY_CLIENT_MODES.TEST,
    };
    const buildDevice = (scopes) => {
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId: client.id,
        clientMode: client.mode,
        role: "operator",
        scopes,
        signedAtMs,
        token: "secret",
      });
      return {
        id: identity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
        signature: signDevicePayload(identity.privateKeyPem, payload),
        signedAt: signedAtMs,
      };
    };
    const initial = await connectReq(ws, {
      token: "secret",
      scopes: ["operator.read"],
      client,
      device: buildDevice(["operator.read"]),
    });
    if (!initial.ok) {
      await approvePendingPairingIfNeeded();
    }
    let paired = await getPairedDevice(identity.deviceId);
    expect(paired?.scopes).toContain("operator.read");
    ws.close();
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws2.once("open", resolve));
    const res = await connectReq(ws2, {
      token: "secret",
      scopes: ["operator.admin"],
      client,
      device: buildDevice(["operator.admin"]),
    });
    expect(res.ok).toBe(true);
    paired = await getPairedDevice(identity.deviceId);
    expect(paired?.scopes).toContain("operator.admin");
    ws2.close();
    await server.close();
    restoreGatewayToken(prevToken);
  });
  test("rejects revoked device token", async () => {
    const { revokeDeviceToken } = await import("../infra/device-pairing.js");
    const { server, ws, port, prevToken } = await startServerWithClient("secret");
    const { identity, deviceToken } = await ensurePairedDeviceTokenForCurrentIdentity(ws);
    await revokeDeviceToken({ deviceId: identity.deviceId, role: "operator" });
    ws.close();
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws2.once("open", resolve));
    const res2 = await connectReq(ws2, { token: deviceToken });
    expect(res2.ok).toBe(false);
    ws2.close();
    await server.close();
    if (prevToken === undefined) {
      delete process.env.GENOS_GATEWAY_TOKEN;
    } else {
      process.env.GENOS_GATEWAY_TOKEN = prevToken;
    }
  });
});
