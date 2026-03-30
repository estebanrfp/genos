import { afterEach, describe, expect, it, vi } from "vitest";
import { startHeartbeatRunner } from "./heartbeat-runner.js";
import { requestHeartbeatNow, resetHeartbeatWakeStateForTests } from "./heartbeat-wake.js";
describe("startHeartbeatRunner", () => {
  function startDefaultRunner(runOnce) {
    return startHeartbeatRunner({
      cfg: {
        agents: { defaults: { heartbeat: { every: "30m" } } },
      },
      runOnce,
    });
  }
  afterEach(() => {
    resetHeartbeatWakeStateForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("updates scheduling when config changes without restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runner = startDefaultRunner(runSpy);
    await vi.advanceTimersByTimeAsync(1801000);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ agentId: "main", reason: "interval" }),
    );
    runner.updateConfig({
      agents: {
        defaults: { heartbeat: { every: "30m" } },
        list: [
          { id: "main", heartbeat: { every: "10m" } },
          { id: "ops", heartbeat: { every: "15m" } },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(601000);
    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(runSpy.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ agentId: "main", heartbeat: { every: "10m" } }),
    );
    await vi.advanceTimersByTimeAsync(301000);
    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(runSpy.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({ agentId: "ops", heartbeat: { every: "15m" } }),
    );
    runner.stop();
  });
  it("continues scheduling after runOnce throws an unhandled error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    let callCount = 0;
    const runSpy = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("session compaction error");
      }
      return { status: "ran", durationMs: 1 };
    });
    const runner = startDefaultRunner(runSpy);
    await vi.advanceTimersByTimeAsync(1801000);
    expect(runSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1801000);
    expect(runSpy).toHaveBeenCalledTimes(2);
    runner.stop();
  });
  it("cleanup is idempotent and does not clear a newer runner's handler", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const runSpy1 = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runSpy2 = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const cfg = {
      agents: { defaults: { heartbeat: { every: "30m" } } },
    };
    const runnerA = startHeartbeatRunner({ cfg, runOnce: runSpy1 });
    const runnerB = startHeartbeatRunner({ cfg, runOnce: runSpy2 });
    runnerA.stop();
    await vi.advanceTimersByTimeAsync(1801000);
    expect(runSpy2).toHaveBeenCalledTimes(1);
    expect(runSpy1).not.toHaveBeenCalled();
    runnerA.stop();
    runnerB.stop();
  });
  it("run() returns skipped when runner is stopped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runner = startDefaultRunner(runSpy);
    runner.stop();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(runSpy).not.toHaveBeenCalled();
  });
  it("reschedules timer when runOnce returns requests-in-flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    let callCount = 0;
    const runSpy = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { status: "skipped", reason: "requests-in-flight" };
      }
      return { status: "ran", durationMs: 1 };
    });
    const runner = startHeartbeatRunner({
      cfg: {
        agents: { defaults: { heartbeat: { every: "30m" } } },
      },
      runOnce: runSpy,
    });
    await vi.advanceTimersByTimeAsync(1801000);
    expect(runSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1801000);
    expect(runSpy).toHaveBeenCalledTimes(2);
    runner.stop();
  });
  it("routes targeted wake requests to the requested agent/session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runner = startHeartbeatRunner({
      cfg: {
        agents: {
          defaults: { heartbeat: { every: "30m" } },
          list: [
            { id: "main", heartbeat: { every: "30m" } },
            { id: "ops", heartbeat: { every: "15m" } },
          ],
        },
      },
      runOnce: runSpy,
    });
    requestHeartbeatNow({
      reason: "cron:job-123",
      agentId: "ops",
      sessionKey: "agent:ops:discord:channel:alerts",
      coalesceMs: 0,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "ops",
        reason: "cron:job-123",
        sessionKey: "agent:ops:discord:channel:alerts",
      }),
    );
    runner.stop();
  });
});
