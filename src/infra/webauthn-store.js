// GenosOS — Esteban & Nyx 🦀🌙
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";
import { secureReadFile, secureWriteFile } from "./secure-io.js";

const CREDENTIALS_FILE = "webauthn-credentials.json";

/**
 * Resolve the credentials file path.
 * @param {string} [stateDir]
 * @returns {string}
 */
const credentialsPath = (stateDir = STATE_DIR) => path.join(stateDir, CREDENTIALS_FILE);

/**
 * Load all stored WebAuthn credentials.
 * @param {string} [stateDir]
 * @returns {Promise<{ credentials: Array, rpId: string, rpName: string }>}
 */
export async function loadCredentials(stateDir = STATE_DIR) {
  try {
    const raw = await secureReadFile(credentialsPath(stateDir));
    const data = JSON.parse(raw);
    return {
      credentials: Array.isArray(data.credentials) ? data.credentials : [],
      rpId: data.rpId ?? "localhost",
      rpName: data.rpName ?? "GenosOS",
    };
  } catch {
    return { credentials: [], rpId: "localhost", rpName: "GenosOS" };
  }
}

/**
 * Save a new WebAuthn credential.
 * @param {object} cred
 * @param {string} [stateDir]
 * @returns {Promise<void>}
 */
export async function saveCredential(cred, stateDir = STATE_DIR) {
  const store = await loadCredentials(stateDir);
  store.credentials.push({
    id: cred.id,
    publicKey: cred.publicKey,
    counter: cred.counter ?? 0,
    displayName: cred.displayName ?? "Touch ID",
    createdAt: new Date().toISOString(),
    transports: cred.transports ?? ["internal"],
  });
  await writeStore(store, stateDir);
}

/**
 * Update a credential's counter after successful auth.
 * @param {string} credentialId
 * @param {number} newCounter
 * @param {string} [stateDir]
 * @returns {Promise<void>}
 */
export async function updateCredentialCounter(credentialId, newCounter, stateDir = STATE_DIR) {
  const store = await loadCredentials(stateDir);
  const cred = store.credentials.find((c) => c.id === credentialId);
  if (cred) {
    cred.counter = newCounter;
    await writeStore(store, stateDir);
  }
}

/**
 * Remove a credential by ID.
 * @param {string} credentialId
 * @param {string} [stateDir]
 * @returns {Promise<boolean>}
 */
export async function removeCredential(credentialId, stateDir = STATE_DIR) {
  const store = await loadCredentials(stateDir);
  const before = store.credentials.length;
  store.credentials = store.credentials.filter((c) => c.id !== credentialId);
  if (store.credentials.length === before) {
    return false;
  }
  await writeStore(store, stateDir);
  return true;
}

/**
 * Rename a credential.
 * @param {string} credentialId
 * @param {string} displayName
 * @param {string} [stateDir]
 * @returns {Promise<boolean>}
 */
export async function renameCredential(credentialId, displayName, stateDir = STATE_DIR) {
  const store = await loadCredentials(stateDir);
  const cred = store.credentials.find((c) => c.id === credentialId);
  if (!cred) {
    return false;
  }
  cred.displayName = displayName;
  await writeStore(store, stateDir);
  return true;
}

/**
 * List all credentials (safe summary).
 * @param {string} [stateDir]
 * @returns {Promise<Array<{ id: string, displayName: string, createdAt: string, transports: string[] }>>}
 */
export async function listCredentials(stateDir = STATE_DIR) {
  const store = await loadCredentials(stateDir);
  return store.credentials.map(({ id, displayName, createdAt, transports }) => ({
    id,
    displayName,
    createdAt,
    transports,
  }));
}

/**
 * Write the full credential store atomically.
 * @param {object} store
 * @param {string} stateDir
 */
async function writeStore(store, stateDir) {
  const filePath = credentialsPath(stateDir);
  const payload = JSON.stringify(store, null, 2) + "\n";
  await secureWriteFile(filePath, payload);
}
