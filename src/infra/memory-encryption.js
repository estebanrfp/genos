// GenosOS — Esteban & Nyx 🦀🌙
import { randomBytes } from "node:crypto";
import fsAsync from "node:fs/promises";
import {
  PBKDF2_SALT_BYTES,
  deriveKey,
  encryptPayload,
  decryptPayload,
  zeroBuffer,
} from "./crypto-utils.js";

export const MAGIC_HEADER = "NYXENC1";

export const DEFAULT_ENCRYPT_PATTERNS = ["MEMORY.md", "memory.md", "memory/**/*.md"];

export const WORKSPACE_ENCRYPT_PATTERNS = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "SECURITY.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
  "memory.md",
  "memory/**/*.md",
];

/**
 * Check whether content is NYXENC1-encrypted.
 * @param {string} content
 * @returns {boolean}
 */
export const isEncrypted = (content) => content.startsWith(`${MAGIC_HEADER}\n`);

/**
 * Encrypt plaintext content with a per-file random salt.
 * @param {string} plaintext
 * @param {string} passphrase
 * @returns {string}
 */
export const encryptContent = (plaintext, passphrase) => {
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const key = deriveKey(passphrase, salt);
  try {
    const envelope = encryptPayload(plaintext, key);
    const payload = { salt: salt.toString("hex"), ...envelope };
    return `${MAGIC_HEADER}\n${JSON.stringify(payload)}`;
  } finally {
    zeroBuffer(key);
  }
};

/**
 * Decrypt NYXENC1-formatted file content.
 * @param {string} fileContent
 * @param {string} passphrase
 * @returns {string}
 */
export const decryptContent = (fileContent, passphrase) => {
  const newlineIndex = fileContent.indexOf("\n");
  const jsonStr = fileContent.slice(newlineIndex + 1);
  const envelope = JSON.parse(jsonStr);
  const salt = Buffer.from(envelope.salt, "hex");
  const key = deriveKey(passphrase, salt);
  try {
    return decryptPayload(envelope, key);
  } finally {
    zeroBuffer(key);
    zeroBuffer(salt);
  }
};

/**
 * Encrypt a file in place if it is plaintext.
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {Promise<{ wasPlaintext: boolean }>}
 */
export const encryptFile = async (filePath, passphrase) => {
  const content = await fsAsync.readFile(filePath, "utf-8");
  if (isEncrypted(content)) {
    return { wasPlaintext: false };
  }

  const encrypted = encryptContent(content, passphrase);
  await fsAsync.writeFile(filePath, encrypted, "utf-8");
  await fsAsync.chmod(filePath, 0o600);
  return { wasPlaintext: true };
};

/**
 * Decrypt a file in place if it is NYXENC1-encrypted.
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {Promise<{ wasEncrypted: boolean }>}
 */
export const decryptFile = async (filePath, passphrase) => {
  const content = await fsAsync.readFile(filePath, "utf-8");
  if (!isEncrypted(content)) {
    return { wasEncrypted: false };
  }

  const plaintext = decryptContent(content, passphrase);
  await fsAsync.writeFile(filePath, plaintext, "utf-8");
  return { wasEncrypted: true };
};
