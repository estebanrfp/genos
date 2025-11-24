let resolveCredentialsDir = function (env = process.env) {
    const stateDir = resolveStateDir(env, () => resolveRequiredHomeDir(env, os.homedir));
    return resolveOAuthDir(env, stateDir);
  },
  safeChannelKey = function (channel) {
    const raw = String(channel).trim().toLowerCase();
    if (!raw) {
      throw new Error("invalid pairing channel");
    }
    const safe = raw.replace(/[\\/:*?"<>|]/g, "_").replace(/\.\./g, "_");
    if (!safe || safe === "_") {
      throw new Error("invalid pairing channel");
    }
    return safe;
  },
  resolvePairingPath = function (channel, env = process.env) {
    return path.join(resolveCredentialsDir(env), `${safeChannelKey(channel)}-pairing.json`);
  },
  safeAccountKey = function (accountId) {
    const raw = String(accountId).trim().toLowerCase();
    if (!raw) {
      throw new Error("invalid pairing account id");
    }
    const safe = raw.replace(/[\\/:*?"<>|]/g, "_").replace(/\.\./g, "_");
    if (!safe || safe === "_") {
      throw new Error("invalid pairing account id");
    }
    return safe;
  },
  resolveAllowFromPath = function (channel, env = process.env, accountId) {
    const base = safeChannelKey(channel);
    const normalizedAccountId = typeof accountId === "string" ? accountId.trim() : "";
    if (!normalizedAccountId) {
      return path.join(resolveCredentialsDir(env), `${base}-allowFrom.json`);
    }
    return path.join(
      resolveCredentialsDir(env),
      `${base}-${safeAccountKey(normalizedAccountId)}-allowFrom.json`,
    );
  },
  parseTimestamp = function (value) {
    if (!value) {
      return null;
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  },
  isExpired = function (entry, nowMs) {
    const createdAt = parseTimestamp(entry.createdAt);
    if (!createdAt) {
      return true;
    }
    return nowMs - createdAt > PAIRING_PENDING_TTL_MS;
  },
  pruneExpiredRequests = function (reqs, nowMs) {
    const kept = [];
    let removed = false;
    for (const req of reqs) {
      if (isExpired(req, nowMs)) {
        removed = true;
        continue;
      }
      kept.push(req);
    }
    return { requests: kept, removed };
  },
  resolveLastSeenAt = function (entry) {
    return parseTimestamp(entry.lastSeenAt) ?? parseTimestamp(entry.createdAt) ?? 0;
  },
  pruneExcessRequests = function (reqs, maxPending) {
    if (maxPending <= 0 || reqs.length <= maxPending) {
      return { requests: reqs, removed: false };
    }
    const sorted = reqs.slice().toSorted((a, b) => resolveLastSeenAt(a) - resolveLastSeenAt(b));
    return { requests: sorted.slice(-maxPending), removed: true };
  },
  randomCode = function () {
    let out = "";
    for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
      const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
      out += PAIRING_CODE_ALPHABET[idx];
    }
    return out;
  },
  generateUniqueCode = function (existing) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const code = randomCode();
      if (!existing.has(code)) {
        return code;
      }
    }
    throw new Error("failed to generate unique pairing code");
  },
  normalizePairingAccountId = function (accountId) {
    return accountId?.trim().toLowerCase() || "";
  },
  requestMatchesAccountId = function (entry, normalizedAccountId) {
    if (!normalizedAccountId) {
      return true;
    }
    return (
      String(entry.meta?.accountId ?? "")
        .trim()
        .toLowerCase() === normalizedAccountId
    );
  },
  normalizeId = function (value) {
    return String(value).trim();
  },
  normalizeAllowEntry = function (channel, entry) {
    const trimmed = entry.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed === "*") {
      return "";
    }
    const adapter = getPairingAdapter(channel);
    const normalized = adapter?.normalizeAllowEntry
      ? adapter.normalizeAllowEntry(trimmed)
      : trimmed;
    return String(normalized).trim();
  },
  normalizeAllowFromList = function (channel, store) {
    const list = Array.isArray(store.allowFrom) ? store.allowFrom : [];
    return list.map((v) => normalizeAllowEntry(channel, String(v))).filter(Boolean);
  },
  normalizeAllowFromInput = function (channel, entry) {
    return normalizeAllowEntry(channel, normalizeId(entry));
  },
  dedupePreserveOrder = function (entries) {
    const seen = new Set();
    const out = [];
    for (const entry of entries) {
      const normalized = String(entry).trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  };
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPairingAdapter } from "../channels/plugins/pairing.js";
import { resolveOAuthDir, resolveStateDir } from "../config/paths.js";
import { withFileLock as withPathLock } from "../infra/file-lock.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../plugin-sdk/json-store.js";
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_PENDING_TTL_MS = 3600000;
const PAIRING_PENDING_MAX = 3;
const PAIRING_STORE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 1e4,
    randomize: true,
  },
  stale: 30000,
};
async function readJsonFile(filePath, fallback) {
  return await readJsonFileWithFallback(filePath, fallback);
}
async function writeJsonFile(filePath, value) {
  await writeJsonFileAtomically(filePath, value);
}
async function readPairingRequests(filePath) {
  const { value } = await readJsonFile(filePath, {
    version: 1,
    requests: [],
  });
  return Array.isArray(value.requests) ? value.requests : [];
}
async function readPrunedPairingRequests(filePath) {
  return pruneExpiredRequests(await readPairingRequests(filePath), Date.now());
}
async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.promises.access(filePath);
  } catch {
    await writeJsonFile(filePath, fallback);
  }
}
async function withFileLock(filePath, fallback, fn) {
  await ensureJsonFile(filePath, fallback);
  return await withPathLock(filePath, PAIRING_STORE_LOCK_OPTIONS, async () => {
    return await fn();
  });
}
async function readAllowFromStateForPath(channel, filePath) {
  const { value } = await readJsonFile(filePath, {
    version: 1,
    allowFrom: [],
  });
  return normalizeAllowFromList(channel, value);
}
async function readAllowFromState(params) {
  const { value } = await readJsonFile(params.filePath, {
    version: 1,
    allowFrom: [],
  });
  const current = normalizeAllowFromList(params.channel, value);
  const normalized = normalizeAllowFromInput(params.channel, params.entry);
  return { current, normalized: normalized || null };
}
async function writeAllowFromState(filePath, allowFrom) {
  await writeJsonFile(filePath, {
    version: 1,
    allowFrom,
  });
}
async function updateAllowFromStoreEntry(params) {
  const env = params.env ?? process.env;
  const filePath = resolveAllowFromPath(params.channel, env, params.accountId);
  return await withFileLock(filePath, { version: 1, allowFrom: [] }, async () => {
    const { current, normalized } = await readAllowFromState({
      channel: params.channel,
      entry: params.entry,
      filePath,
    });
    if (!normalized) {
      return { changed: false, allowFrom: current };
    }
    const next = params.apply(current, normalized);
    if (!next) {
      return { changed: false, allowFrom: current };
    }
    await writeAllowFromState(filePath, next);
    return { changed: true, allowFrom: next };
  });
}
export async function readChannelAllowFromStore(channel, env = process.env, accountId) {
  const normalizedAccountId = accountId?.trim().toLowerCase() ?? "";
  if (!normalizedAccountId) {
    const filePath = resolveAllowFromPath(channel, env);
    return await readAllowFromStateForPath(channel, filePath);
  }
  const scopedPath = resolveAllowFromPath(channel, env, accountId);
  const scopedEntries = await readAllowFromStateForPath(channel, scopedPath);
  const legacyPath = resolveAllowFromPath(channel, env);
  const legacyEntries = await readAllowFromStateForPath(channel, legacyPath);
  return dedupePreserveOrder([...scopedEntries, ...legacyEntries]);
}
async function updateChannelAllowFromStore(params) {
  return await updateAllowFromStoreEntry({
    channel: params.channel,
    entry: params.entry,
    accountId: params.accountId,
    env: params.env,
    apply: params.apply,
  });
}
export async function addChannelAllowFromStoreEntry(params) {
  return await updateChannelAllowFromStore({
    ...params,
    apply: (current, normalized) => {
      if (current.includes(normalized)) {
        return null;
      }
      return [...current, normalized];
    },
  });
}
export async function removeChannelAllowFromStoreEntry(params) {
  return await updateChannelAllowFromStore({
    ...params,
    apply: (current, normalized) => {
      const next = current.filter((entry) => entry !== normalized);
      if (next.length === current.length) {
        return null;
      }
      return next;
    },
  });
}
/**
 * Clear all allowFrom entries for a channel account.
 * @param {string} channel
 * @param {object} [env]
 * @param {string} [accountId]
 */
