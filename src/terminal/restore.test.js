let configureTerminalIO = function (params) {
  Object.defineProperty(process.stdin, "isTTY", { value: params.stdinIsTTY, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: params.stdoutIsTTY, configurable: true });
  process.stdin.setRawMode = params.setRawMode;
  process.stdin.resume = params.resume;
  process.stdin.isPaused = params.isPaused;
};
import { afterEach, describe, expect, it, vi } from "vitest";
const clearActiveProgressLine = vi.hoisted(() => vi.fn());
vi.mock("./progress-line.js", () => ({
  clearActiveProgressLine,
}));
import { restoreTerminalState } from "./restore.js";
describe("restoreTerminalState", () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalSetRawMode = process.stdin.setRawMode;
  const originalResume = process.stdin.resume;
  const originalIsPaused = process.stdin.isPaused;
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
    process.stdin.setRawMode = originalSetRawMode;
    process.stdin.resume = originalResume;
    process.stdin.isPaused = originalIsPaused;
  });
  it("does not resume paused stdin by default", () => {
    const setRawMode = vi.fn();
    const resume = vi.fn();
    const isPaused = vi.fn(() => true);
    configureTerminalIO({
      stdinIsTTY: true,
      stdoutIsTTY: false,
      setRawMode,
      resume,
      isPaused,
    });
    restoreTerminalState("test");
    expect(setRawMode).toHaveBeenCalledWith(false);
    expect(resume).not.toHaveBeenCalled();
  });
  it("resumes paused stdin when resumeStdin is true", () => {
    const setRawMode = vi.fn();
    const resume = vi.fn();
    const isPaused = vi.fn(() => true);
    configureTerminalIO({
      stdinIsTTY: true,
      stdoutIsTTY: false,
      setRawMode,
      resume,
      isPaused,
    });
    restoreTerminalState("test", { resumeStdinIfPaused: true });
    expect(setRawMode).toHaveBeenCalledWith(false);
    expect(resume).toHaveBeenCalledOnce();
  });
  it("does not touch stdin when stdin is not a TTY", () => {
    const setRawMode = vi.fn();
    const resume = vi.fn();
    const isPaused = vi.fn(() => true);
    configureTerminalIO({
      stdinIsTTY: false,
      stdoutIsTTY: false,
      setRawMode,
      resume,
      isPaused,
    });
    restoreTerminalState("test", { resumeStdinIfPaused: true });
    expect(setRawMode).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
