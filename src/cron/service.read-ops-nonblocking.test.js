import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-cron-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      try {
        await fs.rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 10,
        });
      } catch {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  };
}
describe("CronService read ops while job is running", () => {
  it("keeps list and status responsive during a long isolated run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-13T00:00:00.000Z"));
    const store = await makeStorePath();
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeatNow = vi.fn();
    let resolveFinished;
    const finished = new Promise((resolve) => {
      resolveFinished = resolve;
    });
    let resolveRun;
    let resolveRunStarted;
    const runStarted = new Promise((resolve) => {
      resolveRunStarted = resolve;
    });
    const runIsolatedAgentJob = vi.fn(async () => {
      resolveRunStarted?.();
      return await new Promise((resolve) => {
        resolveRun = resolve;
      });
    });
    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent,
      requestHeartbeatNow,
      runIsolatedAgentJob,
      onEvent: (evt) => {
        if (evt.action === "finished" && evt.status === "ok") {
          resolveFinished?.();
        }
      },
    });
    try {
      await cron.start();
      await cron.add({
        name: "slow isolated",
        enabled: true,
        deleteAfterRun: false,
        schedule: {
          kind: "at",
          at: new Date("2025-12-13T00:00:01.000Z").toISOString(),
        },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "long task" },
        delivery: { mode: "none" },
      });
      vi.setSystemTime(new Date("2025-12-13T00:00:01.000Z"));
      await vi.runOnlyPendingTimersAsync();
      await runStarted;
      expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
      await expect(cron.list({ includeDisabled: true })).resolves.toBeTypeOf("object");
      await expect(cron.status()).resolves.toBeTypeOf("object");
      const running = await cron.list({ includeDisabled: true });
      expect(running[0]?.state.runningAtMs).toBeTypeOf("number");
      resolveRun?.({ status: "ok", summary: "done" });
      await finished;
      await cron.status();
      const completed = await cron.list({ includeDisabled: true });
      expect(completed[0]?.state.lastStatus).toBe("ok");
      const internal = cron;
      for (let i = 0; i < 100; i += 1) {
        if (!internal.state?.running) {
          break;
        }
        await Promise.resolve();
      }
      expect(internal.state?.running).toBe(false);
    } finally {
      cron.stop();
      vi.clearAllTimers();
      vi.useRealTimers();
      await store.cleanup();
    }
  });
});
