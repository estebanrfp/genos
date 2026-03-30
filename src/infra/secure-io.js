// GenosOS — Esteban & Nyx 🦀🌙
import fs from "node:fs";
import fsAsync from "node:fs/promises";
import path from "node:path";
import { resolvePassphrase, zeroBuffer } from "./crypto-utils.js";
import { decryptContent, encryptContent, isEncrypted, MAGIC_HEADER } from "./memory-encryption.js";
import { isVaultUnlocked, getVaultPassphrase, unlockVault } from "./vault-state.js";

const NXLN_PREFIX = "NXLN:";

/**
 * Try to resolve vault passphrase; returns null when unconfigured or locked.
 * Uses vault-state when active, falls back to resolvePassphrase.
 * @returns {string | null}
 */
export const getPassphraseOrNull = () => {
  // If vault-state is managing lock state, respect it
  try {
    if (isVaultUnlocked()) {
      return getVaultPassphrase();
    }
  } catch {
    // VAULT_LOCKED — return null to degrade gracefully
    return null;
  }
  // Fallback: resolve directly (startup or after auto-lock).
  // Re-unlock vault-state to cache the passphrase and avoid repeated Keychain spawns
  // (548 chunks × execFileSync('/usr/bin/security') = 22s — critical perf bug).
  try {
    const pp = resolvePassphrase();
    unlockVault(pp);
    return pp;
  } catch {
    return null;
  }
};

// ── File-level encrypt / decrypt (async) ────────────────────────────

/**
 * Read a file, transparently decrypting NYXENC1 content when passphrase is available.
 * @param {string} absPath
 * @returns {Promise<string>}
 */
export const secureReadFile = async (absPath) => {
  const raw = await fsAsync.readFile(absPath, "utf-8");
  if (!isEncrypted(raw)) {
    return raw;
  }
  const passphrase = getPassphraseOrNull();
  if (!passphrase) {
    return raw;
  }
  return decryptContent(raw, passphrase);
};

/**
 * Write a file, encrypting with NYXENC1 when passphrase is configured.
 * Falls back to plaintext when no passphrase.
 * @param {string} absPath
 * @param {string} content
 */
export const secureWriteFile = async (absPath, content) => {
  const passphrase = getPassphraseOrNull();
  const output = passphrase ? encryptContent(content, passphrase) : content;
  const dir = path.dirname(absPath);
  await fsAsync.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsAsync.writeFile(absPath, output, { encoding: "utf-8", mode: 0o600 });
};

// ── File-level encrypt / decrypt (sync) ─────────────────────────────

/**
 * Synchronous read with transparent NYXENC1 decryption.
 * @param {string} absPath
 * @returns {string}
 */
export const secureReadFileSync = (absPath) => {
  const raw = fs.readFileSync(absPath, "utf-8");
  if (!isEncrypted(raw)) {
    return raw;
  }
  const passphrase = getPassphraseOrNull();
  if (!passphrase) {
    return raw;
  }
  return decryptContent(raw, passphrase);
};

/**
 * Synchronous write with NYXENC1 encryption when passphrase is configured.
 * @param {string} absPath
 * @param {string} content
 */
export const secureWriteFileSync = (absPath, content) => {
  const passphrase = getPassphraseOrNull();
  const output = passphrase ? encryptContent(content, passphrase) : content;
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(absPath, output, { encoding: "utf-8", mode: 0o600 });
};

// ── JSONL line-by-line encryption (NXLN: prefix) ────────────────────

/**
 * Append a single JSON object as an encrypted line (NXLN:{base64}) or plaintext JSON.
 * @param {string} absPath
 * @param {object} obj
 */
export const secureAppendLineSync = (absPath, obj) => {
  const json = JSON.stringify(obj);
  const passphrase = getPassphraseOrNull();
  if (!passphrase) {
    fs.appendFileSync(absPath, json + "\n");
    return;
  }
  const encrypted = encryptContent(json, passphrase);
  const buf = Buffer.from(encrypted);
  const encoded = buf.toString("base64url");
  zeroBuffer(buf);
  fs.appendFileSync(absPath, `${NXLN_PREFIX}${encoded}\n`);
};

/**
 * Read a JSONL file, decrypting NXLN: lines and parsing plaintext JSON lines.
 * @param {string} absPath
 * @returns {Promise<object[]>}
 */
export const secureReadLines = async (absPath) => {
  let raw;
  try {
    raw = await fsAsync.readFile(absPath, "utf-8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      return [];
    }
    throw err;
  }
  if (!raw.trim()) {
    return [];
  }

  // If the entire file is NYXENC1, decrypt it first then parse as JSONL
  if (isEncrypted(raw)) {
    const passphrase = getPassphraseOrNull();
    if (!passphrase) {
      return [];
    }
    raw = decryptContent(raw, passphrase);
  }

  const passphrase = getPassphraseOrNull();
  const results = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith(NXLN_PREFIX)) {
      if (!passphrase) {
        continue;
      }
      const encoded = trimmed.slice(NXLN_PREFIX.length);
      const buf = Buffer.from(encoded, "base64url");
      const encrypted = buf.toString("utf-8");
      zeroBuffer(buf);
      const json = decryptContent(encrypted, passphrase);
      try {
        results.push(JSON.parse(json));
      } catch {
        // skip NXLN line with corrupted/invalid JSON after decryption
      }
    } else {
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    }
  }
  return results;
};

// ── Inline chunk-text encryption (for SQLite columns) ───────────────

const INLINE_PREFIX = `${MAGIC_HEADER}:`;

/**
 * Check if a chunk text value is inline-encrypted.
 * @param {string} text
 * @returns {boolean}
 */
export const isChunkEncrypted = (text) =>
  typeof text === "string" && text.startsWith(INLINE_PREFIX);

/**
 * Encrypt a chunk text value for storage in SQLite.
 * Returns original text when no passphrase is configured.
 * @param {string} text
 * @returns {string}
 */
export const encryptChunkText = (text) => {
  const passphrase = getPassphraseOrNull();
  if (!passphrase) {
    return text;
  }
  const encrypted = encryptContent(text, passphrase);
  // Convert NYXENC1\n{...} to NYXENC1:{...} (single-line for SQLite column)
  const newlineIdx = encrypted.indexOf("\n");
  return `${INLINE_PREFIX}${encrypted.slice(newlineIdx + 1)}`;
};

/**
 * Decrypt a chunk text value from SQLite.
 * Returns original text when plaintext or no passphrase.
 * @param {string} text
 * @returns {string}
 */
export const decryptChunkText = (text) => {
  if (!isChunkEncrypted(text)) {
    return text;
  }
  const passphrase = getPassphraseOrNull();
  if (!passphrase) {
    return text;
  }
  const jsonStr = text.slice(INLINE_PREFIX.length);
  // Reconstruct full NYXENC1 format for decryptContent
  return decryptContent(`${MAGIC_HEADER}\n${jsonStr}`, passphrase);
};

// ── Passphrase availability check ───────────────────────────────────

/**
 * Check if vault encryption is currently active (passphrase is configured).
 * @returns {boolean}
 */
export const isVaultActive = () => getPassphraseOrNull() !== null;
