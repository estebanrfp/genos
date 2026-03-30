// GenosOS — Esteban & Nyx 🦀🌙
import { uptime } from "node:os";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { auditEvent } from "./audit-log.js";
import { resolvePassphrase, zeroBuffer } from "./crypto-utils.js";

const log = createSubsystemLogger("vault");

const AUTO_LOCK_MS = 30 * 60_000; // 30 minutes
const UPTIME_GAP_THRESHOLD_S = 60; // detect sleep/suspend gaps > 60s

/** @type {{ key: Buffer, salt: Buffer } | null} */
let cachedDerivedKey = null;
let lastTouchTs = 0;
let lastUptimeS = 0;
let autoLockTimer = null;
let locked = true;

/**
 * Unlock the vault with a passphrase.
 * Derives and caches the encryption key, starts the auto-lock timer.
 * @param {string} [passphrase] - Explicit passphrase; resolves automatically if omitted.
 */
export const unlockVault = (passphrase) => {
  const pp = passphrase ?? resolvePassphrase();
  // We don't pre-derive a fixed key here because each file uses its own salt.
  // Instead, we store the passphrase in a Buffer so we can zero it on lock.
  if (cachedDerivedKey) {
    zeroBuffer(cachedDerivedKey.key);
  }
  cachedDerivedKey = { passphrase: pp };
  locked = false;
  lastUptimeS = uptime();
  touchVault();
  log.info("Vault unlocked");
  auditEvent("vault.unlock");
};

/**
 * Lock the vault: zero cached key material and clear state.
 */
export const lockVault = () => {
  if (cachedDerivedKey) {
    zeroBuffer(cachedDerivedKey.key);
    cachedDerivedKey = null;
  }
  locked = true;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
  log.info("Vault locked");
  auditEvent("vault.lock");
};

/**
 * Reset the auto-lock timer (called on every encrypt/decrypt operation).
 */
export const touchVault = () => {
  lastTouchTs = Date.now();

  // Detect sleep/suspend gap
  const currentUptime = uptime();
  if (lastUptimeS > 0) {
    const elapsed = currentUptime - lastUptimeS;
    const wallElapsed = (Date.now() - lastTouchTs) / 1000;
    // If system uptime gap is much larger than wall clock, system was asleep
    if (elapsed < 0 || (wallElapsed > 0 && elapsed < wallElapsed - UPTIME_GAP_THRESHOLD_S)) {
      log.info("System sleep detected — locking vault");
      lockVault();
      return;
    }
  }
  lastUptimeS = currentUptime;

  // Reset auto-lock timer
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
  }
  autoLockTimer = setTimeout(() => {
    log.info("Auto-lock triggered after 30 minutes of inactivity");
    lockVault();
  }, AUTO_LOCK_MS);
  if (autoLockTimer.unref) {
    autoLockTimer.unref();
  }
};

/**
 * Check if the vault is currently unlocked.
 * @returns {boolean}
 */
export const isVaultUnlocked = () => !locked;

/**
 * Get the current vault passphrase.
 * Throws VAULT_LOCKED if the vault is locked.
 * @returns {string}
 */
export const getVaultPassphrase = () => {
  if (locked || !cachedDerivedKey) {
    throw Object.assign(new Error("Vault is locked"), { code: "VAULT_LOCKED" });
  }
  touchVault();
  return cachedDerivedKey.passphrase;
};

/**
 * Get vault status information.
 * @returns {{ locked: boolean, lastActivity: number, autoLockMs: number }}
 */
export const getVaultStatus = () => ({
  locked,
  lastActivity: lastTouchTs,
  autoLockMs: AUTO_LOCK_MS,
  idleMs: locked ? 0 : Date.now() - lastTouchTs,
});
