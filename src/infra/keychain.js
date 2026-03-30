// GenosOS — Esteban & Nyx 🦀🌙
import { execFileSync } from "node:child_process";

const SECURITY_BIN = "/usr/bin/security";

/**
 * Retrieve a password from macOS Keychain.
 * @param {string} service - Keychain service name (e.g. "com.genos.vault").
 * @param {string} account - Keychain account name (e.g. "passphrase").
 * @returns {string | null} The password, or null if not found.
 */
export const keychainGet = (service, account) => {
  if (process.platform !== "darwin") {
    return null;
  }
  if (process.env.VITEST) {
    return null;
  }
  try {
    const result = execFileSync(
      SECURITY_BIN,
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return result.trim() || null;
  } catch {
    return null;
  }
};

/**
 * Store a password in macOS Keychain (add or update).
 * @param {string} service
 * @param {string} account
 * @param {string} password
 */
export const keychainSet = (service, account, password) => {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is only available on darwin");
  }
  if (process.env.VITEST) {
    return;
  }
  // Try to update first; if the entry doesn't exist, add it
  try {
    execFileSync(
      SECURITY_BIN,
      ["add-generic-password", "-s", service, "-a", account, "-w", password, "-U"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (err) {
    throw new Error(`Failed to store in Keychain: ${err.message}`, { cause: err });
  }
};

/**
 * Delete a password from macOS Keychain.
 * @param {string} service
 * @param {string} account
 */
export const keychainDelete = (service, account) => {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is only available on darwin");
  }
  if (process.env.VITEST) {
    return;
  }
  try {
    execFileSync(SECURITY_BIN, ["delete-generic-password", "-s", service, "-a", account], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Entry may not exist — that's fine
  }
};
