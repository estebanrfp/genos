import { resolveGenosOSAgentDir } from "../../agents/agent-paths.js";
import { upsertAuthProfileWithLock } from "../../agents/auth-profiles/profiles.js";
import {
  ensureAuthProfileStore,
  hasCredentialsInProviders,
  loadAuthProfileStoreFromConfig,
  updateAuthProfileStoreWithLock,
  updateProvidersInConfig,
} from "../../agents/auth-profiles/store.js";
import { readConfigFileSnapshotForWrite, writeConfigFile } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  validateAuthProfilesDeleteParams,
  validateAuthProfilesSetDisabledParams,
  validateAuthProfilesSetParams,
} from "../protocol/index.js";
import { __resetModelCatalogCacheForTest as resetModelCatalogCache } from "../server-model-catalog.js";

/**
 * Check if the current config uses the new providers format (post-migration).
 * @returns {Promise<boolean>}
 */
async function isUsingProvidersFormat() {
  try {
    const { snapshot } = await readConfigFileSnapshotForWrite();
    return hasCredentialsInProviders(snapshot.config ?? {});
  } catch {
    return false;
  }
}

/**
 * Auto-sync auth.profiles and auth.order in genosos.json when a credential is added.
 * - auth.profiles[profileId] drives contextPruning defaults (mode metadata, no secrets)
 * - auth.order[provider] drives failover priority
 * Non-critical: errors are swallowed so credential save always succeeds.
 * @param {string} provider
 * @param {string} profileId
 * @param {"api_key"|"token"} type
 */
async function autoSyncConfigOnSet(provider, profileId, type) {
  try {
    const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
    const cfg = snapshot.config ?? {};
    // Sync auth.profiles — mode metadata used by pruning defaults (no secret stored here)
    const mode = type === "token" ? "token" : "api_key";
    const currentProfiles = cfg.auth?.profiles ?? {};
    const existingProfile = currentProfiles[profileId];
    const profileNeedsUpdate = !existingProfile || existingProfile.mode !== mode;
    // Sync auth.order — failover priority
    const currentOrder = Array.isArray(cfg.auth?.order?.[provider]) ? cfg.auth.order[provider] : [];
    const orderNeedsUpdate = !currentOrder.includes(profileId);
    if (!profileNeedsUpdate && !orderNeedsUpdate) {
      return;
    }
    const updatedCfg = {
      ...cfg,
      auth: {
        ...cfg.auth,
        profiles: profileNeedsUpdate
          ? { ...currentProfiles, [profileId]: { provider, mode } }
          : currentProfiles,
        order: orderNeedsUpdate
          ? { ...cfg.auth?.order, [provider]: [...currentOrder, profileId] }
          : cfg.auth?.order,
      },
    };
    await writeConfigFile(updatedCfg, writeOptions);
  } catch {
    // Non-critical — config sync is best-effort
  }
}

/**
 * Remove profileId from auth.profiles and auth.order when a credential is deleted.
 * Non-critical: errors are swallowed.
 * @param {string} provider
 * @param {string} profileId
 */
async function autoSyncConfigOnDelete(provider, profileId) {
  try {
    const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
    const cfg = snapshot.config ?? {};
    // Remove from auth.profiles
    const currentProfiles = { ...cfg.auth?.profiles };
    const hadProfile = profileId in currentProfiles;
    if (hadProfile) {
      delete currentProfiles[profileId];
    }
    // Remove from auth.order
    const currentOrder = Array.isArray(cfg.auth?.order?.[provider]) ? cfg.auth.order[provider] : [];
    const nextOrder = currentOrder.filter((id) => id !== profileId);
    const orderChanged = nextOrder.length !== currentOrder.length;
    if (!hadProfile && !orderChanged) {
      return;
    }
    const updatedOrder = orderChanged
      ? { ...cfg.auth?.order, [provider]: nextOrder }
      : cfg.auth?.order;
    if (orderChanged && nextOrder.length === 0) {
      delete updatedOrder[provider];
    }
    const updatedCfg = {
      ...cfg,
      auth: {
        ...cfg.auth,
        profiles: Object.keys(currentProfiles).length > 0 ? currentProfiles : undefined,
        order: updatedOrder && Object.keys(updatedOrder).length > 0 ? updatedOrder : undefined,
      },
    };
    await writeConfigFile(updatedCfg, writeOptions);
  } catch {
    // Non-critical
  }
}

/**
 * Mask a secret value for safe display.
 * Shows first 6 chars + "..." + last 4 chars, or bullets if too short.
 * @param {string} value
 * @returns {string}
 */
