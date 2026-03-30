import { acquireGatewayLock } from "../../infra/gateway-lock.js";
import { restartGatewayProcessWithFreshPid } from "../../infra/process-respawn.js";
import {
  consumeGatewaySigusr1RestartAuthorization,
  isGatewaySigusr1RestartExternallyAllowed,
  markGatewaySigusr1RestartHandled,
} from "../../infra/restart.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  getActiveTaskCount,
  resetAllLanes,
  waitForActiveTasks,
} from "../../process/command-queue.js";
import { createRestartIterationHook } from "../../process/restart-recovery.js";
const gatewayLog = createSubsystemLogger("gateway");
export async function runGatewayLoop(params) {
  const lock = await acquireGatewayLock();
  let server = null;
  let shuttingDown = false;
  let restartResolver = null;
  const cleanupSignals = () => {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGUSR1", onSigusr1);
  };
  const DRAIN_TIMEOUT_MS = 30000;
  const SHUTDOWN_TIMEOUT_MS = 5000;
  const request = (action, signal) => {
    if (shuttingDown) {
      gatewayLog.info(`received ${signal} during shutdown; forcing exit`);
      cleanupSignals();
      params.runtime.exit(0);
      return;
    }
    shuttingDown = true;
    const isRestart = action === "restart";
    gatewayLog.info(`received ${signal}; ${isRestart ? "restarting" : "shutting down"}`);
    const forceExitMs = isRestart ? DRAIN_TIMEOUT_MS + SHUTDOWN_TIMEOUT_MS : SHUTDOWN_TIMEOUT_MS;
    const forceExitTimer = setTimeout(() => {
      gatewayLog.error("shutdown timed out; exiting without full cleanup");
      if (isRestart) {
        restartGatewayProcessWithFreshPid();
      }
      cleanupSignals();
      params.runtime.exit(0);
    }, forceExitMs);
    (async () => {
      try {
        if (isRestart) {
          const activeTasks = getActiveTaskCount();
          if (activeTasks > 0) {
            gatewayLog.info(
              `draining ${activeTasks} active task(s) before restart (timeout ${DRAIN_TIMEOUT_MS}ms)`,
            );
            const { drained } = await waitForActiveTasks(DRAIN_TIMEOUT_MS);
            if (drained) {
              gatewayLog.info("all active tasks drained");
            } else {
              gatewayLog.warn("drain timeout reached; proceeding with restart");
            }
          }
        }
        await server?.close({
          reason: isRestart ? "gateway restarting" : "gateway stopping",
          restartExpectedMs: isRestart ? 1500 : null,
        });
      } catch (err) {
        gatewayLog.error(`shutdown error: ${String(err)}`);
      } finally {
        clearTimeout(forceExitTimer);
        server = null;
        if (isRestart) {
          const respawn = restartGatewayProcessWithFreshPid();
          if (respawn.mode === "spawned" || respawn.mode === "supervised") {
            const modeLabel =
              respawn.mode === "spawned"
                ? `spawned pid ${respawn.pid ?? "unknown"}`
                : "supervisor restart";
            gatewayLog.info(`restart mode: full process restart (${modeLabel})`);
            cleanupSignals();
            params.runtime.exit(0);
          } else {
            if (respawn.mode === "failed") {
              gatewayLog.warn(
                `full process restart failed (${respawn.detail ?? "unknown error"}); falling back to in-process restart`,
              );
            } else {
              gatewayLog.info("restart mode: in-process restart (GENOS_NO_RESPAWN)");
            }
            shuttingDown = false;
            restartResolver?.();
          }
        } else {
          cleanupSignals();
          params.runtime.exit(0);
        }
      }
    })();
  };
  const onSigterm = () => {
    gatewayLog.info("signal SIGTERM received");
    request("stop", "SIGTERM");
  };
  const onSigint = () => {
    gatewayLog.info("signal SIGINT received");
    request("stop", "SIGINT");
  };
  const onSigusr1 = () => {
    gatewayLog.info("signal SIGUSR1 received");
    const authorized = consumeGatewaySigusr1RestartAuthorization();
    if (!authorized && !isGatewaySigusr1RestartExternallyAllowed()) {
      gatewayLog.warn(
        "SIGUSR1 restart ignored (not authorized; enable commands.restart or use gateway tool).",
      );
      return;
    }
    markGatewaySigusr1RestartHandled();
    request("restart", "SIGUSR1");
  };
  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);
  process.on("SIGUSR1", onSigusr1);
  try {
    const onIteration = createRestartIterationHook(() => {
      resetAllLanes();
    });
    while (true) {
      onIteration();
      server = await params.start();
      await new Promise((resolve) => {
        restartResolver = resolve;
      });
    }
  } finally {
    await lock?.release();
    cleanupSignals();
  }
}
