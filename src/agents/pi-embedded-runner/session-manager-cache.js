let getSessionManagerTtl = function () {
    return resolveCacheTtlMs({
      envValue: process.env.GENOS_SESSION_MANAGER_CACHE_TTL_MS,
      defaultTtlMs: DEFAULT_SESSION_MANAGER_TTL_MS,
    });
  },
  isSessionManagerCacheEnabled = function () {
    return isCacheEnabled(getSessionManagerTtl());
  },
  isSessionManagerCached = function (sessionFile) {
    if (!isSessionManagerCacheEnabled()) {
      return false;
    }
    const entry = SESSION_MANAGER_CACHE.get(sessionFile);
    if (!entry) {
      return false;
    }
    const now = Date.now();
    const ttl = getSessionManagerTtl();
    return now - entry.loadedAt <= ttl;
  };
import { Buffer } from "node:buffer";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { isCacheEnabled, resolveCacheTtlMs } from "../../config/cache-utils.js";
import { isEncrypted } from "../../infra/memory-encryption.js";
import { secureReadFileSync } from "../../infra/secure-io.js";
const SESSION_MANAGER_CACHE = new Map();
const DEFAULT_SESSION_MANAGER_TTL_MS = 45000;
export function trackSessionManagerAccess(sessionFile) {
  if (!isSessionManagerCacheEnabled()) {
    return;
  }
  const now = Date.now();
  SESSION_MANAGER_CACHE.set(sessionFile, {
    sessionFile,
    loadedAt: now,
  });
}
/**
 * Decrypt a NYXENC1-encrypted session file in place before SessionManager.open().
 * SessionManager (external package) expects plaintext JSONL — if the file is
 * encrypted it silently produces an empty session, triggering a reset.
 * @param {string} sessionFile
 */
export function ensureSessionFileDecrypted(sessionFile) {
  try {
    if (!fsSync.existsSync(sessionFile)) {
      return;
    }
    const raw = fsSync.readFileSync(sessionFile, "utf-8");
    if (!isEncrypted(raw)) {
      return;
    }
    const plaintext = secureReadFileSync(sessionFile);
    fsSync.writeFileSync(sessionFile, plaintext, "utf-8");
  } catch {
    // graceful degradation — SessionManager will handle the file as-is
  }
}

export async function prewarmSessionFile(sessionFile) {
  if (!isSessionManagerCacheEnabled()) {
    return;
  }
  if (isSessionManagerCached(sessionFile)) {
    return;
  }
  try {
    const handle = await fs.open(sessionFile, "r");
    try {
      const buffer = Buffer.alloc(4096);
      await handle.read(buffer, 0, buffer.length, 0);
    } finally {
      await handle.close();
    }
    trackSessionManagerAccess(sessionFile);
  } catch {}
}
