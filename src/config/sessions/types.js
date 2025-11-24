import crypto from "node:crypto";
export function mergeSessionEntry(existing, patch) {
  const sessionId = patch.sessionId ?? existing?.sessionId ?? crypto.randomUUID();
  const updatedAt = Math.max(existing?.updatedAt ?? 0, patch.updatedAt ?? 0, Date.now());
  if (!existing) {
    return { ...patch, sessionId, updatedAt };
  }
  return { ...existing, ...patch, sessionId, updatedAt };
}
export function resolveFreshSessionTotalTokens(entry) {
  const total = entry?.totalTokens;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return;
  }
  if (entry?.totalTokensFresh === false) {
    return;
  }
  return total;
}
export function isSessionTotalTokensFresh(entry) {
  return resolveFreshSessionTotalTokens(entry) !== undefined;
}
export const DEFAULT_RESET_TRIGGER = "/new";
export const DEFAULT_RESET_TRIGGERS = ["/new", "/reset"];
export const DEFAULT_IDLE_MINUTES = 60;
