// GenosOS — Esteban & Nyx 🦀🌙
import fs from "node:fs/promises";
import { resolvePassphrase } from "./crypto-utils.js";
import { MAGIC_HEADER, encryptContent, decryptContent } from "./memory-encryption.js";

/**
 * Create a memory encryption manager with cached passphrase.
 * @param {{ passphrase?: string, stateDir?: string }} [options]
 * @returns {{ readSecure: (filePath: string) => Promise<string>, writeSecure: (filePath: string, content: string) => Promise<void>, isFileEncrypted: (filePath: string) => Promise<boolean>, getPassphrase: () => string }}
 */
export const createMemoryEncryptionManager = (options = {}) => {
  const passphrase = options.passphrase ?? resolvePassphrase(undefined, options.stateDir);

  return {
    /**
     * Read a file, decrypting in memory if NYXENC1-encrypted.
     * @param {string} filePath
     * @returns {Promise<string>}
     */
    async readSecure(filePath) {
      const raw = await fs.readFile(filePath, "utf-8");
      if (!raw.startsWith(`${MAGIC_HEADER}\n`)) {
        return raw;
      }
      return decryptContent(raw, passphrase);
    },

    /**
     * Write content encrypted with NYXENC1 header, chmod 600.
     * @param {string} filePath
     * @param {string} content
     * @returns {Promise<void>}
     */
    async writeSecure(filePath, content) {
      const encrypted = encryptContent(content, passphrase);
      await fs.writeFile(filePath, encrypted, "utf-8");
      await fs.chmod(filePath, 0o600);
    },

    /**
     * Check if a file is NYXENC1-encrypted by reading only the first bytes.
     * @param {string} filePath
     * @returns {Promise<boolean>}
     */
    async isFileEncrypted(filePath) {
      const handle = await fs.open(filePath, "r");
      try {
        const buf = Buffer.alloc(8);
        await handle.read(buf, 0, 8, 0);
        return buf.toString("utf-8").startsWith(`${MAGIC_HEADER}\n`);
      } finally {
        await handle.close();
      }
    },

    /** @returns {string} */
    getPassphrase: () => passphrase,
  };
};
