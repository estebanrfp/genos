let sanitizeUserIdList = function (input, label) {
  if (input == null) {
    return [];
  }
  if (!Array.isArray(input)) {
    LogService.warn(
      "MatrixClientLite",
      `Expected ${label} list to be an array, got ${typeof input}`,
    );
    return [];
  }
  const filtered = input.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
  if (filtered.length !== input.length) {
    LogService.warn(
      "MatrixClientLite",
      `Dropping ${input.length - filtered.length} invalid ${label} entries from sync payload`,
    );
  }
  return filtered;
};
import fs from "node:fs";
import {
  LogService,
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
} from "@vector-im/matrix-bot-sdk";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";
import {
  maybeMigrateLegacyStorage,
  resolveMatrixStoragePaths,
  writeStorageMeta,
} from "./storage.js";
export async function createMatrixClient(params) {
  ensureMatrixSdkLoggingConfigured();
  const env = process.env;
  const storagePaths = resolveMatrixStoragePaths({
    homeserver: params.homeserver,
    userId: params.userId,
    accessToken: params.accessToken,
    accountId: params.accountId,
    env,
  });
  maybeMigrateLegacyStorage({ storagePaths, env });
  fs.mkdirSync(storagePaths.rootDir, { recursive: true });
  const storage = new SimpleFsStorageProvider(storagePaths.storagePath);
  let cryptoStorage;
  if (params.encryption) {
    fs.mkdirSync(storagePaths.cryptoPath, { recursive: true });
    try {
      const { StoreType } = await import("@matrix-org/matrix-sdk-crypto-nodejs");
      cryptoStorage = new RustSdkCryptoStorageProvider(storagePaths.cryptoPath, StoreType.Sqlite);
    } catch (err) {
      LogService.warn(
        "MatrixClientLite",
        "Failed to initialize crypto storage, E2EE disabled:",
        err,
      );
    }
  }
  writeStorageMeta({
    storagePaths,
    homeserver: params.homeserver,
    userId: params.userId,
    accountId: params.accountId,
  });
  const client = new MatrixClient(params.homeserver, params.accessToken, storage, cryptoStorage);
  if (client.crypto) {
    const originalUpdateSyncData = client.crypto.updateSyncData.bind(client.crypto);
    client.crypto.updateSyncData = async (
      toDeviceMessages,
      otkCounts,
      unusedFallbackKeyAlgs,
      changedDeviceLists,
      leftDeviceLists,
    ) => {
      const safeChanged = sanitizeUserIdList(changedDeviceLists, "changed device list");
      const safeLeft = sanitizeUserIdList(leftDeviceLists, "left device list");
      try {
        return await originalUpdateSyncData(
          toDeviceMessages,
          otkCounts,
          unusedFallbackKeyAlgs,
          safeChanged,
          safeLeft,
        );
      } catch (err) {
        const message = typeof err === "string" ? err : err instanceof Error ? err.message : "";
        if (message.includes("Expect value to be String")) {
          LogService.warn(
            "MatrixClientLite",
            "Ignoring malformed device list entries during crypto sync",
            message,
          );
          return;
        }
        throw err;
      }
    };
  }
  return client;
}
