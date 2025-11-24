let applyGatewaySkipEnv = function () {
  process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER = "1";
  process.env.GENOS_SKIP_GMAIL_WATCHER = "1";
  process.env.GENOS_SKIP_CANVAS_HOST = "1";
  process.env.GENOS_SKIP_CHANNELS = "1";
  process.env.GENOS_SKIP_PROVIDERS = "1";
  process.env.GENOS_SKIP_CRON = "1";
  process.env.GENOS_TEST_MINIMAL_GATEWAY = "1";
  process.env.GENOS_BUNDLED_PLUGINS_DIR = tempHome
    ? path.join(tempHome, "genosos-test-no-bundled-extensions")
    : "genosos-test-no-bundled-extensions";
};
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { WebSocket } from "ws";
import { resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { resetAgentRunContextForTest } from "../infra/agent-events.js";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "../infra/device-identity.js";
import { drainSystemEvents, peekSystemEvents } from "../infra/system-events.js";
import { rawDataToString } from "../infra/ws.js";
import { resetLogger, setLoggerOverride } from "../logging.js";
import { DEFAULT_AGENT_ID, toAgentStoreSessionKey } from "../routing/session-key.js";
import { captureEnv } from "../test-utils/env.js";
import { getDeterministicFreePortBlock } from "../test-utils/ports.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import {
  agentCommand,
  cronIsolatedRun,
  embeddedRunMock,
  piSdkMock,
  sessionStoreSaveDelayMs,
  setTestConfigRoot,
  testIsNixMode,
  testTailscaleWhois,
  testState,
  testTailnetIPv4,
} from "./test-helpers.mocks.js";
let serverModulePromise;
async function getServerModule() {
  serverModulePromise ??= import("./server.js");
  return await serverModulePromise;
}
let previousHome;
let previousUserProfile;
let previousStateDir;
let previousConfigPath;
let previousSkipBrowserControl;
let previousSkipGmailWatcher;
let previousSkipCanvasHost;
let previousBundledPluginsDir;
let previousSkipChannels;
let previousSkipProviders;
let previousSkipCron;
let previousMinimalGateway;
let tempHome;
let tempConfigRoot;
export async function writeSessionStore(params) {
  const storePath = params.storePath ?? testState.sessionStorePath;
  if (!storePath) {
    throw new Error("writeSessionStore requires testState.sessionStorePath");
  }
  const agentId = params.agentId ?? DEFAULT_AGENT_ID;
  const store = {};
  for (const [requestKey, entry] of Object.entries(params.entries)) {
    const rawKey = requestKey.trim();
    const storeKey =
      rawKey === "global" || rawKey === "unknown"
        ? rawKey
        : toAgentStoreSessionKey({
            agentId,
            requestKey,
            mainKey: params.mainKey,
          });
    store[storeKey] = entry;
  }
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf-8");
}
async function setupGatewayTestHome() {
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  previousStateDir = process.env.GENOS_STATE_DIR;
  previousConfigPath = process.env.GENOS_CONFIG_PATH;
  previousSkipBrowserControl = process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER;
  previousSkipGmailWatcher = process.env.GENOS_SKIP_GMAIL_WATCHER;
  previousSkipCanvasHost = process.env.GENOS_SKIP_CANVAS_HOST;
  previousBundledPluginsDir = process.env.GENOS_BUNDLED_PLUGINS_DIR;
  previousSkipChannels = process.env.GENOS_SKIP_CHANNELS;
  previousSkipProviders = process.env.GENOS_SKIP_PROVIDERS;
  previousSkipCron = process.env.GENOS_SKIP_CRON;
  previousMinimalGateway = process.env.GENOS_TEST_MINIMAL_GATEWAY;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-gateway-home-"));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.GENOS_STATE_DIR = path.join(tempHome, ".genosv1");
  delete process.env.GENOS_CONFIG_PATH;
}
async function resetGatewayTestState(options) {
  vi.useRealTimers();
  setLoggerOverride({ level: "silent", consoleLevel: "silent" });
  if (!tempHome) {
    throw new Error("resetGatewayTestState called before temp home was initialized");
  }
  applyGatewaySkipEnv();
  if (options.uniqueConfigRoot) {
    tempConfigRoot = await fs.mkdtemp(path.join(tempHome, "genosos-test-"));
  } else {
    tempConfigRoot = path.join(tempHome, ".genos-test");
    await fs.rm(tempConfigRoot, { recursive: true, force: true });
    await fs.mkdir(tempConfigRoot, { recursive: true });
  }
  setTestConfigRoot(tempConfigRoot);
  sessionStoreSaveDelayMs.value = 0;
  testTailnetIPv4.value = undefined;
  testTailscaleWhois.value = null;
  testState.gatewayBind = undefined;
  testState.gatewayAuth = { mode: "token", token: "test-gateway-token-1234567890" };
  testState.gatewayControlUi = undefined;
  testState.hooksConfig = undefined;
  testState.canvasHostPort = undefined;
  testState.legacyIssues = [];
  testState.legacyParsed = {};
  testState.migrationConfig = null;
  testState.migrationChanges = [];
  testState.cronEnabled = false;
  testState.cronStorePath = undefined;
  testState.sessionConfig = undefined;
  testState.sessionStorePath = undefined;
  testState.agentConfig = undefined;
  testState.agentsConfig = undefined;
  testState.bindingsConfig = undefined;
  testState.channelsConfig = undefined;
  testState.allowFrom = undefined;
  testIsNixMode.value = false;
  cronIsolatedRun.mockClear();
  agentCommand.mockClear();
  embeddedRunMock.activeIds.clear();
  embeddedRunMock.abortCalls = [];
  embeddedRunMock.waitCalls = [];
  embeddedRunMock.waitResults.clear();
  drainSystemEvents(resolveMainSessionKeyFromConfig());
  resetAgentRunContextForTest();
  const mod = await getServerModule();
  mod.__resetModelCatalogCacheForTest();
  piSdkMock.enabled = false;
  piSdkMock.discoverCalls = 0;
  piSdkMock.models = [];
}
async function cleanupGatewayTestHome(options) {
  vi.useRealTimers();
  resetLogger();
  if (options.restoreEnv) {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    if (previousStateDir === undefined) {
      delete process.env.GENOS_STATE_DIR;
    } else {
      process.env.GENOS_STATE_DIR = previousStateDir;
    }
    if (previousConfigPath === undefined) {
      delete process.env.GENOS_CONFIG_PATH;
    } else {
      process.env.GENOS_CONFIG_PATH = previousConfigPath;
    }
    if (previousSkipBrowserControl === undefined) {
      delete process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER;
    } else {
      process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER = previousSkipBrowserControl;
    }
    if (previousSkipGmailWatcher === undefined) {
      delete process.env.GENOS_SKIP_GMAIL_WATCHER;
    } else {
      process.env.GENOS_SKIP_GMAIL_WATCHER = previousSkipGmailWatcher;
    }
    if (previousSkipCanvasHost === undefined) {
      delete process.env.GENOS_SKIP_CANVAS_HOST;
    } else {
      process.env.GENOS_SKIP_CANVAS_HOST = previousSkipCanvasHost;
    }
    if (previousBundledPluginsDir === undefined) {
      delete process.env.GENOS_BUNDLED_PLUGINS_DIR;
    } else {
      process.env.GENOS_BUNDLED_PLUGINS_DIR = previousBundledPluginsDir;
    }
    if (previousSkipChannels === undefined) {
      delete process.env.GENOS_SKIP_CHANNELS;
    } else {
      process.env.GENOS_SKIP_CHANNELS = previousSkipChannels;
    }
    if (previousSkipProviders === undefined) {
      delete process.env.GENOS_SKIP_PROVIDERS;
    } else {
      process.env.GENOS_SKIP_PROVIDERS = previousSkipProviders;
    }
    if (previousSkipCron === undefined) {
      delete process.env.GENOS_SKIP_CRON;
    } else {
      process.env.GENOS_SKIP_CRON = previousSkipCron;
    }
    if (previousMinimalGateway === undefined) {
      delete process.env.GENOS_TEST_MINIMAL_GATEWAY;
    } else {
      process.env.GENOS_TEST_MINIMAL_GATEWAY = previousMinimalGateway;
    }
  }
  if (options.restoreEnv && tempHome) {
    await fs.rm(tempHome, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 25,
    });
    tempHome = undefined;
  }
  tempConfigRoot = undefined;
}
export function installGatewayTestHooks(options) {
  const scope = options?.scope ?? "test";
  if (scope === "suite") {
    beforeAll(async () => {
      await setupGatewayTestHome();
      await resetGatewayTestState({ uniqueConfigRoot: true });
    });
    beforeEach(async () => {
      await resetGatewayTestState({ uniqueConfigRoot: true });
    }, 60000);
    afterEach(async () => {
      await cleanupGatewayTestHome({ restoreEnv: false });
    });
    afterAll(async () => {
      await cleanupGatewayTestHome({ restoreEnv: true });
    });
    return;
  }
  beforeEach(async () => {
    await setupGatewayTestHome();
    await resetGatewayTestState({ uniqueConfigRoot: false });
  }, 60000);
  afterEach(async () => {
    await cleanupGatewayTestHome({ restoreEnv: true });
  });
}
export async function getFreePort() {
  return await getDeterministicFreePortBlock({ offsets: [0, 1, 2, 3, 4] });
}
export async function occupyPort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}
export function onceMessage(ws, filter, timeoutMs = 1e4) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const closeHandler = (code, reason) => {
      clearTimeout(timer);
      ws.off("message", handler);
      reject(new Error(`closed ${code}: ${reason.toString()}`));
    };
    const handler = (data) => {
      const obj = JSON.parse(rawDataToString(data));
      if (filter(obj)) {
        clearTimeout(timer);
        ws.off("message", handler);
        ws.off("close", closeHandler);
        resolve(obj);
      }
    };
    ws.on("message", handler);
    ws.once("close", closeHandler);
  });
}
export async function startGatewayServer(port, opts) {
  const mod = await getServerModule();
  const resolvedOpts =
    opts?.controlUiEnabled === undefined ? { ...opts, controlUiEnabled: false } : opts;
  return await mod.startGatewayServer(port, resolvedOpts);
}
async function startGatewayServerWithRetries(params) {
  let port = params.port;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return {
        port,
        server: await startGatewayServer(port, params.opts),
      };
    } catch (err) {
      const code = err.cause?.code;
      if (code !== "EADDRINUSE") {
        throw err;
      }
      port = await getFreePort();
    }
  }
  throw new Error("failed to start gateway server after retries");
}
export async function withGatewayServer(fn, opts) {
  const started = await startGatewayServerWithRetries({
    port: opts?.port ?? (await getFreePort()),
    opts: opts?.serverOptions,
  });
  try {
    return await fn({ port: started.port, server: started.server });
  } finally {
    await started.server.close();
  }
}
export async function startServerWithClient(token, opts) {
  const { wsHeaders, ...gatewayOpts } = opts ?? {};
  let port = await getFreePort();
  const envSnapshot = captureEnv(["GENOS_GATEWAY_TOKEN"]);
  const prev = process.env.GENOS_GATEWAY_TOKEN;
  if (typeof token === "string") {
    testState.gatewayAuth = { mode: "token", token };
  }
  const fallbackToken =
    token ??
    (typeof testState.gatewayAuth?.token === "string" ? testState.gatewayAuth.token : undefined);
  if (fallbackToken === undefined) {
    delete process.env.GENOS_GATEWAY_TOKEN;
  } else {
    process.env.GENOS_GATEWAY_TOKEN = fallbackToken;
  }
  const started = await startGatewayServerWithRetries({ port, opts: gatewayOpts });
  port = started.port;
  const server = started.server;
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}`,
    wsHeaders ? { headers: wsHeaders } : undefined,
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ws open")), 1e4);
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onClose = (code, reason) => {
      cleanup();
      reject(new Error(`closed ${code}: ${reason.toString()}`));
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
  return { server, ws, port, prevToken: prev, envSnapshot };
}
export async function connectReq(ws, opts) {
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  const client = opts?.client ?? {
    id: GATEWAY_CLIENT_NAMES.TEST,
    version: "1.0.0",
    platform: "test",
    mode: GATEWAY_CLIENT_MODES.TEST,
  };
  const role = opts?.role ?? "operator";
  const defaultToken =
    opts?.skipDefaultAuth === true
      ? undefined
      : typeof testState.gatewayAuth?.token === "string"
        ? (testState.gatewayAuth.token ?? undefined)
        : process.env.GENOS_GATEWAY_TOKEN;
  const defaultPassword =
    opts?.skipDefaultAuth === true
      ? undefined
      : typeof testState.gatewayAuth?.password === "string"
        ? (testState.gatewayAuth.password ?? undefined)
        : process.env.GENOS_GATEWAY_PASSWORD;
  const token = opts?.token ?? defaultToken;
  const password = opts?.password ?? defaultPassword;
  const requestedScopes = Array.isArray(opts?.scopes)
    ? opts.scopes
    : role === "operator"
      ? ["operator.admin"]
      : [];
  const device = (() => {
    if (opts?.device === null) {
      return;
    }
    if (opts?.device) {
      return opts.device;
    }
    const identity = loadOrCreateDeviceIdentity();
    const signedAtMs = Date.now();
    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: client.id,
      clientMode: client.mode,
      role,
      scopes: requestedScopes,
      signedAtMs,
      token: token ?? null,
    });
    return {
      id: identity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      signature: signDevicePayload(identity.privateKeyPem, payload),
      signedAt: signedAtMs,
      nonce: opts?.device?.nonce,
    };
  })();
  ws.send(
    JSON.stringify({
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: opts?.minProtocol ?? PROTOCOL_VERSION,
        maxProtocol: opts?.maxProtocol ?? PROTOCOL_VERSION,
        client,
        caps: opts?.caps ?? [],
        commands: opts?.commands ?? [],
        permissions: opts?.permissions ?? undefined,
        role,
        scopes: requestedScopes,
        auth:
          token || password
            ? {
                token,
                password,
              }
            : undefined,
        device,
      },
    }),
  );
  const isResponseForId = (o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      return false;
    }
    const rec = o;
    return rec.type === "res" && rec.id === id;
  };
  return await onceMessage(ws, isResponseForId);
}
export async function connectOk(ws, opts) {
  const res = await connectReq(ws, opts);
  expect(res.ok).toBe(true);
  expect(res.payload?.type).toBe("hello-ok");
  return res.payload;
}
export async function rpcReq(ws, method, params, timeoutMs) {
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return await onceMessage(
    ws,
    (o) => {
      if (!o || typeof o !== "object" || Array.isArray(o)) {
        return false;
      }
      const rec = o;
      return rec.type === "res" && rec.id === id;
    },
    timeoutMs,
  );
}
export async function waitForSystemEvent(timeoutMs = 2000) {
  const sessionKey = resolveMainSessionKeyFromConfig();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = peekSystemEvents(sessionKey);
    if (events.length > 0) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timeout waiting for system event");
}
