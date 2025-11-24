let withTempDir = function () {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genosos-telegram-token-"));
};
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTelegramToken } from "./token.js";
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from "./update-offset-store.js";
async function withTempStateDir(fn) {
  const previous = process.env.GENOS_STATE_DIR;
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "genosos-telegram-"));
  process.env.GENOS_STATE_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) {
      delete process.env.GENOS_STATE_DIR;
    } else {
      process.env.GENOS_STATE_DIR = previous;
    }
    await fsPromises.rm(dir, { recursive: true, force: true });
  }
}
describe("resolveTelegramToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("prefers config token over env", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "env-token");
    const cfg = {
      channels: { telegram: { botToken: "cfg-token" } },
    };
    const res = resolveTelegramToken(cfg);
    expect(res.token).toBe("cfg-token");
    expect(res.source).toBe("config");
  });
  it("uses env token when config is missing", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "env-token");
    const cfg = {
      channels: { telegram: {} },
    };
    const res = resolveTelegramToken(cfg);
    expect(res.token).toBe("env-token");
    expect(res.source).toBe("env");
  });
  it("uses tokenFile when configured", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const dir = withTempDir();
    const tokenFile = path.join(dir, "token.txt");
    fs.writeFileSync(tokenFile, "file-token\n", "utf-8");
    const cfg = { channels: { telegram: { tokenFile } } };
    const res = resolveTelegramToken(cfg);
    expect(res.token).toBe("file-token");
    expect(res.source).toBe("tokenFile");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("falls back to config token when no env or tokenFile", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const cfg = {
      channels: { telegram: { botToken: "cfg-token" } },
    };
    const res = resolveTelegramToken(cfg);
    expect(res.token).toBe("cfg-token");
    expect(res.source).toBe("config");
  });
  it("does not fall back to config when tokenFile is missing", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const dir = withTempDir();
    const tokenFile = path.join(dir, "missing-token.txt");
    const cfg = {
      channels: { telegram: { tokenFile, botToken: "cfg-token" } },
    };
    const res = resolveTelegramToken(cfg);
    expect(res.token).toBe("");
    expect(res.source).toBe("none");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("resolves per-account tokens when the config account key casing doesn't match routing normalization", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const cfg = {
      channels: {
        telegram: {
          accounts: {
            careyNotifications: { botToken: "acct-token" },
          },
        },
      },
    };
    const res = resolveTelegramToken(cfg, { accountId: "careynotifications" });
    expect(res.token).toBe("acct-token");
    expect(res.source).toBe("config");
  });
});
describe("telegram update offset store", () => {
  it("persists and reloads the last update id", async () => {
    await withTempStateDir(async () => {
      expect(await readTelegramUpdateOffset({ accountId: "primary" })).toBeNull();
      await writeTelegramUpdateOffset({
        accountId: "primary",
        updateId: 421,
      });
      expect(await readTelegramUpdateOffset({ accountId: "primary" })).toBe(421);
    });
  });
});