function maskValue(value) {
  if (!value || value.length <= 10) {
    return "●●●●●●●●";
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/** @type {(ctx: {respond: Function}) => Promise<void>} */
const handleList = async ({ respond }) => {
  try {
    const usingProviders = await isUsingProvidersFormat();
    const store = usingProviders
      ? loadAuthProfileStoreFromConfig(
          (await readConfigFileSnapshotForWrite()).snapshot.config ?? {},
        )
      : ensureAuthProfileStore();
    const profiles = Object.entries(store.profiles ?? {}).map(([profileId, cred]) => {
      const raw =
        cred.type === "api_key"
          ? (cred.key ?? "")
          : cred.type === "token"
            ? (cred.token ?? "")
            : cred.type === "oauth"
              ? (cred.access ?? "")
              : "";
      return {
        profileId,
        provider: cred.provider ?? "",
        type: cred.type ?? "api_key",
        maskedValue: maskValue(raw),
        ...(cred.email ? { email: cred.email } : {}),
        ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
        ...(cred.disabled === true ? { disabled: true } : {}),
      };
    });
    respond(true, { profiles }, undefined);
  } catch (err) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
  }
};

/** @type {(ctx: {params: object, respond: Function}) => Promise<void>} */
const handleSet = async ({ params, respond }) => {
  if (!validateAuthProfilesSetParams(params)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid providers.set params"),
    );
    return;
  }
  try {
    const agentDir = resolveGenosOSAgentDir();
    const provider = params.provider.toLowerCase().trim();
    const profileId = params.profileId?.trim() || `${provider}:default`;
    const credential =
      params.type === "api_key"
        ? { type: "api_key", provider, key: params.value }
        : { type: "token", provider, token: params.value };
    const usingProviders = await isUsingProvidersFormat();
    if (usingProviders) {
      await updateProvidersInConfig((store) => {
        store.profiles[profileId] = credential;
        store.order ??= {};
        store.order[provider] ??= [];
        if (!store.order[provider].includes(profileId)) {
          store.order[provider].push(profileId);
        }
        return true;
      });
    } else {
      await upsertAuthProfileWithLock({ agentDir, profileId, credential });
      await autoSyncConfigOnSet(provider, profileId, params.type);
    }
    resetModelCatalogCache();
    respond(true, { ok: true, profileId }, undefined);
  } catch (err) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
  }
};

/** @type {(ctx: {params: object, respond: Function}) => Promise<void>} */
const handleSetDisabled = async ({ params, respond }) => {
  if (!validateAuthProfilesSetDisabledParams(params)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid providers.setDisabled params"),
    );
    return;
  }
  try {
    const agentDir = resolveGenosOSAgentDir();
    const usingProviders = await isUsingProvidersFormat();
    if (usingProviders) {
      await updateProvidersInConfig((store) => {
        const cred = store.profiles[params.profileId];
        if (!cred) {
          return false;
        }
        if (params.disabled) {
          cred.disabled = true;
        } else {
          delete cred.disabled;
        }
        return true;
      });
    } else {
      await updateAuthProfileStoreWithLock({
        agentDir,
        updater: (store) => {
          const cred = store.profiles[params.profileId];
          if (!cred) {
            return false;
          }
          if (params.disabled) {
            cred.disabled = true;
          } else {
            delete cred.disabled;
          }
          return true;
        },
      });
    }
    respond(true, { ok: true, profileId: params.profileId, disabled: params.disabled }, undefined);
  } catch (err) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
  }
};

/** @type {(ctx: {params: object, respond: Function}) => Promise<void>} */
const handleDelete = async ({ params, respond }) => {
  if (!validateAuthProfilesDeleteParams(params)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid providers.delete params"),
    );
    return;
  }
  try {
    const agentDir = resolveGenosOSAgentDir();
    const usingProviders = await isUsingProvidersFormat();
    if (usingProviders) {
      await updateProvidersInConfig((store) => {
        if (!store.profiles?.[params.profileId]) {
          return false;
        }
        delete store.profiles[params.profileId];
        if (store.order) {
          for (const provider of Object.keys(store.order)) {
            store.order[provider] = (store.order[provider] ?? []).filter(
              (id) => id !== params.profileId,
            );
            if (store.order[provider].length === 0) {
              delete store.order[provider];
            }
          }
          if (Object.keys(store.order).length === 0) {
            store.order = undefined;
          }
        }
        return true;
      });
    } else {
      let deletedProvider = null;
      await updateAuthProfileStoreWithLock({
        agentDir,
        updater: (store) => {
          if (!store.profiles?.[params.profileId]) {
            return false;
          }
          deletedProvider = store.profiles[params.profileId]?.provider ?? null;
          delete store.profiles[params.profileId];
          if (store.order) {
            for (const provider of Object.keys(store.order)) {
              store.order[provider] = (store.order[provider] ?? []).filter(
                (id) => id !== params.profileId,
              );
              if (store.order[provider].length === 0) {
                delete store.order[provider];
              }
            }
            if (Object.keys(store.order).length === 0) {
              store.order = undefined;
            }
          }
          if (store.lastGood) {
            for (const [provider, id] of Object.entries(store.lastGood)) {
              if (id === params.profileId) {
                delete store.lastGood[provider];
              }
            }
            if (Object.keys(store.lastGood).length === 0) {
              store.lastGood = undefined;
            }
          }
          return true;
        },
      });
      if (deletedProvider) {
        await autoSyncConfigOnDelete(deletedProvider, params.profileId);
      }
    }
    resetModelCatalogCache();
    respond(true, { ok: true, profileId: params.profileId }, undefined);
  } catch (err) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
  }
};

export const authProfilesHandlers = {
  // Primary names (new)
  "providers.list": handleList,
  "providers.set": handleSet,
  "providers.setDisabled": handleSetDisabled,
  "providers.delete": handleDelete,
  // Legacy aliases (backward compat)
  "auth.profiles.list": handleList,
  "auth.profiles.set": handleSet,
  "auth.profiles.setDisabled": handleSetDisabled,
  "auth.profiles.delete": handleDelete,
};
