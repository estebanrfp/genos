import { WebSocket } from "ws";
import { captureEnv } from "../test-utils/env.js";
import { connectOk, getFreePort, startGatewayServer } from "./test-helpers.js";
export async function startGatewayServerHarness() {
  const envSnapshot = captureEnv(["GENOS_GATEWAY_TOKEN"]);
  delete process.env.GENOS_GATEWAY_TOKEN;
  const port = await getFreePort();
  const server = await startGatewayServer(port);
  const openClient = async (opts) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws.once("open", resolve));
    const hello = await connectOk(ws, opts);
    return { ws, hello };
  };
  const close = async () => {
    await server.close();
    envSnapshot.restore();
  };
  return { port, server, openClient, close };
}
