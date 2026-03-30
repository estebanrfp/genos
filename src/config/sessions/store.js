let isSessionStoreRecord = function (value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  },
  getSessionStoreTtl = function () {
    return resolveCacheTtlMs({
      envValue: process.env.GENOS_SESSION_CACHE_TTL_MS,
      defaultTtlMs: DEFAULT_SESSION_STORE_TTL_MS,
    });
  },
  isSessionStoreCacheEnabled = function () {
    return isCacheEnabled(getSessionStoreTtl());
  },
  isSessionStoreCacheValid = function (entry) {
    const now = Date.now();
    const ttl = getSessionStoreTtl();
    return now - entry.loadedAt <= ttl;
  },
  invalidateSessionStoreCache = function (storePath) {
    SESSION_STORE_CACHE.delete(storePath);
  },
  normalizeSessionEntryDelivery = function (entry) {
    const normalized = normalizeSessionDeliveryFields({
      channel: entry.channel,
      lastChannel: entry.lastChannel,
      lastTo: entry.lastTo,
      lastAccountId: entry.lastAccountId,
      lastThreadId: entry.lastThreadId ?? entry.deliveryContext?.threadId ?? entry.origin?.threadId,
      deliveryContext: entry.deliveryContext,
    });
    const nextDelivery = normalized.deliveryContext;
    const sameDelivery =
      (entry.deliveryContext?.channel ?? undefined) === nextDelivery?.channel &&
      (entry.deliveryContext?.to ?? undefined) === nextDelivery?.to &&
      (entry.deliveryContext?.accountId ?? undefined) === nextDelivery?.accountId &&
      (entry.deliveryContext?.threadId ?? undefined) === nextDelivery?.threadId;
    const sameLast =
      entry.lastChannel === normalized.lastChannel &&
      entry.lastTo === normalized.lastTo &&
      entry.lastAccountId === normalized.lastAccountId &&
      entry.lastThreadId === normalized.lastThreadId;
    if (sameDelivery && sameLast) {
      return entry;
    }
    return {
      ...entry,
      deliveryContext: nextDelivery,
      lastChannel: normalized.lastChannel,
      lastTo: normalized.lastTo,
      lastAccountId: normalized.lastAccountId,
      lastThreadId: normalized.lastThreadId,
    };
  },
  removeThreadFromDeliveryContext = function (context) {
    if (!context || context.threadId == null) {
      return context;
    }
    const next = { ...context };
    delete next.threadId;
    return next;
  },
  normalizeSessionStore = function (store) {
    for (const [key, entry] of Object.entries(store)) {
      if (!entry) {
        continue;
      }
      const normalized = normalizeSessionEntryDelivery(entry);
      if (normalized !== entry) {
        store[key] = normalized;
      }
    }
  },
  resolvePruneAfterMs = function (maintenance) {
    const raw = maintenance?.pruneAfter ?? maintenance?.pruneDays;
    if (raw === undefined || raw === null || raw === "") {
      return DEFAULT_SESSION_PRUNE_AFTER_MS;
    }
    try {
      return parseDurationMs(String(raw).trim(), { defaultUnit: "d" });
    } catch {
      return DEFAULT_SESSION_PRUNE_AFTER_MS;
    }
  },
  resolveRotateBytes = function (maintenance) {
    const raw = maintenance?.rotateBytes;
    if (raw === undefined || raw === null || raw === "") {
      return DEFAULT_SESSION_ROTATE_BYTES;
    }
    try {
      return parseByteSize(String(raw).trim(), { defaultUnit: "b" });
    } catch {
      return DEFAULT_SESSION_ROTATE_BYTES;
    }
  },
  getEntryUpdatedAt = function (entry) {
    return entry?.updatedAt ?? Number.NEGATIVE_INFINITY;
  },
  lockTimeoutError = function (storePath) {
    return new Error(`timeout waiting for session store lock: ${storePath}`);
  },
  getOrCreateLockQueue = function (storePath) {
    const existing = LOCK_QUEUES.get(storePath);
    if (existing) {
      return existing;
    }
    const created = { running: false, pending: [] };
    LOCK_QUEUES.set(storePath, created);
    return created;
  };
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { acquireSessionWriteLock } from "../../agents/session-write-lock.js";
import { parseByteSize } from "../../cli/parse-bytes.js";
import { parseDurationMs } from "../../cli/parse-duration.js";
import {
  archiveSessionTranscripts,
  cleanupArchivedSessionTranscripts,
} from "../../gateway/session-utils.fs.js";
import { secureReadFileSync, secureWriteFile } from "../../infra/secure-io.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  deliveryContextFromSession,
  mergeDeliveryContext,
  normalizeDeliveryContext,
  normalizeSessionDeliveryFields,
} from "../../utils/delivery-context.js";
import { getFileMtimeMs, isCacheEnabled, resolveCacheTtlMs } from "../cache-utils.js";
import { loadConfig } from "../config.js";
import { deriveSessionMetaPatch } from "./metadata.js";
import { mergeSessionEntry } from "./types.js";
const log = createSubsystemLogger("sessions/store");
const SESSION_STORE_CACHE = new Map();
const DEFAULT_SESSION_STORE_TTL_MS = 45000;
export function clearSessionStoreCacheForTest() {
  SESSION_STORE_CACHE.clear();
  for (const queue of LOCK_QUEUES.values()) {
    for (const task of queue.pending) {
      task.reject(new Error("session store queue cleared for test"));
    }
  }
  LOCK_QUEUES.clear();
}
export function getSessionStoreLockQueueSizeForTest() {
  return LOCK_QUEUES.size;
}
export async function withSessionStoreLockForTest(storePath, fn, opts = {}) {
  return await withSessionStoreLock(storePath, fn, opts);
}
export function loadSessionStore(storePath, opts = {}) {
  if (!opts.skipCache && isSessionStoreCacheEnabled()) {
    const cached = SESSION_STORE_CACHE.get(storePath);
    if (cached && isSessionStoreCacheValid(cached)) {
      const currentMtimeMs = getFileMtimeMs(storePath);
      if (currentMtimeMs === cached.mtimeMs) {
        return structuredClone(cached.store);
      }
      invalidateSessionStoreCache(storePath);
    }
  }
  let store = {};
  let mtimeMs = getFileMtimeMs(storePath);
  const maxReadAttempts = process.platform === "win32" ? 3 : 1;
  const retryBuf = maxReadAttempts > 1 ? new Int32Array(new SharedArrayBuffer(4)) : undefined;
  for (let attempt = 0; attempt < maxReadAttempts; attempt++) {
    try {
      const raw = secureReadFileSync(storePath);
      if (raw.length === 0 && attempt < maxReadAttempts - 1) {
        Atomics.wait(retryBuf, 0, 0, 50);
        continue;
      }
      const parsed = JSON.parse(raw);
      if (isSessionStoreRecord(parsed)) {
        store = parsed;
      }
      mtimeMs = getFileMtimeMs(storePath) ?? mtimeMs;
      break;
    } catch {
      if (attempt < maxReadAttempts - 1) {
        Atomics.wait(retryBuf, 0, 0, 50);
        continue;
      }
    }
  }
  for (const entry of Object.values(store)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const rec = entry;
    if (typeof rec.channel !== "string" && typeof rec.provider === "string") {
      rec.channel = rec.provider;
      delete rec.provider;
    }
    if (typeof rec.lastChannel !== "string" && typeof rec.lastProvider === "string") {
      rec.lastChannel = rec.lastProvider;
      delete rec.lastProvider;
    }
    if (typeof rec.groupChannel !== "string" && typeof rec.room === "string") {
      rec.groupChannel = rec.room;
      delete rec.room;
    } else if ("room" in rec) {
      delete rec.room;
    }
  }
  if (!opts.skipCache && isSessionStoreCacheEnabled()) {
    SESSION_STORE_CACHE.set(storePath, {
      store: structuredClone(store),
      loadedAt: Date.now(),
      storePath,
      mtimeMs,
    });
  }
  return structuredClone(store);
}
export function readSessionUpdatedAt(params) {
  try {
    const store = loadSessionStore(params.storePath);
    return store[params.sessionKey]?.updatedAt;
  } catch {
    return;
  }
}
const DEFAULT_SESSION_PRUNE_AFTER_MS = 2592000000;
const DEFAULT_SESSION_MAX_ENTRIES = 500;
const DEFAULT_SESSION_ROTATE_BYTES = 10485760;
const DEFAULT_SESSION_MAINTENANCE_MODE = "warn";
export function resolveMaintenanceConfig() {
  let maintenance;
  try {
    maintenance = loadConfig().session?.maintenance;
  } catch {}
  return {
    mode: maintenance?.mode ?? DEFAULT_SESSION_MAINTENANCE_MODE,
    pruneAfterMs: resolvePruneAfterMs(maintenance),
    maxEntries: maintenance?.maxEntries ?? DEFAULT_SESSION_MAX_ENTRIES,
    rotateBytes: resolveRotateBytes(maintenance),
  };
}
export function pruneStaleEntries(store, overrideMaxAgeMs, opts = {}) {
  const maxAgeMs = overrideMaxAgeMs ?? resolveMaintenanceConfig().pruneAfterMs;
  const cutoffMs = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const [key, entry] of Object.entries(store)) {
    if (entry?.updatedAt != null && entry.updatedAt < cutoffMs) {
      opts.onPruned?.({ key, entry });
      delete store[key];
      pruned++;
    }
  }
  if (pruned > 0 && opts.log !== false) {
    log.info("pruned stale session entries", { pruned, maxAgeMs });
  }
  return pruned;
}
export function getActiveSessionMaintenanceWarning(params) {
  const activeSessionKey = params.activeSessionKey.trim();
  if (!activeSessionKey) {
    return null;
  }
  const activeEntry = params.store[activeSessionKey];
  if (!activeEntry) {
    return null;
  }
  const now = params.nowMs ?? Date.now();
  const cutoffMs = now - params.pruneAfterMs;
  const wouldPrune = activeEntry.updatedAt != null ? activeEntry.updatedAt < cutoffMs : false;
  const keys = Object.keys(params.store);
  const wouldCap =
    keys.length > params.maxEntries &&
    keys
      .toSorted((a, b) => getEntryUpdatedAt(params.store[b]) - getEntryUpdatedAt(params.store[a]))
      .slice(params.maxEntries)
      .includes(activeSessionKey);
  if (!wouldPrune && !wouldCap) {
    return null;
  }
  return {
    activeSessionKey,
    activeUpdatedAt: activeEntry.updatedAt,
    totalEntries: keys.length,
    pruneAfterMs: params.pruneAfterMs,
    maxEntries: params.maxEntries,
    wouldPrune,
    wouldCap,
  };
}
export function capEntryCount(store, overrideMax, opts = {}) {
  const maxEntries = overrideMax ?? resolveMaintenanceConfig().maxEntries;
  const keys = Object.keys(store);
  if (keys.length <= maxEntries) {
    return 0;
  }
  const sorted = keys.toSorted((a, b) => {
    const aTime = getEntryUpdatedAt(store[a]);
    const bTime = getEntryUpdatedAt(store[b]);
    return bTime - aTime;
  });
  const toRemove = sorted.slice(maxEntries);
  for (const key of toRemove) {
    delete store[key];
  }
  if (opts.log !== false) {
    log.info("capped session entry count", { removed: toRemove.length, maxEntries });
  }
  return toRemove.length;
}
async function getSessionFileSize(storePath) {
  try {
    const stat = await fs.promises.stat(storePath);
    return stat.size;
  } catch {
    return null;
  }
}
export async function rotateSessionFile(storePath, overrideBytes) {
  const maxBytes = overrideBytes ?? resolveMaintenanceConfig().rotateBytes;
  const fileSize = await getSessionFileSize(storePath);
  if (fileSize == null) {
    return false;
  }
  if (fileSize <= maxBytes) {
    return false;
  }
  const backupPath = `${storePath}.bak.${Date.now()}`;
  try {
    await fs.promises.rename(storePath, backupPath);
    log.info("rotated session store file", {
      backupPath: path.basename(backupPath),
      sizeBytes: fileSize,
    });
  } catch {
    return false;
  }
  try {
    const dir = path.dirname(storePath);
    const baseName = path.basename(storePath);
    const files = await fs.promises.readdir(dir);
    const backups = files
      .filter((f) => f.startsWith(`${baseName}.bak.`))
      .toSorted()
      .toReversed();
    const maxBackups = 3;
    if (backups.length > maxBackups) {
      const toDelete = backups.slice(maxBackups);
      for (const old of toDelete) {
        await fs.promises.unlink(path.join(dir, old)).catch(() => {
          return;
        });
      }
      log.info("cleaned up old session store backups", { deleted: toDelete.length });
    }
  } catch {}
  return true;
}
async function saveSessionStoreUnlocked(storePath, store, opts) {
  invalidateSessionStoreCache(storePath);
  normalizeSessionStore(store);
  if (!opts?.skipMaintenance) {
    const maintenance = resolveMaintenanceConfig();
    const shouldWarnOnly = maintenance.mode === "warn";
    if (shouldWarnOnly) {
      const activeSessionKey = opts?.activeSessionKey?.trim();
      if (activeSessionKey) {
        const warning = getActiveSessionMaintenanceWarning({
          store,
          activeSessionKey,
          pruneAfterMs: maintenance.pruneAfterMs,
          maxEntries: maintenance.maxEntries,
        });
        if (warning) {
          log.warn("session maintenance would evict active session; skipping enforcement", {
            activeSessionKey: warning.activeSessionKey,
            wouldPrune: warning.wouldPrune,
            wouldCap: warning.wouldCap,
            pruneAfterMs: warning.pruneAfterMs,
            maxEntries: warning.maxEntries,
          });
          await opts?.onWarn?.(warning);
        }
      }
    } else {
      const prunedSessionFiles = new Map();
      pruneStaleEntries(store, maintenance.pruneAfterMs, {
        onPruned: ({ entry }) => {
          if (!prunedSessionFiles.has(entry.sessionId) || entry.sessionFile) {
            prunedSessionFiles.set(entry.sessionId, entry.sessionFile);
          }
        },
      });
      capEntryCount(store, maintenance.maxEntries);
      const archivedDirs = new Set();
      for (const [sessionId, sessionFile] of prunedSessionFiles) {
        const archived = archiveSessionTranscripts({
          sessionId,
          storePath,
          sessionFile,
          reason: "deleted",
        });
        for (const archivedPath of archived) {
          archivedDirs.add(path.dirname(archivedPath));
        }
      }
      if (archivedDirs.size > 0) {
        await cleanupArchivedSessionTranscripts({
          directories: [...archivedDirs],
          olderThanMs: maintenance.pruneAfterMs,
          reason: "deleted",
        });
      }
      await rotateSessionFile(storePath, maintenance.rotateBytes);
    }
  }
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const json = JSON.stringify(store, null, 2);
  if (process.platform === "win32") {
    const tmp = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await secureWriteFile(tmp, json);
      for (let i = 0; i < 5; i++) {
        try {
          await fs.promises.rename(tmp, storePath);
          break;
        } catch {
          if (i < 4) {
            await new Promise((r) => setTimeout(r, 50 * (i + 1)));
          }
          if (i === 4) {
            console.warn(`[session-store] rename failed after 5 attempts: ${storePath}`);
          }
        }
      }
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : null;
      if (code === "ENOENT") {
        return;
      }
      throw err;
    } finally {
      await fs.promises.rm(tmp, { force: true }).catch(() => {
        return;
      });
    }
    return;
  }
  const tmp = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await secureWriteFile(tmp, json);
    await fs.promises.rename(tmp, storePath);
    await fs.promises.chmod(storePath, 384);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : null;
    if (code === "ENOENT") {
      try {
        await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
        await secureWriteFile(storePath, json);
      } catch (err2) {
        const code2 = err2 && typeof err2 === "object" && "code" in err2 ? String(err2.code) : null;
        if (code2 === "ENOENT") {
          return;
        }
        throw err2;
      }
      return;
    }
    throw err;
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}
export async function saveSessionStore(storePath, store, opts) {
  await withSessionStoreLock(storePath, async () => {
    await saveSessionStoreUnlocked(storePath, store, opts);
  });
}
export async function updateSessionStore(storePath, mutator, opts) {
  return await withSessionStoreLock(storePath, async () => {
    const store = loadSessionStore(storePath, { skipCache: true });
    const result = await mutator(store);
    await saveSessionStoreUnlocked(storePath, store, opts);
    return result;
  });
}
const LOCK_QUEUES = new Map();
async function drainSessionStoreLockQueue(storePath) {
  const queue = LOCK_QUEUES.get(storePath);
  if (!queue || queue.running) {
    return;
  }
  queue.running = true;
  try {
    while (queue.pending.length > 0) {
      const task = queue.pending.shift();
      if (!task) {
        continue;
      }
      const remainingTimeoutMs = task.timeoutMs ?? Number.POSITIVE_INFINITY;
      if (task.timeoutMs != null && remainingTimeoutMs <= 0) {
        task.reject(lockTimeoutError(storePath));
        continue;
      }
      let lock;
      let result;
      let failed;
      let hasFailure = false;
      try {
        lock = await acquireSessionWriteLock({
          sessionFile: storePath,
          timeoutMs: remainingTimeoutMs,
          staleMs: task.staleMs,
        });
        result = await task.fn();
      } catch (err) {
        hasFailure = true;
        failed = err;
      } finally {
        await lock?.release().catch(() => {
          return;
        });
      }
      if (hasFailure) {
        task.reject(failed);
        continue;
      }
      task.resolve(result);
    }
  } finally {
    queue.running = false;
    if (queue.pending.length === 0) {
      LOCK_QUEUES.delete(storePath);
    } else {
      queueMicrotask(() => {
        drainSessionStoreLockQueue(storePath);
      });
    }
  }
}
async function withSessionStoreLock(storePath, fn, opts = {}) {
  if (!storePath || typeof storePath !== "string") {
    throw new Error(
      `withSessionStoreLock: storePath must be a non-empty string, got ${JSON.stringify(storePath)}`,
    );
  }
  const timeoutMs = opts.timeoutMs ?? 1e4;
  const staleMs = opts.staleMs ?? 30000;
  const hasTimeout = timeoutMs > 0 && Number.isFinite(timeoutMs);
  const queue = getOrCreateLockQueue(storePath);
  const promise = new Promise((resolve, reject) => {
    const task = {
      fn: async () => await fn(),
      resolve: (value) => resolve(value),
      reject,
      timeoutMs: hasTimeout ? timeoutMs : undefined,
      staleMs,
    };
    queue.pending.push(task);
    drainSessionStoreLockQueue(storePath);
  });
  return await promise;
}
export async function updateSessionStoreEntry(params) {
  const { storePath, sessionKey, update } = params;
  return await withSessionStoreLock(storePath, async () => {
    const store = loadSessionStore(storePath);
    const existing = store[sessionKey];
    if (!existing) {
      return null;
    }
    const patch = await update(existing);
    if (!patch) {
      return existing;
    }
    const next = mergeSessionEntry(existing, patch);
    store[sessionKey] = next;
    await saveSessionStoreUnlocked(storePath, store, { activeSessionKey: sessionKey });
    return next;
  });
}
let _sessionChangeListener = null;
/** Register a callback invoked when a new session is created from an inbound message. */
export function onSessionCreated(fn) {
  _sessionChangeListener = typeof fn === "function" ? fn : null;
}
export async function recordSessionMetaFromInbound(params) {
  const { storePath, sessionKey, ctx } = params;
  const createIfMissing = params.createIfMissing ?? true;
  let isNew = false;
  const result = await updateSessionStore(
    storePath,
    (store) => {
      const existing = store[sessionKey];
      isNew = !existing;
      const patch = deriveSessionMetaPatch({
        ctx,
        sessionKey,
        existing,
        groupResolution: params.groupResolution,
      });
      if (!patch) {
        return existing ?? null;
      }
      if (!existing && !createIfMissing) {
        isNew = false;
        return null;
      }
      const next = mergeSessionEntry(existing, patch);
      store[sessionKey] = next;
      return next;
    },
    { activeSessionKey: sessionKey },
  );
  if (isNew && result) {
    try {
      _sessionChangeListener?.(sessionKey);
    } catch {}
  }
  return result;
}
export async function updateLastRoute(params) {
  const { storePath, sessionKey, channel, to, accountId, threadId, ctx } = params;
  return await withSessionStoreLock(storePath, async () => {
    const store = loadSessionStore(storePath);
    const existing = store[sessionKey];
    const now = Date.now();
    const explicitContext = normalizeDeliveryContext(params.deliveryContext);
    const inlineContext = normalizeDeliveryContext({
      channel,
      to,
      accountId,
      threadId,
    });
    const mergedInput = mergeDeliveryContext(explicitContext, inlineContext);
    const explicitDeliveryContext = params.deliveryContext;
    const explicitThreadFromDeliveryContext =
      explicitDeliveryContext != null &&
      Object.prototype.hasOwnProperty.call(explicitDeliveryContext, "threadId")
        ? explicitDeliveryContext.threadId
        : undefined;
    const explicitThreadValue =
      explicitThreadFromDeliveryContext ??
      (threadId != null && threadId !== "" ? threadId : undefined);
    const explicitRouteProvided = Boolean(
      explicitContext?.channel ||
      explicitContext?.to ||
      inlineContext?.channel ||
      inlineContext?.to,
    );
    const clearThreadFromFallback = explicitRouteProvided && explicitThreadValue == null;
    const fallbackContext = clearThreadFromFallback
      ? removeThreadFromDeliveryContext(deliveryContextFromSession(existing))
      : deliveryContextFromSession(existing);
    const merged = mergeDeliveryContext(mergedInput, fallbackContext);
    const normalized = normalizeSessionDeliveryFields({
      deliveryContext: {
        channel: merged?.channel,
        to: merged?.to,
        accountId: merged?.accountId,
        threadId: merged?.threadId,
      },
    });
    const metaPatch = ctx
      ? deriveSessionMetaPatch({
          ctx,
          sessionKey,
          existing,
          groupResolution: params.groupResolution,
        })
      : null;
    const basePatch = {
      updatedAt: Math.max(existing?.updatedAt ?? 0, now),
      deliveryContext: normalized.deliveryContext,
      lastChannel: normalized.lastChannel,
      lastTo: normalized.lastTo,
      lastAccountId: normalized.lastAccountId,
      lastThreadId: normalized.lastThreadId,
    };
    const next = mergeSessionEntry(
      existing,
      metaPatch ? { ...basePatch, ...metaPatch } : basePatch,
    );
    store[sessionKey] = next;
    await saveSessionStoreUnlocked(storePath, store, { activeSessionKey: sessionKey });
    return next;
  });
}
