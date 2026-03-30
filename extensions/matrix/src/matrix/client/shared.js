let buildSharedClientKey = function (auth, accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  return [
    auth.homeserver,
    auth.userId,
    auth.accessToken,
    auth.encryption ? "e2ee" : "plain",
    normalizedAccountId || DEFAULT_ACCOUNT_KEY,
  ].join("|");
};
import { LogService } from "@vector-im/matrix-bot-sdk";
import { normalizeAccountId } from "genosos/plugin-sdk/account-id";
import { resolveMatrixAuth } from "./config.js";
import { createMatrixClient } from "./create-client.js";
import { DEFAULT_ACCOUNT_KEY } from "./storage.js";
const sharedClientStates = new Map();
const sharedClientPromises = new Map();
const sharedClientStartPromises = new Map();
async function createSharedMatrixClient(params) {
  const client = await createMatrixClient({
    homeserver: params.auth.homeserver,
    userId: params.auth.userId,
    accessToken: params.auth.accessToken,
    encryption: params.auth.encryption,
    localTimeoutMs: params.timeoutMs,
    accountId: params.accountId,
  });
  return {
    client,
    key: buildSharedClientKey(params.auth, params.accountId),
    started: false,
    cryptoReady: false,
  };
}
async function ensureSharedClientStarted(params) {
  if (params.state.started) {
    return;
  }
  const key = params.state.key;
  const existingStartPromise = sharedClientStartPromises.get(key);
  if (existingStartPromise) {
    await existingStartPromise;
    return;
  }
  const startPromise = (async () => {
    const client = params.state.client;
    if (params.encryption && !params.state.cryptoReady) {
      try {
        const joinedRooms = await client.getJoinedRooms();
        if (client.crypto) {
          await client.crypto.prepare(joinedRooms);
          params.state.cryptoReady = true;
        }
      } catch (err) {
        LogService.warn("MatrixClientLite", "Failed to prepare crypto:", err);
      }
    }
    await client.start();
    params.state.started = true;
  })();
  sharedClientStartPromises.set(key, startPromise);
  try {
    await startPromise;
  } finally {
    sharedClientStartPromises.delete(key);
  }
}
export async function resolveSharedMatrixClient(params = {}) {
  const accountId = normalizeAccountId(params.accountId);
  const auth =
    params.auth ?? (await resolveMatrixAuth({ cfg: params.cfg, env: params.env, accountId }));
  const key = buildSharedClientKey(auth, accountId);
  const shouldStart = params.startClient !== false;
  const existingState = sharedClientStates.get(key);
  if (existingState) {
    if (shouldStart) {
      await ensureSharedClientStarted({
        state: existingState,
        timeoutMs: params.timeoutMs,
        initialSyncLimit: auth.initialSyncLimit,
        encryption: auth.encryption,
      });
    }
    return existingState.client;
  }
  const existingPromise = sharedClientPromises.get(key);
  if (existingPromise) {
    const pending = await existingPromise;
    if (shouldStart) {
      await ensureSharedClientStarted({
        state: pending,
        timeoutMs: params.timeoutMs,
        initialSyncLimit: auth.initialSyncLimit,
        encryption: auth.encryption,
      });
    }
    return pending.client;
  }
  const createPromise = createSharedMatrixClient({
    auth,
    timeoutMs: params.timeoutMs,
    accountId,
  });
  sharedClientPromises.set(key, createPromise);
  try {
    const created = await createPromise;
    sharedClientStates.set(key, created);
    if (shouldStart) {
      await ensureSharedClientStarted({
        state: created,
        timeoutMs: params.timeoutMs,
        initialSyncLimit: auth.initialSyncLimit,
        encryption: auth.encryption,
      });
    }
    return created.client;
  } finally {
    sharedClientPromises.delete(key);
  }
}
export async function waitForMatrixSync(_params) {}
export function stopSharedClient(key) {
  if (key) {
    const state = sharedClientStates.get(key);
    if (state) {
      state.client.stop();
      sharedClientStates.delete(key);
    }
  } else {
    for (const state of sharedClientStates.values()) {
      state.client.stop();
    }
    sharedClientStates.clear();
  }
}
export function stopSharedClientForAccount(auth, accountId) {
  const key = buildSharedClientKey(auth, normalizeAccountId(accountId));
  stopSharedClient(key);
}
