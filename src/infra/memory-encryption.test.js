import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAGIC_HEADER,
  isEncrypted,
  encryptContent,
  decryptContent,
  encryptFile,
  decryptFile,
} from "./memory-encryption.js";

const PASSPHRASE = "test-memory-pass";

describe("memory-encryption", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-memenc-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isEncrypted detects NYXENC1 header", () => {
    expect(isEncrypted('NYXENC1\n{"salt":"abc"}')).toBe(true);
  });

  it("isEncrypted returns false for plaintext", () => {
    expect(isEncrypted("# My Memory\nSome notes here")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });

  it("encryptContent + decryptContent roundtrip", () => {
    const plaintext = "# Memory\nSome secret notes about Nyx.";
    const encrypted = encryptContent(plaintext, PASSPHRASE);
    expect(isEncrypted(encrypted)).toBe(true);
    const decrypted = decryptContent(encrypted, PASSPHRASE);
    expect(decrypted).toBe(plaintext);
  });

  it("encryptFile encrypts plaintext in place", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(filePath, "# Plaintext memory");
    const result = await encryptFile(filePath, PASSPHRASE);
    expect(result.wasPlaintext).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(isEncrypted(content)).toBe(true);
  });

  it("encryptFile skips already-encrypted", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    const encrypted = encryptContent("# Secret", PASSPHRASE);
    fs.writeFileSync(filePath, encrypted);
    const result = await encryptFile(filePath, PASSPHRASE);
    expect(result.wasPlaintext).toBe(false);
  });

  it("decryptFile decrypts in place", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    const encrypted = encryptContent("# My notes", PASSPHRASE);
    fs.writeFileSync(filePath, encrypted);
    const result = await decryptFile(filePath, PASSPHRASE);
    expect(result.wasEncrypted).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("# My notes");
  });

  it("decryptFile skips plaintext", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(filePath, "# Plaintext");
    const result = await decryptFile(filePath, PASSPHRASE);
    expect(result.wasEncrypted).toBe(false);
  });

  it("encrypted file has chmod 600", async () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(filePath, "# Secret data");
    await encryptFile(filePath, PASSPHRASE);
    const stat = fs.statSync(filePath);
    // eslint-disable-next-line no-bitwise
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("wrong passphrase throws", () => {
    const encrypted = encryptContent("# Secret", PASSPHRASE);
    expect(() => decryptContent(encrypted, "wrong-pass")).toThrow();
  });

  it("file format: NYXENC1 + newline + JSON", () => {
    const encrypted = encryptContent("test", PASSPHRASE);
    const [header, jsonStr] = encrypted.split("\n", 2);
    expect(header).toBe(MAGIC_HEADER);
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveProperty("salt");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("tag");
    expect(parsed).toHaveProperty("data");
  });
});
