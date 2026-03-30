let makeEntry = function (updatedAt) {
    return { sessionId: crypto.randomUUID(), updatedAt };
  },
  applyEnforcedMaintenanceConfig = function (mockLoadConfig) {
    mockLoadConfig.mockReturnValue({
      session: {
        maintenance: {
          mode: "enforce",
          pruneAfter: "7d",
          maxEntries: 500,
          rotateBytes: 10485760,
        },
      },
    });
  };
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSessionStoreCacheForTest, loadSessionStore, saveSessionStore } from "./store.js";
vi.mock("../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({}),
}));
const DAY_MS = 86400000;
const archiveTimestamp = (ms) => new Date(ms).toISOString().replaceAll(":", "-");
let fixtureRoot = "";
let fixtureCount = 0;
async function createCaseDir(prefix) {
  const dir = path.join(fixtureRoot, `${prefix}-${fixtureCount++}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
describe("Integration: saveSessionStore with pruning", () => {
  let testDir;
  let storePath;
  let savedCacheTtl;
  let mockLoadConfig;
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-pruning-integ-"));
  });
  afterAll(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  beforeEach(async () => {
    testDir = await createCaseDir("pruning-integ");
    storePath = path.join(testDir, "sessions.json");
    savedCacheTtl = process.env.GENOS_SESSION_CACHE_TTL_MS;
    process.env.GENOS_SESSION_CACHE_TTL_MS = "0";
    clearSessionStoreCacheForTest();
    const configModule = await import("../config.js");
    mockLoadConfig = configModule.loadConfig;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearSessionStoreCacheForTest();
    if (savedCacheTtl === undefined) {
      delete process.env.GENOS_SESSION_CACHE_TTL_MS;
    } else {
      process.env.GENOS_SESSION_CACHE_TTL_MS = savedCacheTtl;
    }
  });
  it("saveSessionStore prunes stale entries on write", async () => {
    applyEnforcedMaintenanceConfig(mockLoadConfig);
    const now = Date.now();
    const store = {
      stale: makeEntry(now - 30 * DAY_MS),
      fresh: makeEntry(now),
    };
    await saveSessionStore(storePath, store);
    const loaded = loadSessionStore(storePath);
    expect(loaded.stale).toBeUndefined();
    expect(loaded.fresh).toBeDefined();
  });
  it("archives transcript files for stale sessions pruned on write", async () => {
    applyEnforcedMaintenanceConfig(mockLoadConfig);
    const now = Date.now();
    const staleSessionId = "stale-session";
    const freshSessionId = "fresh-session";
    const store = {
      stale: { sessionId: staleSessionId, updatedAt: now - 30 * DAY_MS },
      fresh: { sessionId: freshSessionId, updatedAt: now },
    };
    const staleTranscript = path.join(testDir, `${staleSessionId}.jsonl`);
    const freshTranscript = path.join(testDir, `${freshSessionId}.jsonl`);
    await fs.writeFile(staleTranscript, '{"type":"session"}\n', "utf-8");
    await fs.writeFile(freshTranscript, '{"type":"session"}\n', "utf-8");
    await saveSessionStore(storePath, store);
    const loaded = loadSessionStore(storePath);
    expect(loaded.stale).toBeUndefined();
    expect(loaded.fresh).toBeDefined();
    await expect(fs.stat(staleTranscript)).rejects.toThrow();
    await expect(fs.stat(freshTranscript)).resolves.toBeDefined();
    const dirEntries = await fs.readdir(testDir);
    const archived = dirEntries.filter((entry) =>
      entry.startsWith(`${staleSessionId}.jsonl.deleted.`),
    );
    expect(archived).toHaveLength(1);
  });
  it("cleans up archived transcripts older than the prune window", async () => {
    applyEnforcedMaintenanceConfig(mockLoadConfig);
    const now = Date.now();
    const staleSessionId = "stale-session";
    const store = {
      stale: { sessionId: staleSessionId, updatedAt: now - 30 * DAY_MS },
      fresh: { sessionId: "fresh-session", updatedAt: now },
    };
    const staleTranscript = path.join(testDir, `${staleSessionId}.jsonl`);
    await fs.writeFile(staleTranscript, '{"type":"session"}\n', "utf-8");
    const oldArchived = path.join(
      testDir,
      `old-session.jsonl.deleted.${archiveTimestamp(now - 9 * DAY_MS)}`,
    );
    const recentArchived = path.join(
      testDir,
      `recent-session.jsonl.deleted.${archiveTimestamp(now - 2 * DAY_MS)}`,
    );
    const bakArchived = path.join(
      testDir,
      `bak-session.jsonl.bak.${archiveTimestamp(now - 20 * DAY_MS)}`,
    );
    await fs.writeFile(oldArchived, "old", "utf-8");
    await fs.writeFile(recentArchived, "recent", "utf-8");
    await fs.writeFile(bakArchived, "bak", "utf-8");
    await saveSessionStore(storePath, store);
    await expect(fs.stat(oldArchived)).rejects.toThrow();
    await expect(fs.stat(recentArchived)).resolves.toBeDefined();
    await expect(fs.stat(bakArchived)).resolves.toBeDefined();
  });
  it("saveSessionStore skips enforcement when maintenance mode is warn", async () => {
    mockLoadConfig.mockReturnValue({
      session: {
        maintenance: {
          mode: "warn",
          pruneAfter: "7d",
          maxEntries: 1,
          rotateBytes: 10485760,
        },
      },
    });
    const now = Date.now();
    const store = {
      stale: makeEntry(now - 30 * DAY_MS),
      fresh: makeEntry(now),
    };
    await saveSessionStore(storePath, store);
    const loaded = loadSessionStore(storePath);
    expect(loaded.stale).toBeDefined();
    expect(loaded.fresh).toBeDefined();
    expect(Object.keys(loaded)).toHaveLength(2);
  });
});
