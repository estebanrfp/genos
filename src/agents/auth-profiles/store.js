let _syncAuthProfileStore = function (target, source) {
    target.version = source.version;
    target.profiles = source.profiles;
    target.order = source.order;
    target.lastGood = source.lastGood;
    target.usageStats = source.usageStats;
  },
  coerceLegacyStore = function (raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw;
    if ("profiles" in record) {
      return null;
    }
    const entries = {};
    for (const [key, value] of Object.entries(record)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const typed = value;
      if (typed.type !== "api_key" && typed.type !== "oauth" && typed.type !== "token") {
        continue;
      }
      entries[key] = {
        ...typed,
        provider: String(typed.provider ?? key),
      };
    }
    return Object.keys(entries).length > 0 ? entries : null;
  },
  coerceAuthStore = function (raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw;
    if (!record.profiles || typeof record.profiles !== "object") {
      return null;
    }
    const profiles = record.profiles;
    const normalized = {};
    for (const [key, value] of Object.entries(profiles)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const typed = value;
      if (typed.type !== "api_key" && typed.type !== "oauth" && typed.type !== "token") {
        continue;
      }
      if (!typed.provider) {
        continue;
      }
      normalized[key] = typed;
    }
    const order =
      record.order && typeof record.order === "object"
        ? Object.entries(record.order).reduce((acc, [provider, value]) => {
            if (!Array.isArray(value)) {
              return acc;
            }
            const list = value
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter(Boolean);
            if (list.length === 0) {
              return acc;
            }
            acc[provider] = list;
            return acc;
          }, {})
        : undefined;
    return {
      version: Number(record.version ?? AUTH_STORE_VERSION),
      profiles: normalized,
      order,
      lastGood:
        record.lastGood && typeof record.lastGood === "object" ? record.lastGood : undefined,
      usageStats:
        record.usageStats && typeof record.usageStats === "object" ? record.usageStats : undefined,
    };
  },
  mergeRecord = function (base, override) {
    if (!base && !override) {
      return;
    }
    if (!base) {
      return { ...override };
    }
    if (!override) {
      return { ...base };
    }
    return { ...base, ...override };
  },
  mergeAuthProfileStores = function (base, override) {
    if (
      Object.keys(override.profiles).length === 0 &&
      !override.order &&
      !override.lastGood &&
      !override.usageStats
    ) {
      return base;
    }
    return {
      version: Math.max(base.version, override.version ?? base.version),
      profiles: { ...base.profiles, ...override.profiles },
      order: mergeRecord(base.order, override.order),
      lastGood: mergeRecord(base.lastGood, override.lastGood),
      usageStats: mergeRecord(base.usageStats, override.usageStats),
    };
  },
  mergeOAuthFileIntoStore = function (store) {
    const oauthPath = resolveOAuthPath();
    const oauthRaw = loadJsonFile(oauthPath);
    if (!oauthRaw || typeof oauthRaw !== "object") {
      return false;
    }
    const oauthEntries = oauthRaw;
    let mutated = false;
    for (const [provider, creds] of Object.entries(oauthEntries)) {
      if (!creds || typeof creds !== "object") {
        continue;
      }
      const profileId = `${provider}:default`;
      if (store.profiles[profileId]) {
        continue;
      }
      store.profiles[profileId] = {
        type: "oauth",
        provider,
        ...creds,
      };
      mutated = true;
    }
    return mutated;
  },
  applyLegacyStore = function (store, legacy) {
    for (const [provider, cred] of Object.entries(legacy)) {
      const profileId = `${provider}:default`;
      if (cred.type === "api_key") {
        store.profiles[profileId] = {
          type: "api_key",
          provider: String(cred.provider ?? provider),
          key: cred.key,
          ...(cred.email ? { email: cred.email } : {}),
        };
        continue;
      }
      if (cred.type === "token") {
        store.profiles[profileId] = {
          type: "token",
          provider: String(cred.provider ?? provider),
          token: cred.token,
          ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
          ...(cred.email ? { email: cred.email } : {}),
        };
        continue;
      }
      store.profiles[profileId] = {
        type: "oauth",
        provider: String(cred.provider ?? provider),
        access: cred.access,
        refresh: cred.refresh,
        expires: cred.expires,
        ...(cred.enterpriseUrl ? { enterpriseUrl: cred.enterpriseUrl } : {}),
        ...(cred.projectId ? { projectId: cred.projectId } : {}),
        ...(cred.accountId ? { accountId: cred.accountId } : {}),
        ...(cred.email ? { email: cred.email } : {}),
      };
    }
  },
  loadAuthProfileStoreForAgent = function (agentDir, _options) {
    const authPath = resolveAuthStorePath(agentDir);
    const raw = loadJsonFile(authPath);
    const asStore = coerceAuthStore(raw);
    if (asStore) {
      const synced = syncExternalCliCredentials(asStore);
      if (synced) {
        saveJsonFile(authPath, asStore);
      }
      return asStore;
    }
    if (agentDir) {
      const mainAuthPath = resolveAuthStorePath();
      const mainRaw = loadJsonFile(mainAuthPath);
      const mainStore = coerceAuthStore(mainRaw);
      if (mainStore && Object.keys(mainStore.profiles).length > 0) {
        saveJsonFile(authPath, mainStore);
        log.info("inherited auth-profiles from main agent", { agentDir });
        return mainStore;
      }
    }
    const legacyRaw = loadJsonFile(resolveLegacyAuthStorePath(agentDir));
    const legacy = coerceLegacyStore(legacyRaw);
    const store = {
      version: AUTH_STORE_VERSION,
      profiles: {},
    };
    if (legacy) {
      applyLegacyStore(store, legacy);
    }
    const mergedOAuth = mergeOAuthFileIntoStore(store);
    const syncedCli = syncExternalCliCredentials(store);
    const shouldWrite = legacy !== null || mergedOAuth || syncedCli;
    if (shouldWrite) {
      saveJsonFile(authPath, store);
    }
    if (shouldWrite && legacy !== null) {
      const legacyPath = resolveLegacyAuthStorePath(agentDir);
      try {
        fs.unlinkSync(legacyPath);
      } catch (err) {
        if (err?.code !== "ENOENT") {
          log.warn("failed to delete legacy auth.json after migration", {
            err,
            legacyPath,
          });
        }
      }
    }
    return store;
  };
