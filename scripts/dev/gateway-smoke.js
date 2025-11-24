import { createArgReader, createGatewayWsClient, resolveGatewayUrl } from "./gateway-ws-client.js";
const { get: getArg } = createArgReader();
const urlRaw = getArg("--url") ?? process.env.GENOS_GATEWAY_URL;
const token = getArg("--token") ?? process.env.GENOS_GATEWAY_TOKEN;
if (!urlRaw || !token) {
  console.error(
    "Usage: bun scripts/dev/gateway-smoke.ts --url <wss://host[:port]> --token <gateway.auth.token>\nOr set env: GENOS_GATEWAY_URL / GENOS_GATEWAY_TOKEN",
  );
  process.exit(1);
}
async function main() {
  const url = resolveGatewayUrl(urlRaw);
  const { request, waitOpen, close } = createGatewayWsClient({
    url: url.toString(),
    onEvent: (evt) => {
      if (evt.event === "connect.challenge") {
        return;
      }
    },
  });
  await waitOpen();
  const connectRes = await request("connect", {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "genosos-ios",
      displayName: "genosos gateway smoke test",
      version: "dev",
      platform: "dev",
      mode: "ui",
      instanceId: "genosos-dev-smoke",
    },
    locale: "en-US",
    userAgent: "gateway-smoke",
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.admin"],
    caps: [],
    auth: { token },
  });
  if (!connectRes.ok) {
    console.error("connect failed:", connectRes.error);
    process.exit(2);
  }
  const healthRes = await request("health");
  if (!healthRes.ok) {
    console.error("health failed:", healthRes.error);
    process.exit(3);
  }
  const historyRes = await request("chat.history", { sessionKey: "main" }, 15000);
  if (!historyRes.ok) {
    console.error("chat.history failed:", historyRes.error);
    process.exit(4);
  }
  console.log("ok: connected + health + chat.history");
  close();
}
await main();
