// GenosOS — Esteban & Nyx 🦀🌙
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";
import { keychainGet } from "./keychain.js";

export const KEYCHAIN_SERVICE = "com.genos.vault";
export const KEYCHAIN_ACCOUNT = "passphrase";

/**
 * Zero out a Buffer to prevent key material from lingering in heap.
 * @param {Buffer | null | undefined} buf
 */
export const zeroBuffer = (buf) => {
  if (Buffer.isBuffer(buf)) {
    buf.fill(0);
  }
};

export const PBKDF2_SALT_BYTES = 32;
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_DIGEST = "sha512";
export const PBKDF2_KEY_BYTES = 32;
export const AES_IV_BYTES = 12;
export const ALGORITHM = "aes-256-gcm";

/**
 * Resolve the vault passphrase from explicit arg, env, or .env file.
 * @param {string} [explicit] - Passphrase passed directly.
 * @param {string} [stateDir] - State directory to search for .env.
 * @returns {string}
 */
export const resolvePassphrase = (explicit, stateDir = STATE_DIR) => {
  if (explicit) {
    return explicit;
  }
  if (process.env.VAULT_PASSPHRASE) {
    return process.env.VAULT_PASSPHRASE;
  }

  // macOS Keychain — preferred secure storage
  const keychainValue = keychainGet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (keychainValue) {
    return keychainValue;
  }

  // Legacy fallback: .env file
  const envPath = path.join(stateDir, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("VAULT_PASSPHRASE=")) {
        const value = trimmed.slice("VAULT_PASSPHRASE=".length).trim();
        if (value) {
          return value;
        }
      }
    }
  }

  throw new Error(
    "Vault passphrase not found. Set VAULT_PASSPHRASE env var, store in Keychain (genosos vault keychain-store), or add to ~/.genosv1/.env",
  );
};

/**
 * Derive an AES-256 key from passphrase + salt via PBKDF2.
 * @param {string} passphrase
 * @param {Buffer} salt
 * @returns {Buffer}
 */
export const deriveKey = (passphrase, salt) =>
  pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, PBKDF2_DIGEST);

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * @param {string} plaintext
 * @param {Buffer} key
 * @returns {{ iv: string, tag: string, data: string }}
 */
export const encryptPayload = (plaintext, key) => {
  const iv = randomBytes(AES_IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const result = {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("base64"),
  };
  zeroBuffer(encrypted);
  zeroBuffer(iv);
  return result;
};

/**
 * Decrypt an AES-256-GCM envelope back to a plaintext string.
 * @param {{ iv: string, tag: string, data: string }} envelope
 * @param {Buffer} key
 * @returns {string}
 */
export const decryptPayload = (envelope, key) => {
  const iv = Buffer.from(envelope.iv, "hex");
  const tag = Buffer.from(envelope.tag, "hex");
  const encrypted = Buffer.from(envelope.data, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const result = decrypted.toString("utf-8");
  zeroBuffer(decrypted);
  zeroBuffer(iv);
  zeroBuffer(tag);
  zeroBuffer(encrypted);
  return result;
};

/**
 * Encrypt a JSON-serializable object (vault compatibility).
 * @param {object} payload
 * @param {Buffer} key
 * @returns {{ iv: string, tag: string, data: string }}
 */
export const encryptJSON = (payload, key) => encryptPayload(JSON.stringify(payload), key);

/**
 * Decrypt an envelope back to a parsed object (vault compatibility).
 * @param {{ iv: string, tag: string, data: string }} envelope
 * @param {Buffer} key
 * @returns {object}
 */
export const decryptJSON = (envelope, key) => JSON.parse(decryptPayload(envelope, key));
