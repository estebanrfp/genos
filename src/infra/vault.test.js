import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initVault, vaultExists } from "./vault.js";

describe("vault", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-vault-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("set + get roundtrip", () => {
    const v = initVault("test-pass", tmpDir);
    v.setSecret("api-key", "sk-123");
    const entry = v.getSecret("api-key");
    expect(entry).not.toBeNull();
    expect(entry.value).toBe("sk-123");
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeTruthy();
  });

  it("list returns only keys", () => {
    const v = initVault("test-pass", tmpDir);
    v.setSecret("key1", "val1");
    v.setSecret("key2", "val2");
    const keys = v.listSecrets();
    expect(keys).toEqual(["key1", "key2"]);
  });

  it("delete removes secret", () => {
    const v = initVault("test-pass", tmpDir);
    v.setSecret("temp", "value");
    expect(v.deleteSecret("temp")).toBe(true);
    expect(v.getSecret("temp")).toBeNull();
  });

  it("wrong passphrase throws", () => {
    const v = initVault("pass-a", tmpDir);
    v.setSecret("secret", "data");
    expect(() => initVault("pass-b", tmpDir)).toThrow();
  });

  it("vault.enc created on first set", () => {
    expect(vaultExists(tmpDir)).toBe(false);
    const v = initVault("test-pass", tmpDir);
    v.setSecret("first", "value");
    expect(vaultExists(tmpDir)).toBe(true);
  });

  it("overwrite preserves createdAt", async () => {
    const v = initVault("test-pass", tmpDir);
    v.setSecret("key", "v1");
    const first = v.getSecret("key");
    // Small delay to ensure updatedAt differs
    await new Promise((r) => setTimeout(r, 10));
    v.setSecret("key", "v2");
    const second = v.getSecret("key");
    expect(second.value).toBe("v2");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
  });
});
