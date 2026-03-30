let waitForLine = function (stream, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for line"));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString();
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        cleanup();
        resolve(line);
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      stream.off("data", onData);
      stream.off("error", onError);
    };
    stream.on("data", onData);
    stream.on("error", onError);
  });
};
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { attachChildProcessBridge } from "./child-process-bridge.js";
describe("attachChildProcessBridge", () => {
  const children = [];
  const detachments = [];
  afterEach(() => {
    for (const detach of detachments) {
      try {
        detach();
      } catch {}
    }
    detachments.length = 0;
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    children.length = 0;
  });
  it("forwards SIGTERM to the wrapped child", async () => {
    const childPath = path.resolve(process.cwd(), "test/fixtures/child-process-bridge/child.js");
    const beforeSigterm = new Set(process.listeners("SIGTERM"));
    const child = spawn(process.execPath, [childPath], {
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    });
    const { detach } = attachChildProcessBridge(child);
    detachments.push(detach);
    children.push(child);
    const afterSigterm = process.listeners("SIGTERM");
    const addedSigterm = afterSigterm.find((listener) => !beforeSigterm.has(listener));
    if (!child.stdout) {
      throw new Error("expected stdout");
    }
    const ready = await waitForLine(child.stdout);
    expect(ready).toBe("ready");
    if (!addedSigterm) {
      throw new Error("expected SIGTERM listener");
    }
    addedSigterm("SIGTERM");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout waiting for child exit")), 1e4);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }, 20000);
});
