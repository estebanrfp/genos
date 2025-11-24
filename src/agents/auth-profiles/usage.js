let resolveAuthCooldownConfig = function (params) {
    const defaults = {
      billingBackoffHours: 5,
      billingMaxHours: 24,
      failureWindowHours: 24,
    };
    const resolveHours = (value, fallback) =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
    const cooldowns = params.cfg?.auth?.cooldowns;
    const billingOverride = (() => {
      const map = cooldowns?.billingBackoffHoursByProvider;
      if (!map) {
        return;
      }
      for (const [key, value] of Object.entries(map)) {
        if (normalizeProviderId(key) === params.providerId) {
          return value;
        }
      }
      return;
    })();
    const billingBackoffHours = resolveHours(
      billingOverride ?? cooldowns?.billingBackoffHours,
      defaults.billingBackoffHours,
    );
    const billingMaxHours = resolveHours(cooldowns?.billingMaxHours, defaults.billingMaxHours);
    const failureWindowHours = resolveHours(
      cooldowns?.failureWindowHours,
      defaults.failureWindowHours,
    );
    return {
      billingBackoffMs: billingBackoffHours * 60 * 60 * 1000,
      billingMaxMs: billingMaxHours * 60 * 60 * 1000,
      failureWindowMs: failureWindowHours * 60 * 60 * 1000,
    };
  },
  calculateAuthProfileBillingDisableMsWithConfig = function (params) {
    const normalized = Math.max(1, params.errorCount);
    const baseMs = Math.max(60000, params.baseMs);
    const maxMs = Math.max(baseMs, params.maxMs);
    const exponent = Math.min(normalized - 1, 10);
    const raw = baseMs * 2 ** exponent;
    return Math.min(maxMs, raw);
  },
  computeNextProfileUsageStats = function (params) {
    const windowMs = params.cfgResolved.failureWindowMs;
    const windowExpired =
      typeof params.existing.lastFailureAt === "number" &&
      params.existing.lastFailureAt > 0 &&
      params.now - params.existing.lastFailureAt > windowMs;
    const baseErrorCount = windowExpired ? 0 : (params.existing.errorCount ?? 0);
    const nextErrorCount = baseErrorCount + 1;
    const failureCounts = windowExpired ? {} : { ...params.existing.failureCounts };
    failureCounts[params.reason] = (failureCounts[params.reason] ?? 0) + 1;
    const updatedStats = {
      ...params.existing,
      errorCount: nextErrorCount,
      failureCounts,
      lastFailureAt: params.now,
    };
    if (params.reason === "billing") {
      const billingCount = failureCounts.billing ?? 1;
      const backoffMs = calculateAuthProfileBillingDisableMsWithConfig({
        errorCount: billingCount,
        baseMs: params.cfgResolved.billingBackoffMs,
        maxMs: params.cfgResolved.billingMaxMs,
      });
      updatedStats.disabledUntil = params.now + backoffMs;
      updatedStats.disabledReason = "billing";
    } else if (params.reason === "overloaded") {
      // Short fixed cooldown for transient overload (no escalation)
      updatedStats.cooldownUntil = params.now + 15000;
    } else {
      const backoffMs = calculateAuthProfileCooldownMs(nextErrorCount);
      updatedStats.cooldownUntil = params.now + backoffMs;
    }
    return updatedStats;
  };
