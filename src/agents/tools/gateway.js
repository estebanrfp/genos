let canonicalizeToolGatewayWsUrl = function (raw) {
    const input = raw.trim();
    let url;
    try {
      url = new URL(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid gatewayUrl: ${input} (${message})`, { cause: error });
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error(`invalid gatewayUrl protocol: ${url.protocol} (expected ws:// or wss://)`);
    }
    if (url.username || url.password) {
      throw new Error("invalid gatewayUrl: credentials are not allowed");
    }
    if (url.search || url.hash) {
      throw new Error("invalid gatewayUrl: query/hash not allowed");
    }
    if (url.pathname && url.pathname !== "/") {
      throw new Error("invalid gatewayUrl: path not allowed");
    }
    const origin = url.origin;
    const key = `${url.protocol}//${url.host.toLowerCase()}`;
    return { origin, key };
  },
  validateGatewayUrlOverrideForAgentTools = function (urlOverride) {
    const cfg = loadConfig();
    const port = resolveGatewayPort(cfg);
    const allowed = new Set([
      `ws://127.0.0.1:${port}`,
      `wss://127.0.0.1:${port}`,
      `ws://localhost:${port}`,
      `wss://localhost:${port}`,
      `ws://[::1]:${port}`,
      `wss://[::1]:${port}`,
    ]);
    const remoteUrl =
      typeof cfg.gateway?.remote?.url === "string" ? cfg.gateway.remote.url.trim() : "";
    if (remoteUrl) {
      try {
        const remote = canonicalizeToolGatewayWsUrl(remoteUrl);
        allowed.add(remote.key);
      } catch {}
    }
    const parsed = canonicalizeToolGatewayWsUrl(urlOverride);
    if (!allowed.has(parsed.key)) {
      throw new Error(
        [
          "gatewayUrl override rejected.",
          `Allowed: ws(s) loopback on port ${port} (127.0.0.1/localhost/[::1])`,
          "Or: configure gateway.remote.url and omit gatewayUrl to use the configured remote gateway.",
        ].join(" "),
      );
    }
    return parsed.origin;
  };
import { loadConfig, resolveGatewayPort } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { readStringParam } from "./common.js";
export const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
export function readGatewayCallOptions(params) {
  return {
    gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
    gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
    timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
  };
}
export function resolveGatewayOptions(opts) {
  const url =
    typeof opts?.gatewayUrl === "string" && opts.gatewayUrl.trim()
      ? validateGatewayUrlOverrideForAgentTools(opts.gatewayUrl)
      : undefined;
  const token =
    typeof opts?.gatewayToken === "string" && opts.gatewayToken.trim()
      ? opts.gatewayToken.trim()
      : undefined;
  const timeoutMs =
    typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
      ? Math.max(1, Math.floor(opts.timeoutMs))
      : 30000;
  return { url, token, timeoutMs };
}
export async function callGatewayTool(method, opts, params, extra) {
  const gateway = resolveGatewayOptions(opts);
  return await callGateway({
    url: gateway.url,
    token: gateway.token,
    method,
    params,
    timeoutMs: gateway.timeoutMs,
    expectFinal: extra?.expectFinal,
    clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    clientDisplayName: "agent",
    mode: GATEWAY_CLIENT_MODES.BACKEND,
  });
}