import fs from "node:fs";
import { resolveOAuthPath } from "../../config/paths.js";
import { withFileLock } from "../../infra/file-lock.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import { AUTH_STORE_LOCK_OPTIONS, AUTH_STORE_VERSION, log } from "./constants.js";
import { syncExternalCliCredentials } from "./external-cli-sync.js";
import { ensureAuthStoreFile, resolveAuthStorePath, resolveLegacyAuthStorePath } from "./paths.js";

/**
 * Build an in-memory store object from cfg.providers (the new unified format).
 * Translates providers[*].credentials + providers[*].failover → store shape.
 * @param {object} cfg - genosos config object
 * @returns {object} store-shaped object
 */
export function loadAuthProfileStoreFromConfig(cfg) {
  const cfgProviders = cfg?.providers ?? {};
  const profiles = {};
  const order = {};
  for (const [provider, entry] of Object.entries(cfgProviders)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    for (const cred of entry.credentials ?? []) {
      if (!cred?.id || !cred?.type) {
        continue;
      }
      const profileId = `${provider}:${cred.id}`;
      if (cred.type === "api_key") {
        profiles[profileId] = {
          type: "api_key",
          provider,
          key: cred.key,
          ...(cred.disabled ? { disabled: true } : {}),
        };
      } else if (cred.type === "token") {
        profiles[profileId] = {
          type: "token",
          provider,
          token: cred.token,
          ...(cred.email ? { email: cred.email } : {}),
          ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
          ...(cred.disabled ? { disabled: true } : {}),
        };
      } else if (cred.type === "oauth") {
        profiles[profileId] = {
          type: "oauth",
          provider,
          access: cred.access,
          refresh: cred.refresh,
          ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
          ...(cred.email ? { email: cred.email } : {}),
          ...(cred.enterpriseUrl ? { enterpriseUrl: cred.enterpriseUrl } : {}),
          ...(cred.projectId ? { projectId: cred.projectId } : {}),
          ...(cred.accountId ? { accountId: cred.accountId } : {}),
          ...(cred.disabled ? { disabled: true } : {}),
        };
      }
    }
    // Synthesize a credential from apiKey field when no credentials[] array exists
    if (!entry.credentials?.length && entry.apiKey?.trim()) {
      const profileId = `${provider}:default`;
      if (!profiles[profileId]) {
        profiles[profileId] = { type: "api_key", provider, key: entry.apiKey };
      }
    }
    if (Array.isArray(entry.failover) && entry.failover.length > 0) {
      order[provider] = entry.failover.map((id) => `${provider}:${id}`);
    }
  }
  return {
    version: AUTH_STORE_VERSION,
    profiles,
    order: Object.keys(order).length > 0 ? order : undefined,
  };
}

