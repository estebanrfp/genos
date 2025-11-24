let listConfiguredAccountIds = function (cfg) {
    const accounts = cfg.channels?.telegram?.accounts;
    if (!accounts || typeof accounts !== "object") {
      return [];
    }
    const ids = new Set();
    for (const key of Object.keys(accounts)) {
      if (!key) {
        continue;
      }
      ids.add(normalizeAccountId(key));
    }
    return [...ids];
  },
  resolveAccountConfig = function (cfg, accountId) {
    const accounts = cfg.channels?.telegram?.accounts;
    if (!accounts || typeof accounts !== "object") {
      return;
    }
    const direct = accounts[accountId];
    if (direct) {
      return direct;
    }
    const normalized = normalizeAccountId(accountId);
    const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
    return matchKey ? accounts[matchKey] : undefined;
  },
  mergeTelegramAccountConfig = function (cfg, accountId) {
    const { accounts: _ignored, ...base } = cfg.channels?.telegram ?? {};
    const account = resolveAccountConfig(cfg, accountId) ?? {};
    return { ...base, ...account };
  };
import { createAccountActionGate } from "../channels/plugins/account-action-gate.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { listBoundAccountIds, resolveDefaultAgentBoundAccountId } from "../routing/bindings.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import { resolveTelegramToken } from "./token.js";
const debugAccounts = (...args) => {
  if (isTruthyEnvValue(process.env.GENOS_DEBUG_TELEGRAM_ACCOUNTS)) {
    console.warn("[telegram:accounts]", ...args);
  }
};
export function listTelegramAccountIds(cfg) {
  const ids = Array.from(
    new Set([...listConfiguredAccountIds(cfg), ...listBoundAccountIds(cfg, "telegram")]),
  );
  debugAccounts("listTelegramAccountIds", ids);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}
export function resolveDefaultTelegramAccountId(cfg) {
  const boundDefault = resolveDefaultAgentBoundAccountId(cfg, "telegram");
  if (boundDefault) {
    return boundDefault;
  }
  const ids = listTelegramAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}
export function createTelegramActionGate(params) {
  const accountId = normalizeAccountId(params.accountId);
  return createAccountActionGate({
    baseActions: params.cfg.channels?.telegram?.actions,
    accountActions: resolveAccountConfig(params.cfg, accountId)?.actions,
  });
}
export function resolveTelegramAccount(params) {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.telegram?.enabled !== false;
  const resolve = (accountId) => {
    const merged = mergeTelegramAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const tokenResolution = resolveTelegramToken(params.cfg, { accountId });
    debugAccounts("resolve", {
      accountId,
      enabled,
      tokenSource: tokenResolution.source,
    });
    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      token: tokenResolution.token,
      tokenSource: tokenResolution.source,
      config: merged,
    };
  };
  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.tokenSource !== "none") {
    return primary;
  }
  const fallbackId = resolveDefaultTelegramAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  if (fallback.tokenSource === "none") {
    return primary;
  }
  return fallback;
}
export function listEnabledTelegramAccounts(cfg) {
  return listTelegramAccountIds(cfg)
    .map((accountId) => resolveTelegramAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
