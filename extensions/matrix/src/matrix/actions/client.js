import { normalizeAccountId } from "genosos/plugin-sdk/account-id";
import { getMatrixRuntime } from "../../runtime.js";
import { getActiveMatrixClient } from "../active-client.js";
import { createPreparedMatrixClient } from "../client-bootstrap.js";
import { isBunRuntime, resolveMatrixAuth, resolveSharedMatrixClient } from "../client.js";
export function ensureNodeRuntime() {
  if (isBunRuntime()) {
    throw new Error("Matrix support requires Node (bun runtime not supported)");
  }
}
export async function resolveActionClient(opts = {}) {
  ensureNodeRuntime();
  if (opts.client) {
    return { client: opts.client, stopOnDone: false };
  }
  const accountId = normalizeAccountId(opts.accountId);
  const active = getActiveMatrixClient(accountId);
  if (active) {
    return { client: active, stopOnDone: false };
  }
  const shouldShareClient = Boolean(process.env.GENOS_GATEWAY_PORT);
  if (shouldShareClient) {
    const client = await resolveSharedMatrixClient({
      cfg: getMatrixRuntime().config.loadConfig(),
      timeoutMs: opts.timeoutMs,
      accountId,
    });
    return { client, stopOnDone: false };
  }
  const auth = await resolveMatrixAuth({
    cfg: getMatrixRuntime().config.loadConfig(),
    accountId,
  });
  const client = await createPreparedMatrixClient({
    auth,
    timeoutMs: opts.timeoutMs,
    accountId,
  });
  return { client, stopOnDone: true };
}
