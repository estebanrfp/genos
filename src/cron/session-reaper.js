import { parseDurationMs } from "../cli/parse-duration.js";
import { updateSessionStore } from "../config/sessions.js";
import { isCronRunSessionKey } from "../sessions/session-key-utils.js";
const DEFAULT_RETENTION_MS = 86400000;
const MIN_SWEEP_INTERVAL_MS = 300000;
const lastSweepAtMsByStore = new Map();
export function resolveRetentionMs(cronConfig) {
  if (cronConfig?.sessionRetention === false) {
    return null;
  }
  const raw = cronConfig?.sessionRetention;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseDurationMs(raw.trim(), { defaultUnit: "h" });
    } catch {
      return DEFAULT_RETENTION_MS;
    }
  }
  return DEFAULT_RETENTION_MS;
}
export async function sweepCronRunSessions(params) {
  const now = params.nowMs ?? Date.now();
  const storePath = params.sessionStorePath;
  const lastSweepAtMs = lastSweepAtMsByStore.get(storePath) ?? 0;
  if (!params.force && now - lastSweepAtMs < MIN_SWEEP_INTERVAL_MS) {
    return { swept: false, pruned: 0 };
  }
  const retentionMs = resolveRetentionMs(params.cronConfig);
  if (retentionMs === null) {
    lastSweepAtMsByStore.set(storePath, now);
    return { swept: false, pruned: 0 };
  }
  let pruned = 0;
  try {
    await updateSessionStore(storePath, (store) => {
      const cutoff = now - retentionMs;
      for (const key of Object.keys(store)) {
        if (!isCronRunSessionKey(key)) {
          continue;
        }
        const entry = store[key];
        if (!entry) {
          continue;
        }
        const updatedAt = entry.updatedAt ?? 0;
        if (updatedAt < cutoff) {
          delete store[key];
          pruned++;
        }
      }
    });
  } catch (err) {
    params.log.warn({ err: String(err) }, "cron-reaper: failed to sweep session store");
    return { swept: false, pruned: 0 };
  }
  lastSweepAtMsByStore.set(storePath, now);
  if (pruned > 0) {
    params.log.info(
      { pruned, retentionMs },
      `cron-reaper: pruned ${pruned} expired cron run session(s)`,
    );
  }
  return { swept: true, pruned };
}
export function resetReaperThrottle() {
  lastSweepAtMsByStore.clear();
}
