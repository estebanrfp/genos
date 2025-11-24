let cleanupRunningSession = function (sessionId) {
  const running = getSession(sessionId);
  const pid = running?.pid;
  if (pid) {
    killProcessTree(pid);
  }
  return running;
};
import { afterEach, expect, test } from "vitest";
import {
  getFinishedSession,
  getSession,
  resetProcessRegistryForTests,
} from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
import { killProcessTree } from "./shell-utils.js";
afterEach(() => {
  resetProcessRegistryForTests();
});
async function waitForFinishedSession(sessionId) {
  let finished = getFinishedSession(sessionId);
  await expect
    .poll(
      () => {
        finished = getFinishedSession(sessionId);
        return Boolean(finished);
      },
      {
        timeout: process.platform === "win32" ? 1e4 : 2000,
        interval: 20,
      },
    )
    .toBe(true);
  return finished;
}
async function expectBackgroundSessionSurvivesAbort(params) {
  const abortController = new AbortController();
  const result = await params.tool.execute(
    "toolcall",
    params.executeParams,
    abortController.signal,
  );
  expect(result.details.status).toBe("running");
  const sessionId = result.details.sessionId;
  abortController.abort();
  const startedAt = Date.now();
  await expect
    .poll(
      () => {
        const running = getSession(sessionId);
        const finished = getFinishedSession(sessionId);
        return Date.now() - startedAt >= 100 && !finished && running?.exited === false;
      },
      { timeout: process.platform === "win32" ? 1500 : 800, interval: 20 },
    )
    .toBe(true);
  const running = getSession(sessionId);
  const finished = getFinishedSession(sessionId);
  try {
    expect(finished).toBeUndefined();
    expect(running?.exited).toBe(false);
  } finally {
    cleanupRunningSession(sessionId);
  }
}
async function expectBackgroundSessionTimesOut(params) {
  const abortController = new AbortController();
  const signal = params.signal ?? abortController.signal;
  const result = await params.tool.execute("toolcall", params.executeParams, signal);
  expect(result.details.status).toBe("running");
  const sessionId = result.details.sessionId;
  if (params.abortAfterStart) {
    abortController.abort();
  }
  const finished = await waitForFinishedSession(sessionId);
  try {
    expect(finished).toBeTruthy();
    expect(finished?.status).toBe("failed");
  } finally {
    cleanupRunningSession(sessionId);
  }
}
test("background exec is not killed when tool signal aborts", async () => {
  const tool = createExecTool({ allowBackground: true, backgroundMs: 0 });
  await expectBackgroundSessionSurvivesAbort({
    tool,
    executeParams: { command: 'node -e "setTimeout(() => {}, 5000)"', background: true },
  });
});
test("pty background exec is not killed when tool signal aborts", async () => {
  const tool = createExecTool({ allowBackground: true, backgroundMs: 0 });
  await expectBackgroundSessionSurvivesAbort({
    tool,
    executeParams: { command: 'node -e "setTimeout(() => {}, 5000)"', background: true, pty: true },
  });
});
test("background exec still times out after tool signal abort", async () => {
  const tool = createExecTool({ allowBackground: true, backgroundMs: 0 });
  await expectBackgroundSessionTimesOut({
    tool,
    executeParams: {
      command: 'node -e "setTimeout(() => {}, 5000)"',
      background: true,
      timeout: 0.2,
    },
    abortAfterStart: true,
  });
});
test("yielded background exec is not killed when tool signal aborts", async () => {
  const tool = createExecTool({ allowBackground: true, backgroundMs: 10 });
  await expectBackgroundSessionSurvivesAbort({
    tool,
    executeParams: { command: 'node -e "setTimeout(() => {}, 5000)"', yieldMs: 5 },
  });
});
test("yielded background exec still times out", async () => {
  const tool = createExecTool({ allowBackground: true, backgroundMs: 10 });
  await expectBackgroundSessionTimesOut({
    tool,
    executeParams: {
      command: 'node -e "setTimeout(() => {}, 5000)"',
      yieldMs: 5,
      timeout: 0.2,
    },
  });
});
