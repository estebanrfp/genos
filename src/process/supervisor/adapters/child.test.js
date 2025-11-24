let createStubChild = function (pid = 1234) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.defineProperty(child, "pid", { value: pid, configurable: true });
  Object.defineProperty(child, "killed", { value: false, configurable: true, writable: true });
  const killMock = vi.fn(() => true);
  child.kill = killMock;
  return { child, killMock };
};
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { spawnWithFallbackMock, killProcessTreeMock } = vi.hoisted(() => ({
  spawnWithFallbackMock: vi.fn(),
  killProcessTreeMock: vi.fn(),
}));
vi.mock("../../spawn-utils.js", () => ({
  spawnWithFallback: (...args) => spawnWithFallbackMock(...args),
}));
vi.mock("../../kill-tree.js", () => ({
  killProcessTree: (...args) => killProcessTreeMock(...args),
}));
async function createAdapterHarness(params) {
  const { createChildAdapter } = await import("./child.js");
  const { child, killMock } = createStubChild(params?.pid);
  spawnWithFallbackMock.mockResolvedValue({
    child,
    usedFallback: false,
  });
  const adapter = await createChildAdapter({
    argv: params?.argv ?? ["node", "-e", "setTimeout(() => {}, 1000)"],
    env: params?.env,
    stdinMode: "pipe-open",
  });
  return { adapter, killMock };
}
describe("createChildAdapter", () => {
  beforeEach(() => {
    spawnWithFallbackMock.mockReset();
    killProcessTreeMock.mockReset();
  });
  it("uses process-tree kill for default SIGKILL", async () => {
    const { adapter, killMock } = await createAdapterHarness({ pid: 4321 });
    const spawnArgs = spawnWithFallbackMock.mock.calls[0]?.[0];
    if (process.platform === "win32") {
      expect(spawnArgs.options?.detached).toBe(false);
      expect(spawnArgs.fallbacks).toEqual([]);
    } else {
      expect(spawnArgs.options?.detached).toBe(true);
      expect(spawnArgs.fallbacks?.[0]?.options?.detached).toBe(false);
    }
    adapter.kill();
    expect(killProcessTreeMock).toHaveBeenCalledWith(4321);
    expect(killMock).not.toHaveBeenCalled();
  });
  it("uses direct child.kill for non-SIGKILL signals", async () => {
    const { adapter, killMock } = await createAdapterHarness({ pid: 7654 });
    adapter.kill("SIGTERM");
    expect(killProcessTreeMock).not.toHaveBeenCalled();
    expect(killMock).toHaveBeenCalledWith("SIGTERM");
  });
  it("keeps inherited env when no override env is provided", async () => {
    await createAdapterHarness({
      pid: 3333,
      argv: ["node", "-e", "process.exit(0)"],
    });
    const spawnArgs = spawnWithFallbackMock.mock.calls[0]?.[0];
    expect(spawnArgs.options?.env).toBeUndefined();
  });
  it("passes explicit env overrides as strings", async () => {
    await createAdapterHarness({
      pid: 4444,
      argv: ["node", "-e", "process.exit(0)"],
      env: { FOO: "bar", COUNT: "12", DROP_ME: undefined },
    });
    const spawnArgs = spawnWithFallbackMock.mock.calls[0]?.[0];
    expect(spawnArgs.options?.env).toEqual({ FOO: "bar", COUNT: "12" });
  });
});
