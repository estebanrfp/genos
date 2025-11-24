let createStubPtyAdapter = function () {
  return {
    pid: 1234,
    stdin: undefined,
    onStdout: (_listener) => {},
    onStderr: (_listener) => {},
    wait: async () => ({ code: 0, signal: null }),
    kill: (_signal) => {},
    dispose: () => {},
  };
};
import { beforeEach, describe, expect, it, vi } from "vitest";
const { createPtyAdapterMock } = vi.hoisted(() => ({
  createPtyAdapterMock: vi.fn(),
}));
vi.mock("../../agents/shell-utils.js", () => ({
  getShellConfig: () => ({ shell: "sh", args: ["-c"] }),
}));
vi.mock("./adapters/pty.js", () => ({
  createPtyAdapter: (...args) => createPtyAdapterMock(...args),
}));
describe("process supervisor PTY command contract", () => {
  beforeEach(() => {
    createPtyAdapterMock.mockReset();
  });
  it("passes PTY command verbatim to shell args", async () => {
    createPtyAdapterMock.mockResolvedValue(createStubPtyAdapter());
    const { createProcessSupervisor } = await import("./supervisor.js");
    const supervisor = createProcessSupervisor();
    const command = `printf '%s\\n' "a b" && printf '%s\\n' '$HOME'`;
    const run = await supervisor.spawn({
      sessionId: "s1",
      backendId: "test",
      mode: "pty",
      ptyCommand: command,
      timeoutMs: 1000,
    });
    const exit = await run.wait();
    expect(exit.reason).toBe("exit");
    expect(createPtyAdapterMock).toHaveBeenCalledTimes(1);
    const params = createPtyAdapterMock.mock.calls[0]?.[0];
    expect(params.args).toEqual(["-c", command]);
  });
  it("rejects empty PTY command", async () => {
    createPtyAdapterMock.mockResolvedValue(createStubPtyAdapter());
    const { createProcessSupervisor } = await import("./supervisor.js");
    const supervisor = createProcessSupervisor();
    await expect(
      supervisor.spawn({
        sessionId: "s1",
        backendId: "test",
        mode: "pty",
        ptyCommand: "   ",
      }),
    ).rejects.toThrow("PTY command cannot be empty");
    expect(createPtyAdapterMock).not.toHaveBeenCalled();
  });
});
