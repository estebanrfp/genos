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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-cron-delivery-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
async function withCronService(params, run) {
  const store = await makeStorePath();
  const enqueueSystemEvent = vi.fn();
  const requestHeartbeatNow = vi.fn();
  const cron = new CronService({
    cronEnabled: true,
    storePath: store.storePath,
    log: noopLogger,
    enqueueSystemEvent,
    requestHeartbeatNow,
    runIsolatedAgentJob:
      params.runIsolatedAgentJob ?? vi.fn(async () => ({ status: "ok", summary: "done" })),
  });
  await cron.start();
  try {
    await run({ cron, enqueueSystemEvent, requestHeartbeatNow });
  } finally {
    cron.stop();
    await store.cleanup();
  }
}
async function addIsolatedAgentTurnJob(cron, params) {
  return cron.add({
    name: params.name,
    enabled: true,
    schedule: { kind: "every", everyMs: 60000, anchorMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: params.wakeMode,
    payload: {
      kind: "agentTurn",
      message: "hello",
      ...params.payload,
    },
    ...(params.delivery
      ? {
          delivery: params.delivery,
        }
      : {}),
  });
}
describe("CronService delivery plan consistency", () => {
  it("does not post isolated summary when legacy deliver=false", async () => {
    await withCronService({}, async ({ cron, enqueueSystemEvent }) => {
      const job = await addIsolatedAgentTurnJob(cron, {
        name: "legacy-off",
        wakeMode: "next-heartbeat",
        payload: { deliver: false },
      });
      const result = await cron.run(job.id, "force");
      expect(result).toEqual({ ok: true, ran: true });
      expect(enqueueSystemEvent).not.toHaveBeenCalled();
    });
  });
  it("treats delivery object without mode as announce", async () => {
    await withCronService({}, async ({ cron, enqueueSystemEvent }) => {
      const job = await addIsolatedAgentTurnJob(cron, {
        name: "partial-delivery",
        wakeMode: "next-heartbeat",
        delivery: { channel: "telegram", to: "123" },
      });
      const result = await cron.run(job.id, "force");
      expect(result).toEqual({ ok: true, ran: true });
      expect(enqueueSystemEvent).toHaveBeenCalledWith(
        "Cron: done",
        expect.objectContaining({ agentId: undefined }),
      );
    });
  });
  it("does not enqueue duplicate relay when isolated run marks delivery handled", async () => {
    await withCronService(
      {
        runIsolatedAgentJob: vi.fn(async () => ({
          status: "ok",
          summary: "done",
          delivered: true,
        })),
      },
      async ({ cron, enqueueSystemEvent, requestHeartbeatNow }) => {
        const job = await addIsolatedAgentTurnJob(cron, {
          name: "announce-delivered",
          wakeMode: "now",
          delivery: { channel: "telegram", to: "123" },
        });
        const result = await cron.run(job.id, "force");
        expect(result).toEqual({ ok: true, ran: true });
        expect(enqueueSystemEvent).not.toHaveBeenCalled();
        expect(requestHeartbeatNow).not.toHaveBeenCalled();
      },
    );
  });
});
