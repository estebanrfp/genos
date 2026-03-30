let isManagedAccount = function (snapshot) {
    return snapshot.enabled !== false && snapshot.configured !== false;
  },
  isChannelHealthy = function (snapshot) {
    if (!isManagedAccount(snapshot)) {
      return true;
    }
    if (!snapshot.running) {
      return false;
    }
    if (snapshot.connected === false) {
      return false;
    }
    return true;
  };
import { createSubsystemLogger } from "../logging/subsystem.js";
const log = createSubsystemLogger("gateway/health-monitor");
const DEFAULT_CHECK_INTERVAL_MS = 300000;
const DEFAULT_STARTUP_GRACE_MS = 60000;
const DEFAULT_COOLDOWN_CYCLES = 2;
const DEFAULT_MAX_RESTARTS_PER_HOUR = 3;
const ONE_HOUR_MS = 3600000;
export function startChannelHealthMonitor(deps) {
  const {
    channelManager,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
    cooldownCycles = DEFAULT_COOLDOWN_CYCLES,
    maxRestartsPerHour = DEFAULT_MAX_RESTARTS_PER_HOUR,
    abortSignal,
  } = deps;
  const cooldownMs = cooldownCycles * checkIntervalMs;
  const restartRecords = new Map();
  const startedAt = Date.now();
  let stopped = false;
  let checkInFlight = false;
  let timer = null;
  const rKey = (channelId, accountId) => `${channelId}:${accountId}`;
  function pruneOldRestarts(record, now) {
    record.restartsThisHour = record.restartsThisHour.filter((r) => now - r.at < ONE_HOUR_MS);
  }
  async function runCheck() {
    if (stopped || checkInFlight) {
      return;
    }
    checkInFlight = true;
    try {
      const now = Date.now();
      if (now - startedAt < startupGraceMs) {
        return;
      }
      const snapshot = channelManager.getRuntimeSnapshot();
      for (const [channelId, accounts] of Object.entries(snapshot.channelAccounts)) {
        if (!accounts) {
          continue;
        }
        for (const [accountId, status] of Object.entries(accounts)) {
          if (!status) {
            continue;
          }
          if (!isManagedAccount(status)) {
            continue;
          }
          if (channelManager.isManuallyStopped(channelId, accountId)) {
            continue;
          }
          if (isChannelHealthy(status)) {
            continue;
          }
          const key = rKey(channelId, accountId);
          const record = restartRecords.get(key) ?? {
            lastRestartAt: 0,
            restartsThisHour: [],
          };
          if (now - record.lastRestartAt <= cooldownMs) {
            continue;
          }
          pruneOldRestarts(record, now);
          if (record.restartsThisHour.length >= maxRestartsPerHour) {
            log.warn?.(
              `[${channelId}:${accountId}] health-monitor: hit ${maxRestartsPerHour} restarts/hour limit, skipping`,
            );
            continue;
          }
          const reason = !status.running
            ? status.reconnectAttempts && status.reconnectAttempts >= 10
              ? "gave-up"
              : "stopped"
            : "stuck";
          log.info?.(`[${channelId}:${accountId}] health-monitor: restarting (reason: ${reason})`);
          try {
            if (status.running) {
              await channelManager.stopChannel(channelId, accountId);
            }
            channelManager.resetRestartAttempts(channelId, accountId);
            await channelManager.startChannel(channelId, accountId);
            record.lastRestartAt = now;
            record.restartsThisHour.push({ at: now });
            restartRecords.set(key, record);
          } catch (err) {
            log.error?.(
              `[${channelId}:${accountId}] health-monitor: restart failed: ${String(err)}`,
            );
          }
        }
      }
    } finally {
      checkInFlight = false;
    }
  }
  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  if (abortSignal?.aborted) {
    stopped = true;
  } else {
    abortSignal?.addEventListener("abort", stop, { once: true });
    timer = setInterval(() => void runCheck(), checkIntervalMs);
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    log.info?.(
      `started (interval: ${Math.round(checkIntervalMs / 1000)}s, grace: ${Math.round(startupGraceMs / 1000)}s)`,
    );
  }
  return { stop };
}
