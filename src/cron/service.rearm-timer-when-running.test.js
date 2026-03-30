let createDueRecurringJob = function (params) {
  return {
    id: params.id,
    name: params.id,
    enabled: true,
    deleteAfterRun: false,
    createdAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
    schedule: { kind: "every", everyMs: 300000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "test" },
    delivery: { mode: "none" },
    state: { nextRunAtMs: params.nextRunAtMs },
  };
};
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCronStoreHarness,
  createNoopLogger,
  createRunningCronServiceState,
} from "./service.test-harness.js";
import { onTimer } from "./service/timer.js";
const noopLogger = createNoopLogger();
const { makeStorePath } = createCronStoreHarness();
describe("CronService - timer re-arm when running (#12025)", () => {
  beforeEach(() => {
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  it("re-arms the timer when onTimer is called while state.running is true", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const store = await makeStorePath();
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createDueRecurringJob({
          id: "recurring-job",
          nowMs: now,
          nextRunAtMs: now + 300000,
        }),
      ],
    });
    await onTimer(state);
    expect(state.timer).not.toBeNull();
    expect(timeoutSpy).toHaveBeenCalled();
    const delays = timeoutSpy.mock.calls
      .map(([, delay]) => delay)
      .filter((d) => typeof d === "number");
    expect(delays).toContain(60000);
    expect(state.running).toBe(true);
    timeoutSpy.mockRestore();
    await store.cleanup();
  });
});
