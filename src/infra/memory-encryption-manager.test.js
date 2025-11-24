import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryEncryptionManager } from "./memory-encryption-manager.js";
import { encryptContent, MAGIC_HEADER } from "./memory-encryption.js";

const PASSPHRASE = "test-manager-pass";

describe("memory-encryption-manager", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-memgr-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readSecure returns plaintext for unencrypted", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(filePath, "# Plain memory");
    const mgr = createMemoryEncryptionManager({ passphrase: PASSPHRASE });
    const content = await mgr.readSecure(filePath);
    expect(content).toBe("# Plain memory");
  });

  it("readSecure decrypts NYXENC1 transparently", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    const encrypted = encryptContent("# Secret memory", PASSPHRASE);
    fs.writeFileSync(filePath, encrypted);
    const mgr = createMemoryEncryptionManager({ passphrase: PASSPHRASE });
    const content = await mgr.readSecure(filePath);
    expect(content).toBe("# Secret memory");
  });

  it("writeSecure creates NYXENC1 with chmod 600", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    const mgr = createMemoryEncryptionManager({ passphrase: PASSPHRASE });
    await mgr.writeSecure(filePath, "# Sensitive data");
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw.startsWith(`${MAGIC_HEADER}\n`)).toBe(true);
    const stat = fs.statSync(filePath);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("writeSecure -> readSecure roundtrip", async () => {
    const filePath = path.join(tmpDir, "notes.md");
    const mgr = createMemoryEncryptionManager({ passphrase: PASSPHRASE });
    const original = "# Notes\nImportant stuff about Nyx.";
    await mgr.writeSecure(filePath, original);
    const restored = await mgr.readSecure(filePath);
    expect(restored).toBe(original);
  });

  it("isFileEncrypted detects without full read", async () => {
    const plainPath = path.join(tmpDir, "plain.md");
    const encPath = path.join(tmpDir, "encrypted.md");
    fs.writeFileSync(plainPath, "# Plaintext");
    fs.writeFileSync(encPath, encryptContent("# Secret", PASSPHRASE));
    const mgr = createMemoryEncryptionManager({ passphrase: PASSPHRASE });
    expect(await mgr.isFileEncrypted(plainPath)).toBe(false);
    expect(await mgr.isFileEncrypted(encPath)).toBe(true);
  });
});
