import { describe, expect, it } from "vitest";
import { recomputeNextRuns, recomputeNextRunsForMaintenance } from "./service/jobs.js";
describe("issue #17852 - daily cron jobs should not skip days", () => {
  const HOUR_MS = 3600000;
  const DAY_MS = 24 * HOUR_MS;
  function createMockState(jobs, nowMs) {
    return {
      store: { version: 1, jobs },
      running: false,
      timer: null,
      storeLoadedAtMs: nowMs,
      storeFileMtimeMs: null,
      op: Promise.resolve(),
      warnedDisabled: false,
      deps: {
        storePath: "/mock/path",
        cronEnabled: true,
        nowMs: () => nowMs,
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
  function createDailyThreeAmJob(threeAM) {
    return {
      id: "daily-job",
      name: "daily 3am",
      enabled: true,
      schedule: { kind: "cron", expr: "0 3 * * *", tz: "UTC" },
      payload: { kind: "systemEvent", text: "daily task" },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      createdAtMs: threeAM - DAY_MS,
      updatedAtMs: threeAM - DAY_MS,
      state: {
        nextRunAtMs: threeAM,
      },
    };
  }
  it("recomputeNextRunsForMaintenance should NOT advance past-due nextRunAtMs", () => {
    const threeAM = Date.parse("2026-02-16T03:00:00.000Z");
    const now = threeAM + 1000;
    const job = createDailyThreeAmJob(threeAM);
    const state = createMockState([job], now);
    recomputeNextRunsForMaintenance(state);
    expect(job.state.nextRunAtMs).toBe(threeAM);
  });
  it("full recomputeNextRuns WOULD silently advance past-due nextRunAtMs (the bug)", () => {
    const threeAM = Date.parse("2026-02-16T03:00:00.000Z");
    const now = threeAM + 1000;
    const job = createDailyThreeAmJob(threeAM);
    const state = createMockState([job], now);
    recomputeNextRuns(state);
    const tomorrowThreeAM = threeAM + DAY_MS;
    expect(job.state.nextRunAtMs).toBe(tomorrowThreeAM);
  });
});
