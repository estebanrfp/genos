import { describe, expect, it } from "vitest";
import { recomputeNextRunsForMaintenance } from "./service/jobs.js";
describe("issue #13992 regression - cron jobs skip execution", () => {
  function createMockState(jobs) {
    return {
      store: { version: 1, jobs },
      running: false,
      timer: null,
      storeLoadedAtMs: Date.now(),
      storeFileMtimeMs: null,
      op: Promise.resolve(),
      warnedDisabled: false,
      deps: {
        storePath: "/mock/path",
        cronEnabled: true,
        nowMs: () => Date.now(),
        enqueueSystemEvent: () => {},
        requestHeartbeatNow: () => {},
        runIsolatedAgentJob: async () => ({ status: "ok" }),
        log: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      },
    };
  }
  it("should NOT recompute nextRunAtMs for past-due jobs during maintenance", () => {
    const now = Date.now();
    const pastDue = now - 60000;
    const job = {
      id: "test-job",
      name: "test job",
      enabled: true,
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
      payload: { kind: "systemEvent", text: "test" },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      createdAtMs: now - 3600000,
      updatedAtMs: now - 3600000,
      state: {
        nextRunAtMs: pastDue,
      },
    };
    const state = createMockState([job]);
    recomputeNextRunsForMaintenance(state);
    expect(job.state.nextRunAtMs).toBe(pastDue);
  });
  it("should compute missing nextRunAtMs during maintenance", () => {
    const now = Date.now();
    const job = {
      id: "test-job",
      name: "test job",
      enabled: true,
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
      payload: { kind: "systemEvent", text: "test" },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      createdAtMs: now,
      updatedAtMs: now,
      state: {},
    };
    const state = createMockState([job]);
    recomputeNextRunsForMaintenance(state);
    expect(typeof job.state.nextRunAtMs).toBe("number");
    expect(job.state.nextRunAtMs).toBeGreaterThan(now);
  });
  it("should clear nextRunAtMs for disabled jobs during maintenance", () => {
    const now = Date.now();
    const futureTime = now + 3600000;
    const job = {
      id: "test-job",
      name: "test job",
      enabled: false,
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
      payload: { kind: "systemEvent", text: "test" },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      createdAtMs: now,
      updatedAtMs: now,
      state: {
        nextRunAtMs: futureTime,
      },
    };
    const state = createMockState([job]);
    recomputeNextRunsForMaintenance(state);
    expect(job.state.nextRunAtMs).toBeUndefined();
  });
  it("should clear stuck running markers during maintenance", () => {
    const now = Date.now();
    const stuckTime = now - 10800000;
    const futureTime = now + 3600000;
    const job = {
      id: "test-job",
      name: "test job",
      enabled: true,
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
      payload: { kind: "systemEvent", text: "test" },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      createdAtMs: now,
      updatedAtMs: now,
      state: {
        nextRunAtMs: futureTime,
        runningAtMs: stuckTime,
      },
    };
    const state = createMockState([job]);
    recomputeNextRunsForMaintenance(state);
    expect(job.state.runningAtMs).toBeUndefined();
    expect(job.state.nextRunAtMs).toBe(futureTime);
  });
  it("isolates schedule errors while filling missing nextRunAtMs", () => {
    const now = Date.now();
    const pastDue = now - 1000;
    const dueJob = {
      id: "due-job",
      name: "due job",
      enabled: true,
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
      payload: { kind: "systemEvent", text: "due" },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      createdAtMs: now - 3600000,
      updatedAtMs: now - 3600000,
      state: {
        nextRunAtMs: pastDue,
      },
    };
    const malformedJob = {
      id: "bad-job",
      name: "bad job",
      enabled: true,
      schedule: { kind: "cron", expr: "not a valid cron", tz: "UTC" },
      payload: { kind: "systemEvent", text: "bad" },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      createdAtMs: now - 3600000,
      updatedAtMs: now - 3600000,
      state: {},
    };
    const state = createMockState([dueJob, malformedJob]);
    expect(() => recomputeNextRunsForMaintenance(state)).not.toThrow();
    expect(dueJob.state.nextRunAtMs).toBe(pastDue);
    expect(malformedJob.state.nextRunAtMs).toBeUndefined();
    expect(malformedJob.state.scheduleErrorCount).toBe(1);
    expect(malformedJob.state.lastError).toMatch(/^schedule error:/);
  });
});
