let hasUnconsumedRestartSignal = function () {
    return emittedRestartToken > consumedRestartToken;
  },
  resetSigusr1AuthorizationIfExpired = function (now = Date.now()) {
    if (sigusr1AuthorizedCount <= 0) {
      return;
    }
    if (now <= sigusr1AuthorizedUntil) {
      return;
    }
    sigusr1AuthorizedCount = 0;
    sigusr1AuthorizedUntil = 0;
  },
  authorizeGatewaySigusr1Restart = function (delayMs = 0) {
    const delay = Math.max(0, Math.floor(delayMs));
    const expiresAt = Date.now() + delay + SIGUSR1_AUTH_GRACE_MS;
    sigusr1AuthorizedCount += 1;
    if (expiresAt > sigusr1AuthorizedUntil) {
      sigusr1AuthorizedUntil = expiresAt;
    }
  },
  formatSpawnDetail = function (result) {
    const clean = (value) => {
      const text = typeof value === "string" ? value : value ? value.toString() : "";
      return text.replace(/\s+/g, " ").trim();
    };
    if (result.error) {
      if (result.error instanceof Error) {
        return result.error.message;
      }
      if (typeof result.error === "string") {
        return result.error;
      }
      try {
        return JSON.stringify(result.error);
      } catch {
        return "unknown error";
      }
    }
    const stderr = clean(result.stderr);
    if (stderr) {
      return stderr;
    }
    const stdout = clean(result.stdout);
    if (stdout) {
      return stdout;
    }
    if (typeof result.status === "number") {
      return `exit ${result.status}`;
    }
    return "unknown error";
  },
  normalizeSystemdUnit = function (raw, profile) {
    const unit = raw?.trim();
    if (!unit) {
      return `${resolveGatewaySystemdServiceName(profile)}.service`;
    }
    return unit.endsWith(".service") ? unit : `${unit}.service`;
  };