export async function clearChannelAllowFromStore(channel, env = process.env, accountId) {
  const filePath = resolveAllowFromPath(channel, env, accountId);
  await fs
    .writeFile(filePath, JSON.stringify({ version: 1, allowFrom: [] }), "utf8")
    .catch(() => {});
}

/**
 * Clear all pending pairing requests for a channel.
 * @param {string} channel
 * @param {object} [env]
 */
export async function clearChannelPairingRequests(channel, env = process.env) {
  const filePath = resolvePairingPath(channel, env);
  await fs
    .writeFile(filePath, JSON.stringify({ version: 1, requests: [] }), "utf8")
    .catch(() => {});
}

export async function listChannelPairingRequests(channel, env = process.env, accountId) {
  const filePath = resolvePairingPath(channel, env);
  return await withFileLock(filePath, { version: 1, requests: [] }, async () => {
    const { requests: prunedExpired, removed: expiredRemoved } =
      await readPrunedPairingRequests(filePath);
    const { requests: pruned, removed: cappedRemoved } = pruneExcessRequests(
      prunedExpired,
      PAIRING_PENDING_MAX,
    );
    if (expiredRemoved || cappedRemoved) {
      await writeJsonFile(filePath, {
        version: 1,
        requests: pruned,
      });
    }
    const normalizedAccountId = normalizePairingAccountId(accountId);
    const filtered = normalizedAccountId
      ? pruned.filter((entry) => requestMatchesAccountId(entry, normalizedAccountId))
      : pruned;
    return filtered
      .filter(
        (r) =>
          r &&
          typeof r.id === "string" &&
          typeof r.code === "string" &&
          typeof r.createdAt === "string",
      )
      .slice()
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
}
export async function upsertChannelPairingRequest(params) {
  const env = params.env ?? process.env;
  const filePath = resolvePairingPath(params.channel, env);
  return await withFileLock(filePath, { version: 1, requests: [] }, async () => {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const id = normalizeId(params.id);
    const normalizedAccountId = params.accountId?.trim();
    const baseMeta =
      params.meta && typeof params.meta === "object"
        ? Object.fromEntries(
            Object.entries(params.meta)
              .map(([k, v]) => [k, String(v ?? "").trim()])
              .filter(([_, v]) => Boolean(v)),
          )
        : undefined;
    const meta = normalizedAccountId ? { ...baseMeta, accountId: normalizedAccountId } : baseMeta;
    let reqs = await readPairingRequests(filePath);
    const { requests: prunedExpired, removed: expiredRemoved } = pruneExpiredRequests(reqs, nowMs);
    reqs = prunedExpired;
    const existingIdx = reqs.findIndex((r) => r.id === id);
    const existingCodes = new Set(
      reqs.map((req) =>
        String(req.code ?? "")
          .trim()
          .toUpperCase(),
      ),
    );
    if (existingIdx >= 0) {
      const existing = reqs[existingIdx];
      const existingCode =
        existing && typeof existing.code === "string" ? existing.code.trim() : "";
      const code = existingCode || generateUniqueCode(existingCodes);
      const next = {
        id,
        code,
        createdAt: existing?.createdAt ?? now,
        lastSeenAt: now,
        meta: meta ?? existing?.meta,
      };
      reqs[existingIdx] = next;
      const { requests: capped } = pruneExcessRequests(reqs, PAIRING_PENDING_MAX);
      await writeJsonFile(filePath, {
        version: 1,
        requests: capped,
      });
      return { code, created: false };
    }
    const { requests: capped, removed: cappedRemoved } = pruneExcessRequests(
      reqs,
      PAIRING_PENDING_MAX,
    );
    reqs = capped;
    if (PAIRING_PENDING_MAX > 0 && reqs.length >= PAIRING_PENDING_MAX) {
      if (expiredRemoved || cappedRemoved) {
        await writeJsonFile(filePath, {
          version: 1,
          requests: reqs,
        });
      }
      return { code: "", created: false };
    }
    const code = generateUniqueCode(existingCodes);
    const next = {
      id,
      code,
      createdAt: now,
      lastSeenAt: now,
      ...(meta ? { meta } : {}),
    };
    await writeJsonFile(filePath, {
      version: 1,
      requests: [...reqs, next],
    });
    return { code, created: true };
  });
}
export async function approveChannelPairingCode(params) {
  const env = params.env ?? process.env;
  const code = params.code.trim().toUpperCase();
  if (!code) {
    return null;
  }
  const filePath = resolvePairingPath(params.channel, env);
  return await withFileLock(filePath, { version: 1, requests: [] }, async () => {
    const { requests: pruned, removed } = await readPrunedPairingRequests(filePath);
    const normalizedAccountId = normalizePairingAccountId(params.accountId);
    const idx = pruned.findIndex((r) => {
      if (String(r.code ?? "").toUpperCase() !== code) {
        return false;
      }
      return requestMatchesAccountId(r, normalizedAccountId);
    });
    if (idx < 0) {
      if (removed) {
        await writeJsonFile(filePath, {
          version: 1,
          requests: pruned,
        });
      }
      return null;
    }
    const entry = pruned[idx];
    if (!entry) {
      return null;
    }
    pruned.splice(idx, 1);
    await writeJsonFile(filePath, {
      version: 1,
      requests: pruned,
    });
    const entryAccountId = String(entry.meta?.accountId ?? "").trim() || undefined;
    await addChannelAllowFromStoreEntry({
      channel: params.channel,
      entry: entry.id,
      accountId: params.accountId?.trim() || entryAccountId,
      env,
    });
    return { id: entry.id, entry };
  });
}