import { normalizeProviderId } from "../model-selection.js";
import { saveAuthProfileStore, updateAuthProfileStoreWithLock } from "./store.js";
export function resolveProfileUnusableUntil(stats) {
  const values = [stats.cooldownUntil, stats.disabledUntil]
    .filter((value) => typeof value === "number")
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}
export function isProfileInCooldown(store, profileId) {
  const stats = store.usageStats?.[profileId];
  if (!stats) {
    return false;
  }
  const unusableUntil = resolveProfileUnusableUntil(stats);
  return unusableUntil ? Date.now() < unusableUntil : false;
}
export function getSoonestCooldownExpiry(store, profileIds) {
  let soonest = null;
  for (const id of profileIds) {
    const stats = store.usageStats?.[id];
    if (!stats) {
      continue;
    }
    const until = resolveProfileUnusableUntil(stats);
    if (typeof until !== "number" || !Number.isFinite(until) || until <= 0) {
      continue;
    }
    if (soonest === null || until < soonest) {
      soonest = until;
    }
  }
  return soonest;
}
export function clearExpiredCooldowns(store, now) {
  const usageStats = store.usageStats;
  if (!usageStats) {
    return false;
  }
  const ts = now ?? Date.now();
  let mutated = false;
  for (const [profileId, stats] of Object.entries(usageStats)) {
    if (!stats) {
      continue;
    }
    let profileMutated = false;
    const cooldownExpired =
      typeof stats.cooldownUntil === "number" &&
      Number.isFinite(stats.cooldownUntil) &&
      stats.cooldownUntil > 0 &&
      ts >= stats.cooldownUntil;
    const disabledExpired =
      typeof stats.disabledUntil === "number" &&
      Number.isFinite(stats.disabledUntil) &&
      stats.disabledUntil > 0 &&
      ts >= stats.disabledUntil;
    if (cooldownExpired) {
      stats.cooldownUntil = undefined;
      profileMutated = true;
    }
    if (disabledExpired) {
      stats.disabledUntil = undefined;
      stats.disabledReason = undefined;
      profileMutated = true;
    }
    if (profileMutated && !resolveProfileUnusableUntil(stats)) {
      stats.errorCount = 0;
      stats.failureCounts = undefined;
    }
    if (profileMutated) {
      usageStats[profileId] = stats;
      mutated = true;
    }
  }
  return mutated;
}
export async function markAuthProfileUsed(params) {
  const { store, profileId, agentDir } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      if (!freshStore.profiles[profileId]) {
        return false;
      }
      freshStore.usageStats = freshStore.usageStats ?? {};
      freshStore.usageStats[profileId] = {
        ...freshStore.usageStats[profileId],
        lastUsed: Date.now(),
        errorCount: 0,
        cooldownUntil: undefined,
        disabledUntil: undefined,
        disabledReason: undefined,
        failureCounts: undefined,
      };
      return true;
    },
  });
  if (updated) {
    store.usageStats = updated.usageStats;
    return;
  }
  if (!store.profiles[profileId]) {
    return;
  }
  store.usageStats = store.usageStats ?? {};
  store.usageStats[profileId] = {
    ...store.usageStats[profileId],
    lastUsed: Date.now(),
    errorCount: 0,
    cooldownUntil: undefined,
    disabledUntil: undefined,
    disabledReason: undefined,
    failureCounts: undefined,
  };
  saveAuthProfileStore(store, agentDir);
}
export function calculateAuthProfileCooldownMs(errorCount) {
  const normalized = Math.max(1, errorCount);
  return Math.min(3600000, 60000 * 5 ** Math.min(normalized - 1, 3));
}
export function resolveProfileUnusableUntilForDisplay(store, profileId) {
  const stats = store.usageStats?.[profileId];
  if (!stats) {
    return null;
  }
  return resolveProfileUnusableUntil(stats);
}
export async function markAuthProfileFailure(params) {
  const { store, profileId, reason, agentDir, cfg } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      const profile = freshStore.profiles[profileId];
      if (!profile) {
        return false;
      }
      freshStore.usageStats = freshStore.usageStats ?? {};
      const existing = freshStore.usageStats[profileId] ?? {};
      const now = Date.now();
      const providerKey = normalizeProviderId(profile.provider);
      const cfgResolved = resolveAuthCooldownConfig({
        cfg,
        providerId: providerKey,
      });
      freshStore.usageStats[profileId] = computeNextProfileUsageStats({
        existing,
        now,
        reason,
        cfgResolved,
      });
      return true;
    },
  });
  if (updated) {
    store.usageStats = updated.usageStats;
    return;
  }
  if (!store.profiles[profileId]) {
    return;
  }
  store.usageStats = store.usageStats ?? {};
  const existing = store.usageStats[profileId] ?? {};
  const now = Date.now();
  const providerKey = normalizeProviderId(store.profiles[profileId]?.provider ?? "");
  const cfgResolved = resolveAuthCooldownConfig({
    cfg,
    providerId: providerKey,
  });
  store.usageStats[profileId] = computeNextProfileUsageStats({
    existing,
    now,
    reason,
    cfgResolved,
  });
  saveAuthProfileStore(store, agentDir);
}
export async function markAuthProfileCooldown(params) {
  await markAuthProfileFailure({
    store: params.store,
    profileId: params.profileId,
    reason: "unknown",
    agentDir: params.agentDir,
  });
}
export async function clearAuthProfileCooldown(params) {
  const { store, profileId, agentDir } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      if (!freshStore.usageStats?.[profileId]) {
        return false;
      }
      freshStore.usageStats[profileId] = {
        ...freshStore.usageStats[profileId],
        errorCount: 0,
        cooldownUntil: undefined,
      };
      return true;
    },
  });
  if (updated) {
    store.usageStats = updated.usageStats;
    return;
  }
  if (!store.usageStats?.[profileId]) {
    return;
  }
  store.usageStats[profileId] = {
    ...store.usageStats[profileId],
    errorCount: 0,
    cooldownUntil: undefined,
  };
  saveAuthProfileStore(store, agentDir);
}
