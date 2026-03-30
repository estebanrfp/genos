let findAccountConfig = function (accounts, accountId) {
  if (!accounts) return;
  const normalized = normalizeAccountId(accountId);
  if (accounts[normalized]) return accounts[normalized];
  for (const key of Object.keys(accounts)) {
    if (normalizeAccountId(key) === normalized) {
      return accounts[key];
    }
  }
  return;
};
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "genosos/plugin-sdk/account-id";
import { getMatrixRuntime } from "../../runtime.js";
import { getActiveMatrixClient, getAnyActiveMatrixClient } from "../active-client.js";
import { createPreparedMatrixClient } from "../client-bootstrap.js";
import { isBunRuntime, resolveMatrixAuth, resolveSharedMatrixClient } from "../client.js";
const getCore = () => getMatrixRuntime();
export function ensureNodeRuntime() {
  if (isBunRuntime()) {
    throw new Error("Matrix support requires Node (bun runtime not supported)");
  }
}
export function resolveMediaMaxBytes(accountId) {
  const cfg = getCore().config.loadConfig();
  const accountConfig = findAccountConfig(cfg.channels?.matrix?.accounts, accountId ?? "");
  if (typeof accountConfig?.mediaMaxMb === "number") {
    return accountConfig.mediaMaxMb * 1024 * 1024;
  }
  if (typeof cfg.channels?.matrix?.mediaMaxMb === "number") {
    return cfg.channels.matrix.mediaMaxMb * 1024 * 1024;
  }
  return;
}
export async function resolveMatrixClient(opts) {
  ensureNodeRuntime();
  if (opts.client) {
    return { client: opts.client, stopOnDone: false };
  }
  const accountId =
    typeof opts.accountId === "string" && opts.accountId.trim().length > 0
      ? normalizeAccountId(opts.accountId)
      : undefined;
  const active = getActiveMatrixClient(accountId);
  if (active) {
    return { client: active, stopOnDone: false };
  }
  if (!accountId) {
    const defaultClient = getActiveMatrixClient(DEFAULT_ACCOUNT_ID);
    if (defaultClient) {
      return { client: defaultClient, stopOnDone: false };
    }
    const anyActive = getAnyActiveMatrixClient();
    if (anyActive) {
      return { client: anyActive, stopOnDone: false };
    }
  }
  const shouldShareClient = Boolean(process.env.GENOS_GATEWAY_PORT);
  if (shouldShareClient) {
    const client = await resolveSharedMatrixClient({
      timeoutMs: opts.timeoutMs,
      accountId,
    });
    return { client, stopOnDone: false };
  }
  const auth = await resolveMatrixAuth({ accountId });
  const client = await createPreparedMatrixClient({
    auth,
    timeoutMs: opts.timeoutMs,
    accountId,
  });
  return { client, stopOnDone: true };
}
