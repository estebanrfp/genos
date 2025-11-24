let connectReq = function (ws, params) {
  const id = `c-${Math.random().toString(16).slice(2)}`;
  ws.send(
    JSON.stringify({
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: params.clientId,
          version: "dev",
          platform: params.platform,
          mode: "node",
        },
        auth: {
          token: params.token,
          password: params.password,
        },
        role: "node",
        scopes: [],
        caps: ["canvas"],
        commands: ["system.notify"],
        permissions: {},
      },
    }),
  );
  return onceMessage(ws, (o) => o.type === "res" && o.id === id);
};
import { afterAll, beforeAll, test } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { getFreePort, onceMessage, startGatewayServer } from "./test-helpers.server.js";
let server;
let port = 0;
let previousToken;
beforeAll(async () => {
  previousToken = process.env.GENOS_GATEWAY_TOKEN;
  process.env.GENOS_GATEWAY_TOKEN = "test-gateway-token-1234567890";
  port = await getFreePort();
  server = await startGatewayServer(port);
});
afterAll(async () => {
  await server?.close();
  if (previousToken === undefined) {
    delete process.env.GENOS_GATEWAY_TOKEN;
  } else {
    process.env.GENOS_GATEWAY_TOKEN = previousToken;
  }
});
test.each([
  { clientId: "genosos-ios", platform: "ios" },
  { clientId: "genosos-android", platform: "android" },
])("accepts $clientId as a valid gateway client id", async ({ clientId, platform }) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => ws.once("open", resolve));
  const res = await connectReq(ws, { clientId, platform });
  if (!res.ok) {
    const message = String(res.error?.message ?? "");
    if (message.includes("invalid connect params")) {
      throw new Error(message);
    }
  }
  ws.close();
});
