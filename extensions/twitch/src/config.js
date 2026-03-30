export const DEFAULT_ACCOUNT_ID = "default";
export function getAccountConfig(coreConfig, accountId) {
  if (!coreConfig || typeof coreConfig !== "object") {
    return null;
  }
  const cfg = coreConfig;
  const twitch = cfg.channels?.twitch;
  const twitchRaw = twitch;
  const accounts = twitchRaw?.accounts;
  if (accountId === DEFAULT_ACCOUNT_ID) {
    const accountFromAccounts = accounts?.[DEFAULT_ACCOUNT_ID];
    const baseLevel = {
      username: typeof twitchRaw?.username === "string" ? twitchRaw.username : undefined,
      accessToken: typeof twitchRaw?.accessToken === "string" ? twitchRaw.accessToken : undefined,
      clientId: typeof twitchRaw?.clientId === "string" ? twitchRaw.clientId : undefined,
      channel: typeof twitchRaw?.channel === "string" ? twitchRaw.channel : undefined,
      enabled: typeof twitchRaw?.enabled === "boolean" ? twitchRaw.enabled : undefined,
      allowFrom: Array.isArray(twitchRaw?.allowFrom) ? twitchRaw.allowFrom : undefined,
      allowedRoles: Array.isArray(twitchRaw?.allowedRoles) ? twitchRaw.allowedRoles : undefined,
      requireMention:
        typeof twitchRaw?.requireMention === "boolean" ? twitchRaw.requireMention : undefined,
      clientSecret:
        typeof twitchRaw?.clientSecret === "string" ? twitchRaw.clientSecret : undefined,
      refreshToken:
        typeof twitchRaw?.refreshToken === "string" ? twitchRaw.refreshToken : undefined,
      expiresIn: typeof twitchRaw?.expiresIn === "number" ? twitchRaw.expiresIn : undefined,
      obtainmentTimestamp:
        typeof twitchRaw?.obtainmentTimestamp === "number"
          ? twitchRaw.obtainmentTimestamp
          : undefined,
    };
    const merged = {
      ...accountFromAccounts,
      ...baseLevel,
    };
    if (merged.username) {
      return merged;
    }
    if (accountFromAccounts) {
      return accountFromAccounts;
    }
    return null;
  }
  if (!accounts || !accounts[accountId]) {
    return null;
  }
  return accounts[accountId];
}
export function listAccountIds(cfg) {
  const twitch = cfg.channels?.twitch;
  const twitchRaw = twitch;
  const accountMap = twitchRaw?.accounts;
  const ids = [];
  if (accountMap) {
    ids.push(...Object.keys(accountMap));
  }
  const hasBaseLevelConfig =
    twitchRaw &&
    (typeof twitchRaw.username === "string" ||
      typeof twitchRaw.accessToken === "string" ||
      typeof twitchRaw.channel === "string");
  if (hasBaseLevelConfig && !ids.includes(DEFAULT_ACCOUNT_ID)) {
    ids.push(DEFAULT_ACCOUNT_ID);
  }
  return ids;
}
