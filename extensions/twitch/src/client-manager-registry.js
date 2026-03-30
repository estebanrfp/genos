import { TwitchClientManager } from "./twitch-client.js";
const registry = new Map();
export function getOrCreateClientManager(accountId, logger) {
  const existing = registry.get(accountId);
  if (existing) {
    return existing.manager;
  }
  const manager = new TwitchClientManager(logger);
  registry.set(accountId, {
    manager,
    accountId,
    logger,
    createdAt: Date.now(),
  });
  logger.info(`Registered client manager for account: ${accountId}`);
  return manager;
}
export function getClientManager(accountId) {
  return registry.get(accountId)?.manager;
}
export async function removeClientManager(accountId) {
  const entry = registry.get(accountId);
  if (!entry) {
    return;
  }
  await entry.manager.disconnectAll();
  registry.delete(accountId);
  entry.logger.info(`Unregistered client manager for account: ${accountId}`);
}
export async function removeAllClientManagers() {
  const promises = [...registry.keys()].map((accountId) => removeClientManager(accountId));
  await Promise.all(promises);
}
export function getRegisteredClientManagerCount() {
  return registry.size;
}
export function _clearAllClientManagersForTest() {
  registry.clear();
}
