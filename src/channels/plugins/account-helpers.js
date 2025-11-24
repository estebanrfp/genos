import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
export function createAccountListHelpers(channelKey) {
  function listConfiguredAccountIds(cfg) {
    const channel = cfg.channels?.[channelKey];
    const accounts = channel?.accounts;
    if (!accounts || typeof accounts !== "object") {
      return [];
    }
    return Object.keys(accounts).filter(Boolean);
  }
  function listAccountIds(cfg) {
    const ids = listConfiguredAccountIds(cfg);
    if (ids.length === 0) {
      return [DEFAULT_ACCOUNT_ID];
    }
    return ids.toSorted((a, b) => a.localeCompare(b));
  }
  function resolveDefaultAccountId(cfg) {
    const ids = listAccountIds(cfg);
    if (ids.includes(DEFAULT_ACCOUNT_ID)) {
      return DEFAULT_ACCOUNT_ID;
    }
    return ids[0] ?? DEFAULT_ACCOUNT_ID;
  }
  return { listConfiguredAccountIds, listAccountIds, resolveDefaultAccountId };
}
