let ensureNodePathEnv = function () {
  ensureGenosOSCliOnPath({ pathEnv: process.env.PATH ?? "" });
  const current = process.env.PATH ?? "";
  if (current.trim()) {
    return current;
  }
  process.env.PATH = DEFAULT_NODE_PATH;
  return DEFAULT_NODE_PATH;
};
import { resolveBrowserConfig } from "../browser/config.js";
import { loadConfig } from "../config/config.js";
import { GatewayClient } from "../gateway/client.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import { ensureGenosOSCliOnPath } from "../infra/path-env.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { VERSION } from "../version.js";
import { ensureNodeHostConfig, saveNodeHostConfig } from "./config.js";
import { coerceNodeInvokePayload, handleInvoke, buildNodeInvokeResultParams } from "./invoke.js";

export { buildNodeInvokeResultParams };
const DEFAULT_NODE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

class SkillBinsCache {
  bins = new Set();
  lastRefresh = 0;
  ttlMs = 90000;
  fetch;
  constructor(fetch) {
    this.fetch = fetch;
  }
  async current(force = false) {
    if (force || Date.now() - this.lastRefresh > this.ttlMs) {
      await this.refresh();
    }
    return this.bins;
  }
  async refresh() {
    try {
      const bins = await this.fetch();
      this.bins = new Set(bins);
      this.lastRefresh = Date.now();
    } catch {
      if (!this.lastRefresh) {
        this.bins = new Set();
      }
    }
  }
}
export async function runNodeHost(opts) {
  const config = await ensureNodeHostConfig();
  const nodeId = opts.nodeId?.trim() || config.nodeId;
  if (nodeId !== config.nodeId) {
    config.nodeId = nodeId;
  }
  const displayName =
    opts.displayName?.trim() || config.displayName || (await getMachineDisplayName());
  config.displayName = displayName;
  const gateway = {
    host: opts.gatewayHost,
    port: opts.gatewayPort,
    tls: opts.gatewayTls ?? loadConfig().gateway?.tls?.enabled ?? false,
    tlsFingerprint: opts.gatewayTlsFingerprint,
  };
  config.gateway = gateway;
  await saveNodeHostConfig(config);
  const cfg = loadConfig();
  const resolvedBrowser = resolveBrowserConfig(cfg.browser, cfg);
  const browserProxyEnabled =
    cfg.nodeHost?.browserProxy?.enabled !== false && resolvedBrowser.enabled;
  const isRemoteMode = cfg.gateway?.mode === "remote";
  const token =
    process.env.GENOS_GATEWAY_TOKEN?.trim() ||
    (isRemoteMode ? cfg.gateway?.remote?.token : cfg.gateway?.auth?.token);
  const password =
    process.env.GENOS_GATEWAY_PASSWORD?.trim() ||
    (isRemoteMode ? cfg.gateway?.remote?.password : cfg.gateway?.auth?.password);
  const host = gateway.host ?? "127.0.0.1";
  const port = gateway.port ?? 18789;
  const scheme = gateway.tls ? "wss" : "ws";
  const url = `${scheme}://${host}:${port}`;
  const pathEnv = ensureNodePathEnv();
  console.log(`node host PATH: ${pathEnv}`);
  const client = new GatewayClient({
    url,
    token: token?.trim() || undefined,
    password: password?.trim() || undefined,
    instanceId: nodeId,
    clientName: GATEWAY_CLIENT_NAMES.NODE_HOST,
    clientDisplayName: displayName,
    clientVersion: VERSION,
    platform: process.platform,
    mode: GATEWAY_CLIENT_MODES.NODE,
    role: "node",
    scopes: [],
    caps: ["system", ...(browserProxyEnabled ? ["browser"] : [])],
    commands: [
      "system.run",
      "system.which",
      "system.execApprovals.get",
      "system.execApprovals.set",
      ...(browserProxyEnabled ? ["browser.proxy"] : []),
    ],
    pathEnv,
    permissions: undefined,
    deviceIdentity: loadOrCreateDeviceIdentity(),
    tlsFingerprint: gateway.tlsFingerprint,
    onEvent: (evt) => {
      if (evt.event !== "node.invoke.request") {
        return;
      }
      const payload = coerceNodeInvokePayload(evt.payload);
      if (!payload) {
        return;
      }
      handleInvoke(payload, client, skillBins);
    },
    onConnectError: (err) => {
      console.error(`node host gateway connect failed: ${err.message}`);
    },
    onClose: (code, reason) => {
      console.error(`node host gateway closed (${code}): ${reason}`);
    },
  });
  const skillBins = new SkillBinsCache(async () => {
    const res = await client.request("skills.bins", {});
    const bins = Array.isArray(res?.bins) ? res.bins.map((bin) => String(bin)) : [];
    return bins;
  });
  client.start();
  await new Promise(() => {});
}
