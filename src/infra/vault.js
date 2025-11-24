// GenosOS — Esteban & Nyx 🦀🌙
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";
import {
  PBKDF2_SALT_BYTES,
  resolvePassphrase,
  deriveKey,
  encryptJSON,
  decryptJSON,
} from "./crypto-utils.js";

const VAULT_FILENAME = "vault.enc";

/** @typedef {{ value: string, createdAt: string, updatedAt: string }} SecretEntry */
/** @typedef {{ secrets: Record<string, SecretEntry> }} VaultPayload */

/**
 * In-memory vault handle returned by initVault.
 * @typedef {object} VaultHandle
 * @property {(key: string) => SecretEntry | null} getSecret
 * @property {(key: string, value: string) => void} setSecret
 * @property {() => string[]} listSecrets
 * @property {(key: string) => boolean} deleteSecret
 */

/**
 * Check whether a vault.enc file exists in the given state directory.
 * @param {string} [stateDir]
 * @returns {boolean}
 */
export const vaultExists = (stateDir = STATE_DIR) =>
  fs.existsSync(path.join(stateDir, VAULT_FILENAME));

/**
 * Initialize the vault — derive key, load existing vault or start empty.
 * @param {string} [passphrase] - Explicit passphrase (falls back to env / .env).
 * @param {string} [stateDir] - Override state directory (useful for tests).
 * @returns {VaultHandle}
 */
export const initVault = (passphrase, stateDir = STATE_DIR) => {
  const resolvedPass = resolvePassphrase(passphrase, stateDir);
  const vaultPath = path.join(stateDir, VAULT_FILENAME);

  let salt;
  /** @type {VaultPayload} */
  let payload;
  let key;

  if (fs.existsSync(vaultPath)) {
    const raw = JSON.parse(fs.readFileSync(vaultPath, "utf-8"));
    salt = Buffer.from(raw.salt, "hex");
    key = deriveKey(resolvedPass, salt);
    payload = decryptJSON(raw, key);
  } else {
    salt = randomBytes(PBKDF2_SALT_BYTES);
    key = deriveKey(resolvedPass, salt);
    payload = { secrets: {} };
  }

  /** Encrypt + flush to disk. */
  const flush = () => {
    const envelope = encryptJSON(payload, key);
    const disk = { salt: salt.toString("hex"), ...envelope };
    fs.writeFileSync(vaultPath, JSON.stringify(disk, null, 2), { mode: 0o600 });
  };

  return {
    /** @param {string} k */
    getSecret: (k) => payload.secrets[k] ?? null,

    /**
     * @param {string} k
     * @param {string} v
     */
    setSecret: (k, v) => {
      const now = new Date().toISOString();
      const existing = payload.secrets[k];
      payload.secrets[k] = {
        value: v,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      flush();
    },

    listSecrets: () => Object.keys(payload.secrets),

    /** @param {string} k */
    deleteSecret: (k) => {
      if (!(k in payload.secrets)) {
        return false;
      }
      delete payload.secrets[k];
      flush();
      return true;
    },
  };
};

/**
 * Convenience: get a single secret value.
 * @param {string} key
 * @param {string} [passphrase]
 * @param {string} [stateDir]
 * @returns {SecretEntry | null}
 */
export const getSecret = (key, passphrase, stateDir) =>
  initVault(passphrase, stateDir).getSecret(key);

/**
 * Convenience: set (upsert) a secret.
 * @param {string} key
 * @param {string} value
 * @param {string} [passphrase]
 * @param {string} [stateDir]
 */
export const setSecret = (key, value, passphrase, stateDir) =>
  initVault(passphrase, stateDir).setSecret(key, value);

/**
 * Convenience: list all secret keys.
 * @param {string} [passphrase]
 * @param {string} [stateDir]
 * @returns {string[]}
 */
export const listSecrets = (passphrase, stateDir) => initVault(passphrase, stateDir).listSecrets();

/**
 * Convenience: delete a secret.
 * @param {string} key
 * @param {string} [passphrase]
 * @param {string} [stateDir]
 * @returns {boolean}
 */
export const deleteSecret = (key, passphrase, stateDir) =>
  initVault(passphrase, stateDir).deleteSecret(key);