import { spawnSync } from "node:child_process";
import {
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
} from "../daemon/constants.js";
const SPAWN_TIMEOUT_MS = 2000;
const SIGUSR1_AUTH_GRACE_MS = 5000;
const DEFAULT_DEFERRAL_POLL_MS = 500;
const DEFAULT_DEFERRAL_MAX_WAIT_MS = 30000;
let sigusr1AuthorizedCount = 0;
let sigusr1AuthorizedUntil = 0;
let sigusr1ExternalAllowed = false;
let preRestartCheck = null;
let restartCycleToken = 0;
let emittedRestartToken = 0;
let consumedRestartToken = 0;
export function setPreRestartDeferralCheck(fn) {
  preRestartCheck = fn;
}
export function emitGatewayRestart() {
  if (hasUnconsumedRestartSignal()) {
    return false;
  }
  const cycleToken = ++restartCycleToken;
  emittedRestartToken = cycleToken;
  authorizeGatewaySigusr1Restart();
  try {
    if (process.listenerCount("SIGUSR1") > 0) {
      process.emit("SIGUSR1");
    } else {
      process.kill(process.pid, "SIGUSR1");
    }
  } catch {
    emittedRestartToken = consumedRestartToken;
    return false;
  }
  return true;
}
export function setGatewaySigusr1RestartPolicy(opts) {
  sigusr1ExternalAllowed = opts?.allowExternal === true;
}
export function isGatewaySigusr1RestartExternallyAllowed() {
  return sigusr1ExternalAllowed;
}
export function consumeGatewaySigusr1RestartAuthorization() {
  resetSigusr1AuthorizationIfExpired();
  if (sigusr1AuthorizedCount <= 0) {
    return false;
  }
  sigusr1AuthorizedCount -= 1;
  if (sigusr1AuthorizedCount <= 0) {
    sigusr1AuthorizedUntil = 0;
  }
  return true;
}
export function markGatewaySigusr1RestartHandled() {
  if (hasUnconsumedRestartSignal()) {
    consumedRestartToken = emittedRestartToken;
  }
}
export function deferGatewayRestartUntilIdle(opts) {
  const pollMsRaw = opts.pollMs ?? DEFAULT_DEFERRAL_POLL_MS;
  const pollMs = Math.max(10, Math.floor(pollMsRaw));
  const maxWaitMsRaw = opts.maxWaitMs ?? DEFAULT_DEFERRAL_MAX_WAIT_MS;
  const maxWaitMs = Math.max(pollMs, Math.floor(maxWaitMsRaw));
  let pending;
  try {
    pending = opts.getPendingCount();
  } catch (err) {
    opts.hooks?.onCheckError?.(err);
    emitGatewayRestart();
    return;
  }
  if (pending <= 0) {
    opts.hooks?.onReady?.();
    emitGatewayRestart();
    return;
  }
  opts.hooks?.onDeferring?.(pending);
  const startedAt = Date.now();
  const poll = setInterval(() => {
    let current;
    try {
      current = opts.getPendingCount();
    } catch (err) {
      clearInterval(poll);
      opts.hooks?.onCheckError?.(err);
      emitGatewayRestart();
      return;
    }
    if (current <= 0) {
      clearInterval(poll);
      opts.hooks?.onReady?.();
      emitGatewayRestart();
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxWaitMs) {
      clearInterval(poll);
      opts.hooks?.onTimeout?.(current, elapsedMs);
      emitGatewayRestart();
    }
  }, pollMs);
}
export function triggerGenosOSRestart() {
  if (process.env.VITEST || false) {
    return { ok: true, method: "supervisor", detail: "test mode" };
  }
  const tried = [];
  if (process.platform !== "darwin") {
    if (process.platform === "linux") {
      const unit = normalizeSystemdUnit(process.env.GENOS_SYSTEMD_UNIT, process.env.GENOS_PROFILE);
      const userArgs = ["--user", "restart", unit];
      tried.push(`systemctl ${userArgs.join(" ")}`);
      const userRestart = spawnSync("systemctl", userArgs, {
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
      });
      if (!userRestart.error && userRestart.status === 0) {
        return { ok: true, method: "systemd", tried };
      }
      const systemArgs = ["restart", unit];
      tried.push(`systemctl ${systemArgs.join(" ")}`);
      const systemRestart = spawnSync("systemctl", systemArgs, {
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
      });
      if (!systemRestart.error && systemRestart.status === 0) {
        return { ok: true, method: "systemd", tried };
      }
      const detail = [
        `user: ${formatSpawnDetail(userRestart)}`,
        `system: ${formatSpawnDetail(systemRestart)}`,
      ].join("; ");
      return { ok: false, method: "systemd", detail, tried };
    }
    return {
      ok: false,
      method: "supervisor",
      detail: "unsupported platform restart",
    };
  }
  const label =
    process.env.GENOS_LAUNCHD_LABEL || resolveGatewayLaunchAgentLabel(process.env.GENOS_PROFILE);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const target = uid !== undefined ? `gui/${uid}/${label}` : label;
  const args = ["kickstart", "-k", target];
  tried.push(`launchctl ${args.join(" ")}`);
  const res = spawnSync("launchctl", args, {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (!res.error && res.status === 0) {
    return { ok: true, method: "launchctl", tried };
  }
  return {
    ok: false,
    method: "launchctl",
    detail: formatSpawnDetail(res),
    tried,
  };
}
export function scheduleGatewaySigusr1Restart(opts) {
  const delayMsRaw =
    typeof opts?.delayMs === "number" && Number.isFinite(opts.delayMs)
      ? Math.floor(opts.delayMs)
      : 2000;
  const delayMs = Math.min(Math.max(delayMsRaw, 0), 60000);
  const reason =
    typeof opts?.reason === "string" && opts.reason.trim()
      ? opts.reason.trim().slice(0, 200)
      : undefined;
  setTimeout(() => {
    const pendingCheck = preRestartCheck;
    if (!pendingCheck) {
      emitGatewayRestart();
      return;
    }
    deferGatewayRestartUntilIdle({ getPendingCount: pendingCheck });
  }, delayMs);
  return {
    ok: true,
    pid: process.pid,
    signal: "SIGUSR1",
    delayMs,
    reason,
    mode: process.listenerCount("SIGUSR1") > 0 ? "emit" : "signal",
  };
}
export const __testing = {
  resetSigusr1State() {
    sigusr1AuthorizedCount = 0;
    sigusr1AuthorizedUntil = 0;
    sigusr1ExternalAllowed = false;
    preRestartCheck = null;
    restartCycleToken = 0;
    emittedRestartToken = 0;
    consumedRestartToken = 0;
  },
};
