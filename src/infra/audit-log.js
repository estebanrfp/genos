// GenosOS — Esteban & Nyx 🦀🌙
import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { keychainGet, keychainSet } from "./keychain.js";
import { secureReadFileSync, secureAppendLineSync } from "./secure-io.js";

const log = createSubsystemLogger("audit");

const KEYCHAIN_SERVICE = "com.genos.audit";
const KEYCHAIN_ACCOUNT = "hmac-key";
const GENESIS_HASH = "GENESIS";
const AUDIT_FILE = "audit.jsonl";

let hmacKey = null;
let lastHash = GENESIS_HASH;
let auditPath = null;
let initialized = false;

/**
 * Resolve or generate the HMAC key (stored in macOS Keychain).
 * @returns {string}
 */
const resolveHmacKey = () => {
  if (hmacKey) {
    return hmacKey;
  }

  // Try Keychain first
  const stored = keychainGet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (stored) {
    hmacKey = stored;
    return hmacKey;
  }

  // Generate new key and store in Keychain
  hmacKey = randomBytes(32).toString("hex");
  try {
    keychainSet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, hmacKey);
  } catch {
    log.warn("Could not store audit HMAC key in Keychain — using ephemeral key");
  }
  return hmacKey;
};

/**
 * Compute HMAC-SHA256 for an audit entry.
 * @param {string} data
 * @param {string} key
 * @returns {string}
 */
const computeHmac = (data, key) => createHmac("sha256", key).update(data).digest("hex");

/**
 * Initialize the audit log — reads the last hash from existing log.
 * @param {string} [stateDir]
 */
export const initAuditLog = (stateDir = STATE_DIR) => {
  if (initialized) {
    return;
  }
  auditPath = path.join(stateDir, AUDIT_FILE);

  // Read last hash from existing log
  try {
    const content = secureReadFileSync(auditPath);
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      const lastLine = JSON.parse(lines[lines.length - 1]);
      lastHash = lastLine.hash ?? GENESIS_HASH;
    }
  } catch {
    // No existing log — start fresh
  }

  initialized = true;
};

/**
 * Append a tamper-evident audit entry.
 * @param {string} action - Event type (e.g. "vault.unlock", "file.decrypt").
 * @param {object} [details] - Optional event details.
 */
export const auditEvent = (action, details) => {
  if (!initialized) {
    initAuditLog();
  }

  const key = resolveHmacKey();
  const entry = {
    ts: new Date().toISOString(),
    action,
    ...(details ? { details } : {}),
    prev: lastHash,
  };

  const payload = JSON.stringify(entry);
  const hash = computeHmac(`${payload}:${entry.prev}`, key);
  entry.hash = hash;
  lastHash = hash;

  try {
    secureAppendLineSync(auditPath, JSON.stringify(entry));
  } catch (err) {
    log.warn(`Failed to write audit entry: ${err.message}`);
  }
};

/**
 * Verify the integrity of the audit log chain.
 * @param {string} [stateDir]
 * @returns {{ valid: boolean, entries: number, broken?: number }}
 */
export const verifyAuditLog = (stateDir = STATE_DIR) => {
  const filePath = path.join(stateDir, AUDIT_FILE);
  let content;
  try {
    content = secureReadFileSync(filePath);
  } catch {
    return { valid: true, entries: 0 };
  }

  const key = resolveHmacKey();
  const lines = content.trim().split("\n").filter(Boolean);
  let prev = GENESIS_HASH;
  let broken = -1;

  for (let i = 0; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]);
    if (entry.prev !== prev) {
      broken = i;
      break;
    }
    const { hash, ...rest } = entry;
    const payload = JSON.stringify(rest);
    const expected = computeHmac(`${payload}:${rest.prev}`, key);
    if (hash !== expected) {
      broken = i;
      break;
    }
    prev = hash;
  }

  return broken === -1
    ? { valid: true, entries: lines.length }
    : { valid: false, entries: lines.length, broken };
};

/**
 * Read the last N entries from the audit log.
 * @param {number} [n=20]
 * @param {string} [stateDir]
 * @returns {object[]}
 */
export const tailAuditLog = (n = 20, stateDir = STATE_DIR) => {
  const filePath = path.join(stateDir, AUDIT_FILE);
  try {
    const content = secureReadFileSync(filePath);
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.slice(-n).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
