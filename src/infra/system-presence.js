let normalizePresenceKey = function (key) {
    if (!key) {
      return;
    }
    const trimmed = key.trim();
    if (!trimmed) {
      return;
    }
    return trimmed.toLowerCase();
  },
  resolvePrimaryIPv4 = function () {
    return pickPrimaryLanIPv4() ?? os.hostname();
  },
  initSelfPresence = function () {
    const host = os.hostname();
    const ip = resolvePrimaryIPv4() ?? undefined;
    const version = resolveRuntimeServiceVersion(process.env, "unknown");
    const modelIdentifier = (() => {
      const p = os.platform();
      if (p === "darwin") {
        const res = spawnSync("sysctl", ["-n", "hw.model"], {
          encoding: "utf-8",
        });
        const out = typeof res.stdout === "string" ? res.stdout.trim() : "";
        return out.length > 0 ? out : undefined;
      }
      return os.arch();
    })();
    const macOSVersion = () => {
      const res = spawnSync("sw_vers", ["-productVersion"], {
        encoding: "utf-8",
      });
      const out = typeof res.stdout === "string" ? res.stdout.trim() : "";
      return out.length > 0 ? out : os.release();
    };
    const platform = (() => {
      const p = os.platform();
      const rel = os.release();
      if (p === "darwin") {
        return `macos ${macOSVersion()}`;
      }
      if (p === "win32") {
        return `windows ${rel}`;
      }
      return `${p} ${rel}`;
    })();
    const deviceFamily = (() => {
      const p = os.platform();
      if (p === "darwin") {
        return "Mac";
      }
      if (p === "win32") {
        return "Windows";
      }
      if (p === "linux") {
        return "Linux";
      }
      return p;
    })();
    const text = `Gateway: ${host}${ip ? ` (${ip})` : ""} \xB7 app ${version} \xB7 mode gateway \xB7 reason self`;
    const selfEntry = {
      host,
      ip,
      version,
      platform,
      deviceFamily,
      modelIdentifier,
      mode: "gateway",
      reason: "self",
      text,
      ts: Date.now(),
    };
    const key = host.toLowerCase();
    entries.set(key, selfEntry);
  },
  ensureSelfPresence = function () {
    if (entries.size === 0) {
      initSelfPresence();
    }
  },
  touchSelfPresence = function () {
    const host = os.hostname();
    const key = host.toLowerCase();
    const existing = entries.get(key);
    if (existing) {
      entries.set(key, { ...existing, ts: Date.now() });
    } else {
      initSelfPresence();
    }
  },
  parsePresence = function (text) {
    const trimmed = text.trim();
    const pattern =
      /Node:\s*([^ (]+)\s*\(([^)]+)\)\s*·\s*app\s*([^·]+?)\s*·\s*last input\s*([0-9]+)s ago\s*·\s*mode\s*([^·]+?)\s*·\s*reason\s*(.+)$/i;
    const match = trimmed.match(pattern);
    if (!match) {
      return { text: trimmed, ts: Date.now() };
    }
    const [, host, ip, version, lastInputStr, mode, reasonRaw] = match;
    const lastInputSeconds = Number.parseInt(lastInputStr, 10);
    const reason = reasonRaw.trim();
    return {
      host: host.trim(),
      ip: ip.trim(),
      version: version.trim(),
      lastInputSeconds: Number.isFinite(lastInputSeconds) ? lastInputSeconds : undefined,
      mode: mode.trim(),
      reason,
      text: trimmed,
      ts: Date.now(),
    };
  },
  mergeStringList = function (...values) {
    const out = new Set();
    for (const list of values) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const item of list) {
        const trimmed = String(item).trim();
        if (trimmed) {
          out.add(trimmed);
        }
      }
    }
    return out.size > 0 ? [...out] : undefined;
  };
import { spawnSync } from "node:child_process";
import os from "node:os";
import { pickPrimaryLanIPv4 } from "../gateway/net.js";
import { resolveRuntimeServiceVersion } from "../version.js";
const entries = new Map();
const TTL_MS = 300000;
const MAX_ENTRIES = 200;
initSelfPresence();
export function updateSystemPresence(payload) {
  ensureSelfPresence();
  const parsed = parsePresence(payload.text);
  const key =
    normalizePresenceKey(payload.deviceId) ||
    normalizePresenceKey(payload.instanceId) ||
    normalizePresenceKey(parsed.instanceId) ||
    normalizePresenceKey(parsed.host) ||
    parsed.ip ||
    parsed.text.slice(0, 64) ||
    os.hostname().toLowerCase();
  const hadExisting = entries.has(key);
  const existing = entries.get(key) ?? {};
  const merged = {
    ...existing,
    ...parsed,
    host: payload.host ?? parsed.host ?? existing.host,
    ip: payload.ip ?? parsed.ip ?? existing.ip,
    version: payload.version ?? parsed.version ?? existing.version,
    platform: payload.platform ?? existing.platform,
    deviceFamily: payload.deviceFamily ?? existing.deviceFamily,
    modelIdentifier: payload.modelIdentifier ?? existing.modelIdentifier,
    mode: payload.mode ?? parsed.mode ?? existing.mode,
    lastInputSeconds:
      payload.lastInputSeconds ?? parsed.lastInputSeconds ?? existing.lastInputSeconds,
    reason: payload.reason ?? parsed.reason ?? existing.reason,
    deviceId: payload.deviceId ?? existing.deviceId,
    roles: mergeStringList(existing.roles, payload.roles),
    scopes: mergeStringList(existing.scopes, payload.scopes),
    instanceId: payload.instanceId ?? parsed.instanceId ?? existing.instanceId,
    text: payload.text || parsed.text || existing.text,
    ts: Date.now(),
  };
  entries.set(key, merged);
  const trackKeys = ["host", "ip", "version", "mode", "reason"];
  const changes = {};
  const changedKeys = [];
  for (const k of trackKeys) {
    const prev = existing[k];
    const next = merged[k];
    if (prev !== next) {
      changes[k] = next;
      changedKeys.push(k);
    }
  }
  return {
    key,
    previous: hadExisting ? existing : undefined,
    next: merged,
    changes,
    changedKeys,
  };
}
export function upsertPresence(key, presence) {
  ensureSelfPresence();
  const normalizedKey = normalizePresenceKey(key) ?? os.hostname().toLowerCase();
  const existing = entries.get(normalizedKey) ?? {};
  const roles = mergeStringList(existing.roles, presence.roles);
  const scopes = mergeStringList(existing.scopes, presence.scopes);
  const merged = {
    ...existing,
    ...presence,
    roles,
    scopes,
    ts: Date.now(),
    text:
      presence.text ||
      existing.text ||
      `Node: ${presence.host ?? existing.host ?? "unknown"} \xB7 mode ${presence.mode ?? existing.mode ?? "unknown"}`,
  };
  entries.set(normalizedKey, merged);
}
export function listSystemPresence() {
  ensureSelfPresence();
  const now = Date.now();
  for (const [k, v] of entries) {
    if (now - v.ts > TTL_MS) {
      entries.delete(k);
    }
  }
  if (entries.size > MAX_ENTRIES) {
    const sorted = [...entries.entries()].toSorted((a, b) => a[1].ts - b[1].ts);
    const toDrop = entries.size - MAX_ENTRIES;
    for (let i = 0; i < toDrop; i++) {
      entries.delete(sorted[i][0]);
    }
  }
  touchSelfPresence();
  return [...entries.values()].toSorted((a, b) => b.ts - a.ts);
}
