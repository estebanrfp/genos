import { isLoopbackHost } from "../gateway/net.js";
const normalizeHost = (value, rejectLoopback) => {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (rejectLoopback && isLoopbackHost(trimmed)) {
    return "";
  }
  return trimmed;
};
const parseHostHeader = (value) => {
  if (!value) {
    return { host: "" };
  }
  try {
    const parsed = new URL(`http://${String(value).trim()}`);
    const portRaw = parsed.port.trim();
    const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;
    return {
      host: parsed.hostname,
      port: Number.isFinite(port) ? port : undefined,
    };
  } catch {
    return { host: "" };
  }
};
const parseForwardedProto = (value) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};
export function resolveCanvasHostUrl(params) {
  const port = params.canvasPort;
  if (!port) {
    return;
  }
  const scheme =
    params.scheme ??
    (parseForwardedProto(params.forwardedProto)?.trim() === "https" ? "https" : "http");
  const override = normalizeHost(params.hostOverride, true);
  const parsedRequestHost = parseHostHeader(params.requestHost);
  const requestHost = normalizeHost(parsedRequestHost.host, !!override);
  const localAddress = normalizeHost(params.localAddress, Boolean(override || requestHost));
  const host = override || requestHost || localAddress;
  if (!host) {
    return;
  }
  let exposedPort = port;
  if (!override && requestHost && port === 18789) {
    if (parsedRequestHost.port && parsedRequestHost.port > 0) {
      exposedPort = parsedRequestHost.port;
    } else if (scheme === "https") {
      exposedPort = 443;
    } else if (scheme === "http") {
      exposedPort = 80;
    }
  }
  const formatted = host.includes(":") ? `[${host}]` : host;
  return `${scheme}://${formatted}:${exposedPort}`;
}
