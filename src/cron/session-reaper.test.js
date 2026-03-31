let createTestLogger = function () {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
};
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { isCronRunSessionKey } from "../sessions/session-key-utils.js";
import { sweepCronRunSessions, resolveRetentionMs, resetReaperThrottle } from "./session-reaper.js";
describe("resolveRetentionMs", () => {
  it("returns 24h default when no config", () => {
    expect(resolveRetentionMs()).toBe(86400000);
  });
  it("returns 24h default when config is empty", () => {
    expect(resolveRetentionMs({})).toBe(86400000);
  });
  it("parses duration string", () => {
    expect(resolveRetentionMs({ sessionRetention: "1h" })).toBe(3600000);
    expect(resolveRetentionMs({ sessionRetention: "7d" })).toBe(604800000);
    expect(resolveRetentionMs({ sessionRetention: "30m" })).toBe(1800000);
  });
  it("returns null when disabled", () => {
    expect(resolveRetentionMs({ sessionRetention: false })).toBeNull();
  });
  it("falls back to default on invalid string", () => {
    expect(resolveRetentionMs({ sessionRetention: "abc" })).toBe(86400000);
  });
});
describe("isCronRunSessionKey", () => {
  it("matches cron run session keys", () => {
    expect(isCronRunSessionKey("agent:default:cron:abc-123:run:def-456")).toBe(true);
    expect(isCronRunSessionKey("agent:debugger:cron:249ecf82:run:1102aabb")).toBe(true);
  });
  it("does not match base cron session keys", () => {
    expect(isCronRunSessionKey("agent:default:cron:abc-123")).toBe(false);
  });
  it("does not match regular session keys", () => {
    expect(isCronRunSessionKey("agent:default:telegram:dm:123")).toBe(false);
  });
  it("does not match non-canonical cron-like keys", () => {
    expect(isCronRunSessionKey("agent:default:slack:cron:job:run:uuid")).toBe(false);
    expect(isCronRunSessionKey("cron:job:run:uuid")).toBe(false);
  });
});
describe("sweepCronRunSessions", () => {
  let tmpDir;
  let storePath;
  const log = createTestLogger();
  beforeEach(async () => {
    resetReaperThrottle();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-reaper-"));
    storePath = path.join(tmpDir, "sessions.json");
  });
  it("prunes expired cron run sessions", async () => {
    const now = Date.now();
    const store = {
      "agent:default:cron:job1": {
        sessionId: "base-session",
        updatedAt: now,
      },
      "agent:default:cron:job1:run:old-run": {
        sessionId: "old-run",
        updatedAt: now - 90000000,
      },
      "agent:default:cron:job1:run:recent-run": {
        sessionId: "recent-run",
        updatedAt: now - 3600000,
      },
      "agent:default:telegram:dm:123": {
        sessionId: "regular-session",
        updatedAt: now - 360000000,
      },
    };
    fs.writeFileSync(storePath, JSON.stringify(store));
    const result = await sweepCronRunSessions({
      sessionStorePath: storePath,
      nowMs: now,
      log,
      force: true,
    });
    expect(result.swept).toBe(true);
    expect(result.pruned).toBe(1);
    const updated = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    expect(updated["agent:default:cron:job1"]).toBeDefined();
    expect(updated["agent:default:cron:job1:run:old-run"]).toBeUndefined();
    expect(updated["agent:default:cron:job1:run:recent-run"]).toBeDefined();
    expect(updated["agent:default:telegram:dm:123"]).toBeDefined();
  });
  it("respects custom retention", async () => {
    const now = Date.now();
    const store = {
      "agent:default:cron:job1:run:run1": {
        sessionId: "run1",
        updatedAt: now - 7200000,
      },
    };
    fs.writeFileSync(storePath, JSON.stringify(store));
    const result = await sweepCronRunSessions({
      cronConfig: { sessionRetention: "1h" },
      sessionStorePath: storePath,
      nowMs: now,
      log,
      force: true,
    });
    expect(result.pruned).toBe(1);
  });
  it("does nothing when pruning is disabled", async () => {
    const now = Date.now();
    const store = {
      "agent:default:cron:job1:run:run1": {
        sessionId: "run1",
        updatedAt: now - 360000000,
      },
    };
    fs.writeFileSync(storePath, JSON.stringify(store));
    const result = await sweepCronRunSessions({
      cronConfig: { sessionRetention: false },
      sessionStorePath: storePath,
      nowMs: now,
      log,
      force: true,
    });
    expect(result.swept).toBe(false);
    expect(result.pruned).toBe(0);
  });
  it("throttles sweeps without force", async () => {
    const now = Date.now();
    fs.writeFileSync(storePath, JSON.stringify({}));
    const r1 = await sweepCronRunSessions({
      sessionStorePath: storePath,
      nowMs: now,
      log,
    });
    expect(r1.swept).toBe(true);
    const r2 = await sweepCronRunSessions({
      sessionStorePath: storePath,
      nowMs: now + 1000,
      log,
    });
    expect(r2.swept).toBe(false);
  });
  it("throttles per store path", async () => {
    const now = Date.now();
    const otherPath = path.join(tmpDir, "sessions-other.json");
    fs.writeFileSync(storePath, JSON.stringify({}));
    fs.writeFileSync(otherPath, JSON.stringify({}));
    const r1 = await sweepCronRunSessions({
      sessionStorePath: storePath,
      nowMs: now,
      log,
    });
    expect(r1.swept).toBe(true);
    const r2 = await sweepCronRunSessions({
      sessionStorePath: otherPath,
      nowMs: now + 1000,
      log,
    });
    expect(r2.swept).toBe(true);
    const r3 = await sweepCronRunSessions({
      sessionStorePath: storePath,
      nowMs: now + 1000,
      log,
    });
    expect(r3.swept).toBe(false);
  });
});
