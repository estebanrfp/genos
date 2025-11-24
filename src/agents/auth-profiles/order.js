let orderProfilesByMode = function (order, store) {
  const now = Date.now();
  const available = [];
  const inCooldown = [];
  for (const profileId of order) {
    if (isProfileInCooldown(store, profileId)) {
      inCooldown.push(profileId);
    } else {
      available.push(profileId);
    }
  }
  const scored = available.map((profileId) => {
    const type = store.profiles[profileId]?.type;
    const typeScore = type === "oauth" ? 0 : type === "token" ? 1 : type === "api_key" ? 2 : 3;
    const lastUsed = store.usageStats?.[profileId]?.lastUsed ?? 0;
    return { profileId, typeScore, lastUsed };
  });
  const sorted = scored
    .toSorted((a, b) => {
      if (a.typeScore !== b.typeScore) {
        return a.typeScore - b.typeScore;
      }
      return a.lastUsed - b.lastUsed;
    })
    .map((entry) => entry.profileId);
  const cooldownSorted = inCooldown
    .map((profileId) => ({
      profileId,
      cooldownUntil: resolveProfileUnusableUntil(store.usageStats?.[profileId] ?? {}) ?? now,
    }))
    .toSorted((a, b) => a.cooldownUntil - b.cooldownUntil)
    .map((entry) => entry.profileId);
  return [...sorted, ...cooldownSorted];
};
import { findNormalizedProviderValue, normalizeProviderId } from "../model-selection.js";
import { dedupeProfileIds, listProfilesForProvider } from "./profiles.js";
import {
  clearExpiredCooldowns,
  isProfileInCooldown,
  resolveProfileUnusableUntil,
} from "./usage.js";
export function resolveAuthProfileOrder(params) {
  const { cfg, store, provider, preferredProfile } = params;
  const providerKey = normalizeProviderId(provider);
  const now = Date.now();
  clearExpiredCooldowns(store, now);
  const storedOrder = findNormalizedProviderValue(store.order, providerKey);
  // New: providers[p].failover takes precedence over auth.order
  const providersFailover = findNormalizedProviderValue(cfg?.providers, providerKey)?.failover;
  const providersOrder =
    Array.isArray(providersFailover) && providersFailover.length > 0
      ? providersFailover.map((id) => `${providerKey}:${id}`)
      : undefined;
  const configuredOrder =
    providersOrder ?? findNormalizedProviderValue(cfg?.auth?.order, providerKey);
  const explicitOrder = storedOrder ?? configuredOrder;
  const explicitProfiles = cfg?.auth?.profiles
    ? Object.entries(cfg.auth.profiles)
        .filter(([, profile]) => normalizeProviderId(profile.provider) === providerKey)
        .map(([profileId]) => profileId)
    : [];
  const baseOrder =
    explicitOrder ??
    (explicitProfiles.length > 0 ? explicitProfiles : listProfilesForProvider(store, providerKey));
  if (baseOrder.length === 0) {
    return [];
  }
  const filtered = baseOrder.filter((profileId) => {
    const cred = store.profiles[profileId];
    if (!cred) {
      return false;
    }
    if (cred.disabled === true) {
      return false;
    }
    if (normalizeProviderId(cred.provider) !== providerKey) {
      return false;
    }
    const profileConfig = cfg?.auth?.profiles?.[profileId];
    if (profileConfig) {
      if (normalizeProviderId(profileConfig.provider) !== providerKey) {
        return false;
      }
      if (profileConfig.mode !== cred.type) {
        const oauthCompatible = profileConfig.mode === "oauth" && cred.type === "token";
        if (!oauthCompatible) {
          return false;
        }
      }
    }
    if (cred.type === "api_key") {
      return Boolean(cred.key?.trim());
    }
    if (cred.type === "token") {
      if (!cred.token?.trim()) {
        return false;
      }
      if (
        typeof cred.expires === "number" &&
        Number.isFinite(cred.expires) &&
        cred.expires > 0 &&
        now >= cred.expires
      ) {
        return false;
      }
      return true;
    }
    if (cred.type === "oauth") {
      return Boolean(cred.access?.trim() || cred.refresh?.trim());
    }
    return false;
  });
  const deduped = dedupeProfileIds(filtered);
  if (explicitOrder && explicitOrder.length > 0) {
    const available = [];
    const inCooldown = [];
    for (const profileId of deduped) {
      const cooldownUntil = resolveProfileUnusableUntil(store.usageStats?.[profileId] ?? {}) ?? 0;
      if (
        typeof cooldownUntil === "number" &&
        Number.isFinite(cooldownUntil) &&
        cooldownUntil > 0 &&
        now < cooldownUntil
      ) {
        inCooldown.push({ profileId, cooldownUntil });
      } else {
        available.push(profileId);
      }
    }
    const cooldownSorted = inCooldown
      .toSorted((a, b) => a.cooldownUntil - b.cooldownUntil)
      .map((entry) => entry.profileId);
    const ordered = [...available, ...cooldownSorted];
    if (preferredProfile && ordered.includes(preferredProfile)) {
      return [preferredProfile, ...ordered.filter((e) => e !== preferredProfile)];
    }
    return ordered;
  }
  const sorted = orderProfilesByMode(deduped, store);
  if (preferredProfile && sorted.includes(preferredProfile)) {
    return [preferredProfile, ...sorted.filter((e) => e !== preferredProfile)];
  }
  return sorted;
}
