let pruneAgentRunCache = function (now = Date.now()) {
    for (const [runId, entry] of agentRunCache) {
      if (now - entry.ts > AGENT_RUN_CACHE_TTL_MS) {
        agentRunCache.delete(runId);
      }
    }
  },
  recordAgentRunSnapshot = function (entry) {
    pruneAgentRunCache(entry.ts);
    agentRunCache.set(entry.runId, entry);
  },
  clearPendingAgentRunError = function (runId) {
    const pending = pendingAgentRunErrors.get(runId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingAgentRunErrors.delete(runId);
  },
  schedulePendingAgentRunError = function (snapshot) {
    clearPendingAgentRunError(snapshot.runId);
    const dueAt = Date.now() + AGENT_RUN_ERROR_RETRY_GRACE_MS;
    const timer = setTimeout(() => {
      const pending = pendingAgentRunErrors.get(snapshot.runId);
      if (!pending) {
        return;
      }
      pendingAgentRunErrors.delete(snapshot.runId);
      recordAgentRunSnapshot(pending.snapshot);
    }, AGENT_RUN_ERROR_RETRY_GRACE_MS);
    timer.unref?.();
    pendingAgentRunErrors.set(snapshot.runId, { snapshot, dueAt, timer });
  },
  getPendingAgentRunError = function (runId) {
    const pending = pendingAgentRunErrors.get(runId);
    if (!pending) {
      return;
    }
    return {
      snapshot: pending.snapshot,
      dueAt: pending.dueAt,
    };
  },
  createSnapshotFromLifecycleEvent = function (params) {
    const { runId, phase, data } = params;
    const startedAt =
      typeof data?.startedAt === "number" ? data.startedAt : agentRunStarts.get(runId);
    const endedAt = typeof data?.endedAt === "number" ? data.endedAt : undefined;
    const error = typeof data?.error === "string" ? data.error : undefined;
    return {
      runId,
      status: phase === "error" ? "error" : data?.aborted ? "timeout" : "ok",
      startedAt,
      endedAt,
      error,
      ts: Date.now(),
    };
  },
  ensureAgentRunListener = function () {
    if (agentRunListenerStarted) {
      return;
    }
    agentRunListenerStarted = true;
    onAgentEvent((evt) => {
      if (!evt) {
        return;
      }
      if (evt.stream !== "lifecycle") {
        return;
      }
      const phase = evt.data?.phase;
      if (phase === "start") {
        const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
        agentRunStarts.set(evt.runId, startedAt ?? Date.now());
        clearPendingAgentRunError(evt.runId);
        agentRunCache.delete(evt.runId);
        return;
      }
      if (phase !== "end" && phase !== "error") {
        return;
      }
      const snapshot = createSnapshotFromLifecycleEvent({
        runId: evt.runId,
        phase,
        data: evt.data,
      });
      agentRunStarts.delete(evt.runId);
      if (phase === "error") {
        schedulePendingAgentRunError(snapshot);
        return;
      }
      clearPendingAgentRunError(evt.runId);
      recordAgentRunSnapshot(snapshot);
    });
  },
  getCachedAgentRun = function (runId) {
    pruneAgentRunCache();
    return agentRunCache.get(runId);
  };
import { onAgentEvent } from "../../infra/agent-events.js";
const AGENT_RUN_CACHE_TTL_MS = 600000;
const AGENT_RUN_ERROR_RETRY_GRACE_MS = 15000;
const agentRunCache = new Map();
const agentRunStarts = new Map();
const pendingAgentRunErrors = new Map();
let agentRunListenerStarted = false;
export async function waitForAgentJob(params) {
  const { runId, timeoutMs } = params;
  ensureAgentRunListener();
  const cached = getCachedAgentRun(runId);
  if (cached) {
    return cached;
  }
  if (timeoutMs <= 0) {
    return null;
  }
  return await new Promise((resolve) => {
    let settled = false;
    let pendingErrorTimer;
    const clearPendingErrorTimer = () => {
      if (!pendingErrorTimer) {
        return;
      }
      clearTimeout(pendingErrorTimer);
      pendingErrorTimer = undefined;
    };
    const finish = (entry) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearPendingErrorTimer();
      unsubscribe();
      resolve(entry);
    };
    const scheduleErrorFinish = (snapshot, delayMs = AGENT_RUN_ERROR_RETRY_GRACE_MS) => {
      clearPendingErrorTimer();
      const effectiveDelay = Math.max(1, Math.min(Math.floor(delayMs), 2147483647));
      pendingErrorTimer = setTimeout(() => {
        const latest = getCachedAgentRun(runId);
        if (latest) {
          finish(latest);
          return;
        }
        recordAgentRunSnapshot(snapshot);
        finish(snapshot);
      }, effectiveDelay);
      pendingErrorTimer.unref?.();
    };
    const pending = getPendingAgentRunError(runId);
    if (pending) {
      scheduleErrorFinish(pending.snapshot, pending.dueAt - Date.now());
    }
    const unsubscribe = onAgentEvent((evt) => {
      if (!evt || evt.stream !== "lifecycle") {
        return;
      }
      if (evt.runId !== runId) {
        return;
      }
      const phase = evt.data?.phase;
      if (phase === "start") {
        clearPendingErrorTimer();
        return;
      }
      if (phase !== "end" && phase !== "error") {
        return;
      }
      const latest = getCachedAgentRun(runId);
      if (latest) {
        finish(latest);
        return;
      }
      const snapshot = createSnapshotFromLifecycleEvent({
        runId: evt.runId,
        phase,
        data: evt.data,
      });
      if (phase === "error") {
        scheduleErrorFinish(snapshot);
        return;
      }
      recordAgentRunSnapshot(snapshot);
      finish(snapshot);
    });
    const timerDelayMs = Math.max(1, Math.min(Math.floor(timeoutMs), 2147483647));
    const timer = setTimeout(() => finish(null), timerDelayMs);
  });
}
ensureAgentRunListener();
