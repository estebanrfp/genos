let createDeferred = function () {
    let resolve = () => {};
    let reject = () => {};
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      promise,
      resolve,
      reject,
    };
  },
  createManagedRun = function (exit) {
    return {
      runId: "run-test",
      pid: 12345,
      startedAtMs: Date.now(),
      wait: async () => await exit,
      cancel: vi.fn(),
    };
  },
  successExit = function (payload) {
    return {
      reason: "exit",
      exitCode: 0,
      exitSignal: null,
      durationMs: 1,
      stdout: JSON.stringify(payload),
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    };
  };
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runClaudeCliAgent } from "./claude-cli-runner.js";
const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));
vi.mock("../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => ({
    spawn: (...args) => mocks.spawn(...args),
    cancel: vi.fn(),
    cancelScope: vi.fn(),
    reconcileOrphans: async () => {},
    getRecord: vi.fn(),
  }),
}));
async function waitForCalls(mockFn, count) {
  await vi.waitFor(
    () => {
      expect(mockFn.mock.calls.length).toBeGreaterThanOrEqual(count);
    },
    { timeout: 2000, interval: 5 },
  );
}
describe("runClaudeCliAgent", () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
  });
  it("starts a new session with --session-id when none is provided", async () => {
    mocks.spawn.mockResolvedValueOnce(
      createManagedRun(Promise.resolve(successExit({ message: "ok", session_id: "sid-1" }))),
    );
    await runClaudeCliAgent({
      sessionId: "genosos-session",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      model: "opus",
      timeoutMs: 1000,
      runId: "run-1",
    });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const spawnInput = mocks.spawn.mock.calls[0]?.[0];
    expect(spawnInput.mode).toBe("child");
    expect(spawnInput.argv).toContain("claude");
    expect(spawnInput.argv).toContain("--session-id");
    expect(spawnInput.argv).toContain("hi");
  });
  it("uses --resume when a claude session id is provided", async () => {
    mocks.spawn.mockResolvedValueOnce(
      createManagedRun(Promise.resolve(successExit({ message: "ok", session_id: "sid-2" }))),
    );
    await runClaudeCliAgent({
      sessionId: "genosos-session",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      model: "opus",
      timeoutMs: 1000,
      runId: "run-2",
      claudeSessionId: "c9d7b831-1c31-4d22-80b9-1e50ca207d4b",
    });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const spawnInput = mocks.spawn.mock.calls[0]?.[0];
    expect(spawnInput.argv).toContain("--resume");
    expect(spawnInput.argv).toContain("c9d7b831-1c31-4d22-80b9-1e50ca207d4b");
    expect(spawnInput.argv).not.toContain("--session-id");
    expect(spawnInput.argv).toContain("hi");
  });
  it("serializes concurrent claude-cli runs", async () => {
    const firstDeferred = createDeferred();
    const secondDeferred = createDeferred();
    mocks.spawn
      .mockResolvedValueOnce(createManagedRun(firstDeferred.promise))
      .mockResolvedValueOnce(createManagedRun(secondDeferred.promise));
    const firstRun = runClaudeCliAgent({
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "first",
      model: "opus",
      timeoutMs: 1000,
      runId: "run-1",
    });
    const secondRun = runClaudeCliAgent({
      sessionId: "s2",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "second",
      model: "opus",
      timeoutMs: 1000,
      runId: "run-2",
    });
    await waitForCalls(mocks.spawn, 1);
    firstDeferred.resolve(successExit({ message: "ok", session_id: "sid-1" }));
    await waitForCalls(mocks.spawn, 2);
    secondDeferred.resolve(successExit({ message: "ok", session_id: "sid-2" }));
    await Promise.all([firstRun, secondRun]);
  });
});
