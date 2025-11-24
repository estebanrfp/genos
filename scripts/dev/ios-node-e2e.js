let formatErr = function (err) {
    if (!err) {
      return "error";
    }
    if (typeof err === "string") {
      return err;
    }
    if (err instanceof Error) {
      return err.message || String(err);
    }
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  },
  pickIosNode = function (list, hint) {
    const nodes = (list.nodes ?? []).filter((n) => n && n.connected);
    const ios = nodes.filter((n) => (n.platform ?? "").toLowerCase().includes("ios"));
    if (ios.length === 0) {
      return null;
    }
    if (!hint) {
      return ios[0] ?? null;
    }
    const h = hint.toLowerCase();
    return (
      ios.find((n) => n.nodeId.toLowerCase() === h) ??
      ios.find((n) => (n.displayName ?? "").toLowerCase().includes(h)) ??
      ios.find((n) => n.nodeId.toLowerCase().includes(h)) ??
      ios[0] ??
      null
    );
  };
import { createArgReader, createGatewayWsClient, resolveGatewayUrl } from "./gateway-ws-client.js";
const { get: getArg, has: hasFlag } = createArgReader();
const urlRaw = getArg("--url") ?? process.env.GENOS_GATEWAY_URL;
const token = getArg("--token") ?? process.env.GENOS_GATEWAY_TOKEN;
const nodeHint = getArg("--node");
const dangerous = hasFlag("--dangerous") || process.env.GENOS_RUN_DANGEROUS === "1";
const jsonOut = hasFlag("--json");
if (!urlRaw || !token) {
  console.error(
    "Usage: bun scripts/dev/ios-node-e2e.ts --url <wss://host[:port]> --token <gateway.auth.token> [--node <id|name-substring>] [--dangerous] [--json]\nOr set env: GENOS_GATEWAY_URL / GENOS_GATEWAY_TOKEN",
  );
  process.exit(1);
}
const url = resolveGatewayUrl(urlRaw);
const isoNow = () => new Date().toISOString();
const isoMinusMs = (ms) => new Date(Date.now() - ms).toISOString();
async function main() {
  const { request, waitOpen, close } = createGatewayWsClient({ url: url.toString() });
  await waitOpen();
  const connectRes = await request("connect", {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "cli",
      displayName: "genosos ios node e2e",
      version: "dev",
      platform: "dev",
      mode: "cli",
      instanceId: "genosos-dev-ios-node-e2e",
    },
    locale: "en-US",
    userAgent: "ios-node-e2e",
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.admin"],
    caps: [],
    auth: { token },
  });
  if (!connectRes.ok) {
    console.error("connect failed:", connectRes.error);
    close();
    process.exit(2);
  }
  const healthRes = await request("health");
  if (!healthRes.ok) {
    console.error("health failed:", healthRes.error);
    close();
    process.exit(3);
  }
  const nodesRes = await request("node.list");
  if (!nodesRes.ok) {
    console.error("node.list failed:", nodesRes.error);
    close();
    process.exit(4);
  }
  const listPayload = nodesRes.payload ?? {};
  let node = pickIosNode(listPayload, nodeHint);
  if (!node) {
    const waitSeconds = Number.parseInt(getArg("--wait-seconds") ?? "25", 10);
    const deadline = Date.now() + Math.max(1, waitSeconds) * 1000;
    while (!node && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await request("node.list").catch(() => null);
      if (!res?.ok) {
        continue;
      }
      node = pickIosNode(res.payload ?? {}, nodeHint);
    }
  }
  if (!node) {
    console.error("No connected iOS nodes found. (Is the iOS app connected to the gateway?)");
    close();
    process.exit(5);
  }
  const tests = [
    { id: "device.info", command: "device.info" },
    { id: "device.status", command: "device.status" },
    {
      id: "system.notify",
      command: "system.notify",
      params: { title: "GenosOS E2E", body: `ios-node-e2e @ ${isoNow()}`, delivery: "system" },
    },
    {
      id: "contacts.search",
      command: "contacts.search",
      params: { query: null, limit: 5 },
    },
    {
      id: "calendar.events",
      command: "calendar.events",
      params: { startISO: isoMinusMs(21600000), endISO: isoNow(), limit: 10 },
    },
    {
      id: "reminders.list",
      command: "reminders.list",
      params: { status: "incomplete", limit: 10 },
    },
    {
      id: "motion.pedometer",
      command: "motion.pedometer",
      params: { startISO: isoMinusMs(3600000), endISO: isoNow() },
    },
    {
      id: "photos.latest",
      command: "photos.latest",
      params: { limit: 1, maxWidth: 512, quality: 0.7 },
    },
    {
      id: "camera.snap",
      command: "camera.snap",
      params: { facing: "back", maxWidth: 768, quality: 0.7, format: "jpeg" },
      dangerous: true,
      timeoutMs: 20000,
    },
    {
      id: "screen.record",
      command: "screen.record",
      params: { durationMs: 2000, fps: 15, includeAudio: false },
      dangerous: true,
      timeoutMs: 30000,
    },
  ];
  const run = tests.filter((t) => dangerous || !t.dangerous);
  const results = [];
  for (const t of run) {
    const invokeRes = await request(
      "node.invoke",
      {
        nodeId: node.nodeId,
        command: t.command,
        params: t.params,
        timeoutMs: t.timeoutMs ?? 12000,
        idempotencyKey: randomUUID(),
      },
      (t.timeoutMs ?? 12000) + 2000,
    ).catch((err) => {
      results.push({ id: t.id, ok: false, error: formatErr(err) });
      return null;
    });
    if (!invokeRes) {
      continue;
    }
    if (!invokeRes.ok) {
      results.push({ id: t.id, ok: false, error: invokeRes.error });
      continue;
    }
    results.push({ id: t.id, ok: true, payload: invokeRes.payload });
  }
  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          gateway: url.toString(),
          node: {
            nodeId: node.nodeId,
            displayName: node.displayName,
            platform: node.platform,
          },
          dangerous,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));
    const rows = results.map((r) => ({
      cmd: r.id,
      ok: r.ok ? "ok" : "fail",
      note: r.ok ? "" : formatErr(r.error ?? "error"),
    }));
    const width = Math.min(64, Math.max(12, ...rows.map((r) => r.cmd.length)));
    console.log(`node: ${node.displayName ?? node.nodeId} (${node.platform ?? "unknown"})`);
    console.log(`dangerous: ${dangerous ? "on" : "off"}`);
    console.log("");
    for (const r of rows) {
      console.log(`${pad(r.cmd, width)}  ${pad(r.ok, 4)}  ${r.note}`);
    }
  }
  const failed = results.filter((r) => !r.ok);
  close();
  if (failed.length > 0) {
    process.exit(10);
  }
}
await main();
