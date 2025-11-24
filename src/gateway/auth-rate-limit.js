import { isLoopbackAddress } from "./net.js";
export const AUTH_RATE_LIMIT_SCOPE_DEFAULT = "default";
export const AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET = "shared-secret";
export const AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN = "device-token";
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 60000;
const DEFAULT_LOCKOUT_MS = 300000;
const PRUNE_INTERVAL_MS = 60000;
export function createAuthRateLimiter(config) {
  const maxAttempts = config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const lockoutMs = config?.lockoutMs ?? DEFAULT_LOCKOUT_MS;
  const exemptLoopback = config?.exemptLoopback ?? false;
  const entries = new Map();
  const pruneTimer = setInterval(() => prune(), PRUNE_INTERVAL_MS);
  if (pruneTimer.unref) {
    pruneTimer.unref();
  }
  function normalizeScope(scope) {
    return (scope ?? AUTH_RATE_LIMIT_SCOPE_DEFAULT).trim() || AUTH_RATE_LIMIT_SCOPE_DEFAULT;
  }
  function normalizeIp(ip) {
    return (ip ?? "").trim() || "unknown";
  }
  function resolveKey(rawIp, rawScope) {
    const ip = normalizeIp(rawIp);
    const scope = normalizeScope(rawScope);
    return { key: `${scope}:${ip}`, ip };
  }
  function isExempt(ip) {
    return exemptLoopback && isLoopbackAddress(ip);
  }
  function slideWindow(entry, now) {
    const cutoff = now - windowMs;
    entry.attempts = entry.attempts.filter((ts) => ts > cutoff);
  }
  function check(rawIp, rawScope) {
    const { key, ip } = resolveKey(rawIp, rawScope);
    if (isExempt(ip)) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 };
    }
    const now = Date.now();
    const entry = entries.get(key);
    if (!entry) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 };
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.lockedUntil - now,
      };
    }
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      entry.lockedUntil = undefined;
      entry.attempts = [];
    }
    slideWindow(entry, now);
    const remaining = Math.max(0, maxAttempts - entry.attempts.length);
    return { allowed: remaining > 0, remaining, retryAfterMs: 0 };
  }
  function recordFailure(rawIp, rawScope) {
    const { key, ip } = resolveKey(rawIp, rawScope);
    if (isExempt(ip)) {
      return;
    }
    const now = Date.now();
    let entry = entries.get(key);
    if (!entry) {
      entry = { attempts: [] };
      entries.set(key, entry);
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
      return;
    }
    slideWindow(entry, now);
    entry.attempts.push(now);
    if (entry.attempts.length >= maxAttempts) {
      entry.lockedUntil = now + lockoutMs;
    }
  }
  function reset(rawIp, rawScope) {
    const { key } = resolveKey(rawIp, rawScope);
    entries.delete(key);
  }
  function prune() {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.lockedUntil && now < entry.lockedUntil) {
        continue;
      }
      slideWindow(entry, now);
      if (entry.attempts.length === 0) {
        entries.delete(key);
      }
    }
  }
  function size() {
    return entries.size;
  }
  function dispose() {
    clearInterval(pruneTimer);
    entries.clear();
  }
  return { check, recordFailure, reset, size, prune, dispose };
}
