let resolveLockPath = function (env) {
    const stateDir = resolveStateDir(env);
    const configPath = resolveConfigPath(env, stateDir);
    const hash = createHash("sha1").update(configPath).digest("hex").slice(0, 8);
    const lockDir = resolveGatewayLockDir();
    return { lockPath: path.join(lockDir, `gateway.${hash}.lock`), configPath };
  },
  makeProcStat = function (pid, startTime) {
    const fields = [
      "R",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      String(startTime),
      "1",
      "1",
    ];
    return `${pid} (node) ${fields.join(" ")}`;
  },
  createLockPayload = function (params) {
    return {
      pid: process.pid,
      createdAt: params.createdAt ?? new Date().toISOString(),
      configPath: params.configPath,
      startTime: params.startTime,
    };
  },
  mockProcStatRead = function (params) {
    const readFileSync = fsSync.readFileSync;
    return vi.spyOn(fsSync, "readFileSync").mockImplementation((filePath, encoding) => {
      if (filePath === `/proc/${process.pid}/stat`) {
        return params.onProcRead();
      }
      return readFileSync(filePath, encoding);
    });
  };
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfigPath, resolveGatewayLockDir, resolveStateDir } from "../config/paths.js";
import { acquireGatewayLock, GatewayLockError } from "./gateway-lock.js";
let fixtureRoot = "";
let fixtureCount = 0;
async function makeEnv() {
  const dir = path.join(fixtureRoot, `case-${fixtureCount++}`);
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, "genosos.json");
  await fs.writeFile(configPath, "{}", "utf8");
  await fs.mkdir(resolveGatewayLockDir(), { recursive: true });
  return {
    env: {
      ...process.env,
      GENOS_STATE_DIR: dir,
      GENOS_CONFIG_PATH: configPath,
    },
    cleanup: async () => {},
  };
}
describe("gateway lock", () => {
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-gateway-lock-"));
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("blocks concurrent acquisition until release", async () => {
    vi.useRealTimers();
    const { env, cleanup } = await makeEnv();
    const lock = await acquireGatewayLock({
      env,
      allowInTests: true,
      timeoutMs: 50,
      pollIntervalMs: 2,
    });
    expect(lock).not.toBeNull();
    const pending = acquireGatewayLock({
      env,
      allowInTests: true,
      timeoutMs: 15,
      pollIntervalMs: 2,
    });
    await expect(pending).rejects.toBeInstanceOf(GatewayLockError);
    await lock?.release();
    const lock2 = await acquireGatewayLock({
      env,
      allowInTests: true,
      timeoutMs: 30,
      pollIntervalMs: 2,
    });
    await lock2?.release();
    await cleanup();
  });
  it("treats recycled linux pid as stale when start time mismatches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-06T10:05:00.000Z"));
    const { env, cleanup } = await makeEnv();
    const { lockPath, configPath } = resolveLockPath(env);
    const payload = createLockPayload({ configPath, startTime: 111 });
    await fs.writeFile(lockPath, JSON.stringify(payload), "utf8");
    const statValue = makeProcStat(process.pid, 222);
    const spy = mockProcStatRead({
      onProcRead: () => statValue,
    });
    const lock = await acquireGatewayLock({
      env,
      allowInTests: true,
      timeoutMs: 80,
      pollIntervalMs: 5,
      platform: "linux",
    });
    expect(lock).not.toBeNull();
    await lock?.release();
    spy.mockRestore();
    await cleanup();
  });
  it("keeps lock on linux when proc access fails unless stale", async () => {
    vi.useRealTimers();
    const { env, cleanup } = await makeEnv();
    const { lockPath, configPath } = resolveLockPath(env);
    const payload = createLockPayload({ configPath, startTime: 111 });
    await fs.writeFile(lockPath, JSON.stringify(payload), "utf8");
    const spy = mockProcStatRead({
      onProcRead: () => {
        throw new Error("EACCES");
      },
    });
    const pending = acquireGatewayLock({
      env,
      allowInTests: true,
      timeoutMs: 15,
      pollIntervalMs: 2,
      staleMs: 1e4,
      platform: "linux",
    });
    await expect(pending).rejects.toBeInstanceOf(GatewayLockError);
    spy.mockRestore();
    const stalePayload = createLockPayload({
      configPath,
      startTime: 111,
      createdAt: new Date(0).toISOString(),
    });
    await fs.writeFile(lockPath, JSON.stringify(stalePayload), "utf8");
    const staleSpy = mockProcStatRead({
      onProcRead: () => {
        throw new Error("EACCES");
      },
    });
    const lock = await acquireGatewayLock({
      env,
      allowInTests: true,
      timeoutMs: 30,
      pollIntervalMs: 2,
      staleMs: 1,
      platform: "linux",
    });
    expect(lock).not.toBeNull();
    await lock?.release();
    staleSpy.mockRestore();
    await cleanup();
  });
});
