export function pickGatewaySelfPresence(presence) {
  if (!Array.isArray(presence)) {
    return null;
  }
  const entries = presence;
  const self =
    entries.find((e) => e.mode === "gateway" && e.reason === "self") ??
    entries.find((e) => typeof e.text === "string" && String(e.text).startsWith("Gateway:")) ??
    null;
  if (!self) {
    return null;
  }
  return {
    host: typeof self.host === "string" ? self.host : undefined,
    ip: typeof self.ip === "string" ? self.ip : undefined,
    version: typeof self.version === "string" ? self.version : undefined,
    platform: typeof self.platform === "string" ? self.platform : undefined,
  };
}
