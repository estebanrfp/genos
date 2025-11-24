import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSession,
  appendOutput,
  drainSession,
  listFinishedSessions,
  markBackgrounded,
  markExited,
  resetProcessRegistryForTests,
} from "./bash-process-registry.js";
import { createProcessSessionFixture } from "./bash-process-registry.test-helpers.js";
describe("bash process registry", () => {
  function createRegistrySession(params) {
    return createProcessSessionFixture({
      id: params.id ?? "sess",
      command: "echo test",
      child: { pid: 123, removeAllListeners: vi.fn() },
      maxOutputChars: params.maxOutputChars,
      pendingMaxOutputChars: params.pendingMaxOutputChars,
      backgrounded: params.backgrounded,
    });
  }
  beforeEach(() => {
    resetProcessRegistryForTests();
  });
  it("captures output and truncates", () => {
    const session = createRegistrySession({
      maxOutputChars: 10,
      pendingMaxOutputChars: 30000,
      backgrounded: false,
    });
    addSession(session);
    appendOutput(session, "stdout", "0123456789");
    appendOutput(session, "stdout", "abcdef");
    expect(session.aggregated).toBe("6789abcdef");
    expect(session.truncated).toBe(true);
  });
  it("caps pending output to avoid runaway polls", () => {
    const session = createRegistrySession({
      maxOutputChars: 1e5,
      pendingMaxOutputChars: 20000,
      backgrounded: true,
    });
    addSession(session);
    const payload = `${"a".repeat(70000)}${"b".repeat(20000)}`;
    appendOutput(session, "stdout", payload);
    const drained = drainSession(session);
    expect(drained.stdout).toBe("b".repeat(20000));
    expect(session.pendingStdout).toHaveLength(0);
    expect(session.pendingStdoutChars).toBe(0);
    expect(session.truncated).toBe(true);
  });
  it("respects max output cap when pending cap is larger", () => {
    const session = createRegistrySession({
      maxOutputChars: 5000,
      pendingMaxOutputChars: 30000,
      backgrounded: true,
    });
    addSession(session);
    appendOutput(session, "stdout", "x".repeat(1e4));
    const drained = drainSession(session);
    expect(drained.stdout.length).toBe(5000);
    expect(session.truncated).toBe(true);
  });
  it("caps stdout and stderr independently", () => {
    const session = createRegistrySession({
      maxOutputChars: 100,
      pendingMaxOutputChars: 10,
      backgrounded: true,
    });
    addSession(session);
    appendOutput(session, "stdout", "a".repeat(6));
    appendOutput(session, "stdout", "b".repeat(6));
    appendOutput(session, "stderr", "c".repeat(12));
    const drained = drainSession(session);
    expect(drained.stdout).toBe("a".repeat(4) + "b".repeat(6));
    expect(drained.stderr).toBe("c".repeat(10));
    expect(session.truncated).toBe(true);
  });
  it("only persists finished sessions when backgrounded", () => {
    const session = createRegistrySession({
      maxOutputChars: 100,
      pendingMaxOutputChars: 30000,
      backgrounded: false,
    });
    addSession(session);
    markExited(session, 0, null, "completed");
    expect(listFinishedSessions()).toHaveLength(0);
    markBackgrounded(session);
    markExited(session, 0, null, "completed");
    expect(listFinishedSessions()).toHaveLength(1);
  });
});