/**
 * Check if cfg.providers has any credentials (meaning migration ran and we should use providers).
 * @param {object} cfg
 * @returns {boolean}
 */
export function hasCredentialsInProviders(cfg) {
  const cfgProviders = cfg?.providers ?? {};
  return Object.values(cfgProviders).some(
    (entry) =>
      (Array.isArray(entry?.credentials) && entry.credentials.length > 0) || entry?.apiKey?.trim(),
  );
}

/**
 * Update cfg.providers atomically via config write.
 * Translates updater(store) result back into providers format.
 * Falls back silently on error (non-critical like autoSyncConfig).
 * @param {function(store): boolean} updater
 */
export async function updateProvidersInConfig(updater) {
  try {
    const { readConfigFileSnapshotForWrite, writeConfigFile } =
      await import("../../config/config.js");
    const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
    const cfg = snapshot.config ?? {};
    // Build in-memory store from current providers
    const store = loadAuthProfileStoreFromConfig(cfg);
    const shouldSave = updater(store);
    if (!shouldSave) {
      return;
    }
    // Translate store back to providers
    const providers = structuredClone(cfg.providers ?? {});
    // Sync credentials
    for (const [profileId, cred] of Object.entries(store.profiles ?? {})) {
      const colonIdx = profileId.indexOf(":");
      if (colonIdx === -1) {
        continue;
      }
      const provider = profileId.slice(0, colonIdx);
      const id = profileId.slice(colonIdx + 1);
      providers[provider] ??= {};
      providers[provider].credentials ??= [];
      const idx = providers[provider].credentials.findIndex((c) => c.id === id);
      const entry = { id, type: cred.type };
      if (cred.type === "api_key") {
        entry.key = cred.key;
      }
      if (cred.type === "token") {
        entry.token = cred.token;
        if (cred.email) {
          entry.email = cred.email;
        }
        if (typeof cred.expires === "number") {
          entry.expires = cred.expires;
        }
      }
      if (cred.type === "oauth") {
        if (cred.access) {
          entry.access = cred.access;
        }
        if (cred.refresh) {
          entry.refresh = cred.refresh;
        }
        if (typeof cred.expires === "number") {
          entry.expires = cred.expires;
        }
        if (cred.email) {
          entry.email = cred.email;
        }
        if (cred.enterpriseUrl) {
          entry.enterpriseUrl = cred.enterpriseUrl;
        }
        if (cred.projectId) {
          entry.projectId = cred.projectId;
        }
        if (cred.accountId) {
          entry.accountId = cred.accountId;
        }
      }
      if (cred.disabled === true) {
        entry.disabled = true;
      }
      if (idx >= 0) {
        providers[provider].credentials[idx] = entry;
      } else {
        providers[provider].credentials.push(entry);
      }
    }
    // Remove deleted profiles from credentials
    for (const [provider, provEntry] of Object.entries(providers)) {
      if (!Array.isArray(provEntry?.credentials)) {
        continue;
      }
      providers[provider].credentials = provEntry.credentials.filter((c) => {
        if (!c?.id) {
          return false;
        }
        return `${provider}:${c.id}` in (store.profiles ?? {});
      });
      if (providers[provider].credentials.length === 0) {
        delete providers[provider].credentials;
      }
    }
    // Sync failover from store.order
    for (const [provider, orderIds] of Object.entries(store.order ?? {})) {
      providers[provider] ??= {};
      providers[provider].failover = orderIds.map((id) =>
        id.includes(":") ? id.split(":").slice(1).join(":") : id,
      );
    }
    await writeConfigFile({ ...cfg, providers }, writeOptions);
  } catch {
    // Non-critical — config sync is best-effort
  }
}
export async function updateAuthProfileStoreWithLock(params) {
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);
  try {
    return await withFileLock(authPath, AUTH_STORE_LOCK_OPTIONS, async () => {
      const store = ensureAuthProfileStore(params.agentDir);
      const shouldSave = params.updater(store);
      if (shouldSave) {
        saveAuthProfileStore(store, params.agentDir);
      }
      return store;
    });
  } catch {
    return null;
  }
}
/**
 * Load the auth profile store.
 * When cfg is provided (post-migration), reads credentials from cfg.providers.
 * Falls back to auth-profiles.json for legacy installations.
 * @param {object} [cfg] - optional genosos config; if provided and has providers credentials, uses them
 */
