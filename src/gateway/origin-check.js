let parseOrigin = function (originRaw) {
  const trimmed = (originRaw ?? "").trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return {
      origin: url.origin.toLowerCase(),
      host: url.host.toLowerCase(),
      hostname: url.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
};
import { isLoopbackHost, normalizeHostHeader, resolveHostName } from "./net.js";
export function checkBrowserOrigin(params) {
  const parsedOrigin = parseOrigin(params.origin);
  if (!parsedOrigin) {
    return { ok: false, reason: "origin missing or invalid" };
  }
  const allowlist = (params.allowedOrigins ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.includes(parsedOrigin.origin)) {
    return { ok: true };
  }
  const requestHost = normalizeHostHeader(params.requestHost);
  if (requestHost && parsedOrigin.host === requestHost) {
    return { ok: true };
  }
  const requestHostname = resolveHostName(requestHost);
  if (isLoopbackHost(parsedOrigin.hostname) && isLoopbackHost(requestHostname)) {
    return { ok: true };
  }
  return { ok: false, reason: "origin not allowed" };
}
