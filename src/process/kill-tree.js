let normalizeGraceMs = function (value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_GRACE_MS;
    }
    return Math.max(0, Math.min(MAX_GRACE_MS, Math.floor(value)));
  },
  isProcessAlive = function (pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  killProcessTreeUnix = function (pid, graceMs) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        return;
      }
    }
    setTimeout(() => {
      if (isProcessAlive(-pid)) {
        try {
          process.kill(-pid, "SIGKILL");
          return;
        } catch {}
      }
      if (!isProcessAlive(pid)) {
        return;
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }, graceMs).unref();
  },
  runTaskkill = function (args) {
    try {
      spawn("taskkill", args, {
        stdio: "ignore",
        detached: true,
      });
    } catch {}
  },
  killProcessTreeWindows = function (pid, graceMs) {
    runTaskkill(["/T", "/PID", String(pid)]);
    setTimeout(() => {
      if (!isProcessAlive(pid)) {
        return;
      }
      runTaskkill(["/F", "/T", "/PID", String(pid)]);
    }, graceMs).unref();
  };
import { spawn } from "node:child_process";
const DEFAULT_GRACE_MS = 3000;
const MAX_GRACE_MS = 60000;
export function killProcessTree(pid, opts) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }
  const graceMs = normalizeGraceMs(opts?.graceMs);
  if (process.platform === "win32") {
    killProcessTreeWindows(pid, graceMs);
    return;
  }
  killProcessTreeUnix(pid, graceMs);
}