export function loadAuthProfileStore(cfg) {
  // Primary source: cfg.providers (new unified format)
  if (cfg && hasCredentialsInProviders(cfg)) {
    const store = loadAuthProfileStoreFromConfig(cfg);
    syncExternalCliCredentials(store);
    return store;
  }
  // Fallback: auth-profiles.json (legacy / not yet migrated)
  const authPath = resolveAuthStorePath();
  const raw = loadJsonFile(authPath);
  const asStore = coerceAuthStore(raw);
  if (asStore) {
    const synced = syncExternalCliCredentials(asStore);
    if (synced) {
      saveJsonFile(authPath, asStore);
    }
    return asStore;
  }
  const legacyRaw = loadJsonFile(resolveLegacyAuthStorePath());
  const legacy = coerceLegacyStore(legacyRaw);
  if (legacy) {
    const store = {
      version: AUTH_STORE_VERSION,
      profiles: {},
    };
    applyLegacyStore(store, legacy);
    syncExternalCliCredentials(store);
    return store;
  }
  const store = { version: AUTH_STORE_VERSION, profiles: {} };
  syncExternalCliCredentials(store);
  return store;
}
/**
 * Load and ensure the auth profile store.
 * When cfg is provided, prefers cfg.providers as the credential source.
 * @param {string} [agentDir]
 * @param {object} [options]
 * @param {object} [cfg] - optional genosos config; uses providers credentials if present
 */
export function ensureAuthProfileStore(agentDir, options, cfg) {
  // If cfg has credentials in providers, use that directly (new unified format)
  if (cfg && hasCredentialsInProviders(cfg)) {
    return loadAuthProfileStore(cfg);
  }
  const store = loadAuthProfileStoreForAgent(agentDir, options);
  const authPath = resolveAuthStorePath(agentDir);
  const mainAuthPath = resolveAuthStorePath();
  if (!agentDir || authPath === mainAuthPath) {
    return store;
  }
  const mainStore = loadAuthProfileStoreForAgent(undefined, options);
  const merged = mergeAuthProfileStores(mainStore, store);
  return merged;
}
export function saveAuthProfileStore(store, agentDir) {
  const authPath = resolveAuthStorePath(agentDir);
  const payload = {
    version: AUTH_STORE_VERSION,
    profiles: store.profiles,
    order: store.order ?? undefined,
    lastGood: store.lastGood ?? undefined,
    usageStats: store.usageStats ?? undefined,
  };
  saveJsonFile(authPath, payload);
}
