import { loadSessionStore, saveSessionStore } from "./store.js";

const AGENT_PREFIX = "agent:";

/**
 * Migrate session store keys and spawnedBy fields when an agent ID changes.
 * @param {string} storePath - Absolute path to sessions.json
 * @param {string} oldId - Old normalized agent ID
 * @param {string} newId - New normalized agent ID
 * @returns {Promise<{ migratedKeys: number, migratedSpawnedBy: number }>}
 */
export async function migrateSessionStore(storePath, oldId, newId) {
  const oldPrefix = `${AGENT_PREFIX}${oldId}:`;
  const newPrefix = `${AGENT_PREFIX}${newId}:`;
  const store = loadSessionStore(storePath, { skipCache: true });
  const rewritten = {};
  let migratedKeys = 0;
  let migratedSpawnedBy = 0;

  for (const [key, entry] of Object.entries(store)) {
    const newKey = key.startsWith(oldPrefix) ? `${newPrefix}${key.slice(oldPrefix.length)}` : key;
    if (newKey !== key) {
      migratedKeys++;
    }

    // Rewrite spawnedBy if it references the old agent prefix
    if (
      entry?.spawnedBy &&
      typeof entry.spawnedBy === "string" &&
      entry.spawnedBy.startsWith(oldPrefix)
    ) {
      entry.spawnedBy = `${newPrefix}${entry.spawnedBy.slice(oldPrefix.length)}`;
      migratedSpawnedBy++;
    }

    rewritten[newKey] = entry;
  }

  await saveSessionStore(storePath, rewritten, { skipMaintenance: true });
  return { migratedKeys, migratedSpawnedBy };
}
