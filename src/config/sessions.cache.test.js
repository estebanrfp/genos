import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSessionStoreCacheForTest, loadSessionStore, saveSessionStore } from "./sessions.js";
describe("Session Store Cache", () => {
  let fixtureRoot = "";
  let caseId = 0;
  let testDir;
  let storePath;
  beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-cache-test-"));
  });
  afterAll(() => {
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
  beforeEach(() => {
    testDir = path.join(fixtureRoot, `case-${caseId++}`);
    fs.mkdirSync(testDir, { recursive: true });
    storePath = path.join(testDir, "sessions.json");
    clearSessionStoreCacheForTest();
    delete process.env.GENOS_SESSION_CACHE_TTL_MS;
  });
  afterEach(() => {
    clearSessionStoreCacheForTest();
    delete process.env.GENOS_SESSION_CACHE_TTL_MS;
  });
  it("should load session store from disk on first call", async () => {
    const testStore = {
      "session:1": {
        sessionId: "id-1",
        updatedAt: Date.now(),
        displayName: "Test Session 1",
      },
    };
    await saveSessionStore(storePath, testStore);
    const loaded = loadSessionStore(storePath);
    expect(loaded).toEqual(testStore);
  });
  it("should cache session store on first load when file is unchanged", async () => {
    const testStore = {
      "session:1": {
        sessionId: "id-1",
        updatedAt: Date.now(),
        displayName: "Test Session 1",
      },
    };
    await saveSessionStore(storePath, testStore);
    const readSpy = vi.spyOn(fs, "readFileSync");
    const loaded1 = loadSessionStore(storePath);
    expect(loaded1).toEqual(testStore);
    const loaded2 = loadSessionStore(storePath);
    expect(loaded2).toEqual(testStore);
    expect(readSpy).toHaveBeenCalledTimes(1);
    readSpy.mockRestore();
  });
  it("should not allow cached session mutations to leak across loads", async () => {
    const testStore = {
      "session:1": {
        sessionId: "id-1",
        updatedAt: Date.now(),
        cliSessionIds: { openai: "sess-1" },
        skillsSnapshot: {
          prompt: "skills",
          skills: [{ name: "alpha" }],
        },
      },
    };
    await saveSessionStore(storePath, testStore);
    const loaded1 = loadSessionStore(storePath);
    loaded1["session:1"].cliSessionIds = { openai: "mutated" };
    if (loaded1["session:1"].skillsSnapshot?.skills?.length) {
      loaded1["session:1"].skillsSnapshot.skills[0].name = "mutated";
    }
    const loaded2 = loadSessionStore(storePath);
    expect(loaded2["session:1"].cliSessionIds?.openai).toBe("sess-1");
    expect(loaded2["session:1"].skillsSnapshot?.skills?.[0]?.name).toBe("alpha");
  });
  it("should refresh cache when store file changes on disk", async () => {
    const testStore = {
      "session:1": {
        sessionId: "id-1",
        updatedAt: Date.now(),
        displayName: "Test Session 1",
      },
    };
    await saveSessionStore(storePath, testStore);
    const loaded1 = loadSessionStore(storePath);
    expect(loaded1).toEqual(testStore);
    const modifiedStore = {
      "session:99": { sessionId: "id-99", updatedAt: Date.now() },
    };
    fs.writeFileSync(storePath, JSON.stringify(modifiedStore, null, 2));
    const bump = new Date(Date.now() + 2000);
    fs.utimesSync(storePath, bump, bump);
    const loaded2 = loadSessionStore(storePath);
    expect(loaded2).toEqual(modifiedStore);
  });
  it("should invalidate cache on write", async () => {
    const testStore = {
      "session:1": {
        sessionId: "id-1",
        updatedAt: Date.now(),
        displayName: "Test Session 1",
      },
    };
    await saveSessionStore(storePath, testStore);
    const loaded1 = loadSessionStore(storePath);
    expect(loaded1).toEqual(testStore);
    const updatedStore = {
      "session:1": {
        ...testStore["session:1"],
        displayName: "Updated Session 1",
      },
    };
    await saveSessionStore(storePath, updatedStore);
    const loaded2 = loadSessionStore(storePath);
    expect(loaded2["session:1"].displayName).toBe("Updated Session 1");
  });
  it("should respect GENOS_SESSION_CACHE_TTL_MS=0 to disable cache", async () => {
    process.env.GENOS_SESSION_CACHE_TTL_MS = "0";
    clearSessionStoreCacheForTest();
    const testStore = {
      "session:1": {
        sessionId: "id-1",
        updatedAt: Date.now(),
        displayName: "Test Session 1",
      },
    };
    await saveSessionStore(storePath, testStore);
    const loaded1 = loadSessionStore(storePath);
    expect(loaded1).toEqual(testStore);
    const modifiedStore = {
      "session:2": {
        sessionId: "id-2",
        updatedAt: Date.now(),
        displayName: "Test Session 2",
      },
    };
    fs.writeFileSync(storePath, JSON.stringify(modifiedStore, null, 2));
    const loaded2 = loadSessionStore(storePath);
    expect(loaded2).toEqual(modifiedStore);
  });
  it("should handle non-existent store gracefully", () => {
    const nonExistentPath = path.join(testDir, "non-existent.json");
    const loaded = loadSessionStore(nonExistentPath);
    expect(loaded).toEqual({});
  });
  it("should handle invalid JSON gracefully", async () => {
    fs.writeFileSync(storePath, "not valid json {");
    const loaded = loadSessionStore(storePath);
    expect(loaded).toEqual({});
  });
});
