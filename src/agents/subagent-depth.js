let normalizeSpawnDepth = function (value) {
    if (typeof value === "number") {
      return Number.isInteger(value) && value >= 0 ? value : undefined;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const numeric = Number(trimmed);
      return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
    }
    return;
  },
  normalizeSessionKey = function (value) {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  },
  readSessionStore = function (storePath) {
    try {
      const raw = fs.readFileSync(storePath, "utf-8");
      const parsed = JSON5.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
    return {};
  },
  buildKeyCandidates = function (rawKey, cfg) {
    if (!cfg) {
      return [rawKey];
    }
    if (rawKey === "global" || rawKey === "unknown") {
      return [rawKey];
    }
    if (parseAgentSessionKey(rawKey)) {
      return [rawKey];
    }
    const defaultAgentId = resolveDefaultAgentId(cfg);
    const prefixed = `agent:${defaultAgentId}:${rawKey}`;
    return prefixed === rawKey ? [rawKey] : [rawKey, prefixed];
  },
  findEntryBySessionId = function (store, sessionId) {
    const normalizedSessionId = normalizeSessionKey(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    for (const entry of Object.values(store)) {
      const candidateSessionId = normalizeSessionKey(entry?.sessionId);
      if (candidateSessionId && candidateSessionId === normalizedSessionId) {
        return entry;
      }
    }
    return;
  },
  resolveEntryForSessionKey = function (params) {
    const candidates = buildKeyCandidates(params.sessionKey, params.cfg);
    if (params.store) {
      for (const key of candidates) {
        const entry = params.store[key];
        if (entry) {
          return entry;
        }
      }
      return findEntryBySessionId(params.store, params.sessionKey);
    }
    if (!params.cfg) {
      return;
    }
    for (const key of candidates) {
      const parsed = parseAgentSessionKey(key);
      if (!parsed?.agentId) {
        continue;
      }
      const storePath = resolveStorePath(params.cfg.session?.store, { agentId: parsed.agentId });
      let store = params.cache.get(storePath);
      if (!store) {
        store = readSessionStore(storePath);
        params.cache.set(storePath, store);
      }
      const entry = store[key] ?? findEntryBySessionId(store, params.sessionKey);
      if (entry) {
        return entry;
      }
    }
    return;
  };
import fs from "node:fs";
import JSON5 from "json5";
import { resolveStorePath } from "../config/sessions/paths.js";
import { getSubagentDepth, parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { resolveDefaultAgentId } from "./agent-scope.js";
export function getSubagentDepthFromSessionStore(sessionKey, opts) {
  const raw = (sessionKey ?? "").trim();
  const fallbackDepth = getSubagentDepth(raw);
  if (!raw) {
    return fallbackDepth;
  }
  const cache = new Map();
  const visited = new Set();
  const depthFromStore = (key) => {
    const normalizedKey = normalizeSessionKey(key);
    if (!normalizedKey) {
      return;
    }
    if (visited.has(normalizedKey)) {
      return;
    }
    visited.add(normalizedKey);
    const entry = resolveEntryForSessionKey({
      sessionKey: normalizedKey,
      cfg: opts?.cfg,
      store: opts?.store,
      cache,
    });
    const storedDepth = normalizeSpawnDepth(entry?.spawnDepth);
    if (storedDepth !== undefined) {
      return storedDepth;
    }
    const spawnedBy = normalizeSessionKey(entry?.spawnedBy);
    if (!spawnedBy) {
      return;
    }
    const parentDepth = depthFromStore(spawnedBy);
    if (parentDepth !== undefined) {
      return parentDepth + 1;
    }
    return getSubagentDepth(spawnedBy) + 1;
  };
  return depthFromStore(raw) ?? fallbackDepth;
}
