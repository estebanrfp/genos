import { createMatrixClient } from "./client.js";
export async function createPreparedMatrixClient(opts) {
  const client = await createMatrixClient({
    homeserver: opts.auth.homeserver,
    userId: opts.auth.userId,
    accessToken: opts.auth.accessToken,
    encryption: opts.auth.encryption,
    localTimeoutMs: opts.timeoutMs,
    accountId: opts.accountId,
  });
  if (opts.auth.encryption && client.crypto) {
    try {
      const joinedRooms = await client.getJoinedRooms();
      await client.crypto.prepare(joinedRooms);
    } catch {}
  }
  await client.start();
  return client;
}
