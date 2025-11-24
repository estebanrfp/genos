import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { CronService } from "./service.js";
import { createCronServiceState } from "./service/state.js";
export function createNoopLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
export function createCronStoreHarness(options) {
  let fixtureRoot = "";
  let caseId = 0;
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), options?.prefix ?? "genosos-cron-"));
  });
  afterAll(async () => {
    if (!fixtureRoot) {
      return;
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  async function makeStorePath() {
    const dir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(dir, { recursive: true });
    return {
      storePath: path.join(dir, "cron", "jobs.json"),
      cleanup: async () => {},
    };
  }
  return { makeStorePath };
}
export function installCronTestHooks(options) {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(options.baseTimeIso ?? "2025-12-13T00:00:00.000Z"));
    options.logger.debug.mockClear();
    options.logger.info.mockClear();
    options.logger.warn.mockClear();
    options.logger.error.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
export function createFinishedBarrier() {
  const resolvers = new Map();
  return {
    waitForOk: (jobId) =>
      new Promise((resolve) => {
        resolvers.set(jobId, resolve);
      }),
    onEvent: (evt) => {
      if (evt.action !== "finished" || evt.status !== "ok") {
        return;
      }
      const resolve = resolvers.get(evt.jobId);
      if (!resolve) {
        return;
      }
      resolvers.delete(evt.jobId);
      resolve(evt);
    },
  };
}
export function createStartedCronServiceWithFinishedBarrier(params) {
  const enqueueSystemEvent = vi.fn();
  const requestHeartbeatNow = vi.fn();
  const finished = createFinishedBarrier();
  const cron = new CronService({
    storePath: params.storePath,
    cronEnabled: true,
    log: params.logger,
    enqueueSystemEvent,
    requestHeartbeatNow,
    runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    onEvent: finished.onEvent,
  });
  return { cron, enqueueSystemEvent, requestHeartbeatNow, finished };
}
export function createRunningCronServiceState(params) {
  const state = createCronServiceState({
    cronEnabled: true,
    storePath: params.storePath,
    log: params.log,
    nowMs: params.nowMs,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "ok", summary: "ok" }),
  });
  state.running = true;
  state.store = {
    version: 1,
    jobs: params.jobs,
  };
  return state;
}
