import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "../infra/device-identity.js";
import { rawDataToString } from "../infra/ws.js";
import { getDeterministicFreePortBlock } from "../test-utils/ports.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { GatewayClient } from "./client.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { startGatewayServer } from "./server.js";
export async function getFreeGatewayPort() {
  return await getDeterministicFreePortBlock({ offsets: [0, 1, 2, 3, 4] });
}
export async function connectGatewayClient(params) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const stop = (err, client) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(client);
      }
    };
    const client = new GatewayClient({
      url: params.url,
      token: params.token,
      connectDelayMs: params.connectDelayMs ?? 0,
      clientName: params.clientName ?? GATEWAY_CLIENT_NAMES.TEST,
      clientDisplayName: params.clientDisplayName ?? "vitest",
      clientVersion: params.clientVersion ?? "dev",
      platform: params.platform,
      mode: params.mode ?? GATEWAY_CLIENT_MODES.TEST,
      role: params.role,
      scopes: params.scopes,
      caps: params.caps,
      commands: params.commands,
      instanceId: params.instanceId,
      deviceIdentity: params.deviceIdentity,
      onEvent: params.onEvent,
      onHelloOk: () => stop(undefined, client),
      onConnectError: (err) => stop(err),
      onClose: (code, reason) =>
        stop(new Error(`gateway closed during connect (${code}): ${reason}`)),
    });
    const timer = setTimeout(
      () => stop(new Error(params.timeoutMessage ?? "gateway connect timeout")),
      params.timeoutMs ?? 1e4,
    );
    timer.unref();
    client.start();
  });
}
export async function connectDeviceAuthReq(params) {
  const ws = new WebSocket(params.url);
  await new Promise((resolve) => ws.once("open", resolve));
  const identity = loadOrCreateDeviceIdentity();
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId: GATEWAY_CLIENT_NAMES.TEST,
    clientMode: GATEWAY_CLIENT_MODES.TEST,
    role: "operator",
    scopes: [],
    signedAtMs,
    token: params.token ?? null,
  });
  const device = {
    id: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    signature: signDevicePayload(identity.privateKeyPem, payload),
    signedAt: signedAtMs,
  };
  ws.send(
    JSON.stringify({
      type: "req",
      id: "c1",
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: GATEWAY_CLIENT_NAMES.TEST,
          displayName: "vitest",
          version: "dev",
          platform: process.platform,
          mode: GATEWAY_CLIENT_MODES.TEST,
        },
        caps: [],
        auth: params.token ? { token: params.token } : undefined,
        device,
      },
    }),
  );
  const res = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 5000);
    const closeHandler = (code, reason) => {
      clearTimeout(timer);
      ws.off("message", handler);
      reject(new Error(`closed ${code}: ${rawDataToString(reason)}`));
    };
    const handler = (data) => {
      const obj = JSON.parse(rawDataToString(data));
      if (obj?.type !== "res" || obj?.id !== "c1") {
        return;
      }
      clearTimeout(timer);
      ws.off("message", handler);
      ws.off("close", closeHandler);
      resolve(obj);
    };
    ws.on("message", handler);
    ws.once("close", closeHandler);
  });
  ws.close();
  return res;
}
export async function startGatewayWithClient(params) {
  await writeFile(params.configPath, `${JSON.stringify(params.cfg, null, 2)}\n`);
  process.env.GENOS_CONFIG_PATH = params.configPath;
  const port = await getFreeGatewayPort();
  const server = await startGatewayServer(port, {
    bind: "loopback",
    auth: { mode: "token", token: params.token },
    controlUiEnabled: false,
  });
  const client = await connectGatewayClient({
    url: `ws://127.0.0.1:${port}`,
    token: params.token,
    clientDisplayName: params.clientDisplayName,
  });
  return { port, server, client };
}
