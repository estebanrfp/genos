import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PBKDF2_SALT_BYTES,
  deriveKey,
  encryptPayload,
  decryptPayload,
  encryptJSON,
  decryptJSON,
  resolvePassphrase,
} from "./crypto-utils.js";

describe("crypto-utils", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-crypto-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.VAULT_PASSPHRASE;
  });

  it("deriveKey returns consistent 32-byte key", () => {
    const salt = randomBytes(PBKDF2_SALT_BYTES);
    const key1 = deriveKey("test-pass", salt);
    const key2 = deriveKey("test-pass", salt);
    expect(key1.length).toBe(32);
    expect(key1.equals(key2)).toBe(true);
  });

  it("encryptPayload + decryptPayload roundtrip (string)", () => {
    const salt = randomBytes(PBKDF2_SALT_BYTES);
    const key = deriveKey("roundtrip-pass", salt);
    const plaintext = "Hello, GenosOS memory encryption!";
    const envelope = encryptPayload(plaintext, key);
    expect(envelope.iv).toBeTruthy();
    expect(envelope.tag).toBeTruthy();
    expect(envelope.data).toBeTruthy();
    const decrypted = decryptPayload(envelope, key);
    expect(decrypted).toBe(plaintext);
  });

  it("encryptJSON + decryptJSON roundtrip (object)", () => {
    const salt = randomBytes(PBKDF2_SALT_BYTES);
    const key = deriveKey("json-pass", salt);
    const payload = { secrets: { key1: "val1" }, nested: { arr: [1, 2, 3] } };
    const envelope = encryptJSON(payload, key);
    const decrypted = decryptJSON(envelope, key);
    expect(decrypted).toEqual(payload);
  });

  it("resolvePassphrase reads from .env file", () => {
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "VAULT_PASSPHRASE=from-env-file\n");
    const result = resolvePassphrase(undefined, tmpDir);
    expect(result).toBe("from-env-file");
  });

  it("resolvePassphrase throws if no passphrase", () => {
    expect(() => resolvePassphrase(undefined, tmpDir)).toThrow("Vault passphrase not found");
  });

  it("different salts produce different keys", () => {
    const salt1 = randomBytes(PBKDF2_SALT_BYTES);
    const salt2 = randomBytes(PBKDF2_SALT_BYTES);
    const key1 = deriveKey("same-pass", salt1);
    const key2 = deriveKey("same-pass", salt2);
    expect(key1.equals(key2)).toBe(false);
  });
});
