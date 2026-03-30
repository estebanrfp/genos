let resolveAccountKey = function (accountId) {
  return accountId ?? "default";
};
const MAX_PRESENCE_PER_ACCOUNT = 5000;
const presenceCache = new Map();
export function setPresence(accountId, userId, data) {
  const accountKey = resolveAccountKey(accountId);
  let accountCache = presenceCache.get(accountKey);
  if (!accountCache) {
    accountCache = new Map();
    presenceCache.set(accountKey, accountCache);
  }
  accountCache.set(userId, data);
  if (accountCache.size > MAX_PRESENCE_PER_ACCOUNT) {
    const oldest = accountCache.keys().next().value;
    if (oldest !== undefined) {
      accountCache.delete(oldest);
    }
  }
}
export function getPresence(accountId, userId) {
  return presenceCache.get(resolveAccountKey(accountId))?.get(userId);
}
export function clearPresences(accountId) {
  if (accountId) {
    presenceCache.delete(resolveAccountKey(accountId));
    return;
  }
  presenceCache.clear();
}
export function presenceCacheSize() {
  let total = 0;
  for (const accountCache of presenceCache.values()) {
    total += accountCache.size;
  }
  return total;
}
