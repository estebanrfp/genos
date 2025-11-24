let resolveAnnounceRetryDelayMs = function (retryCount) {
    const boundedRetryCount = Math.max(0, Math.min(retryCount, 10));
    const backoffExponent = Math.max(0, boundedRetryCount - 1);
    const baseDelay = MIN_ANNOUNCE_RETRY_DELAY_MS * 2 ** backoffExponent;
    return Math.min(baseDelay, MAX_ANNOUNCE_RETRY_DELAY_MS);
  },
  logAnnounceGiveUp = function (entry, reason) {
    const retryCount = entry.announceRetryCount ?? 0;
    const endedAgoMs =
      typeof entry.endedAt === "number" ? Math.max(0, Date.now() - entry.endedAt) : undefined;
    const endedAgoLabel = endedAgoMs != null ? `${Math.round(endedAgoMs / 1000)}s` : "n/a";
    defaultRuntime.log(
      `[warn] Subagent announce give up (${reason}) run=${entry.runId} child=${entry.childSessionKey} requester=${entry.requesterSessionKey} retries=${retryCount} endedAgo=${endedAgoLabel}`,
    );
  },
  persistSubagentRuns = function () {
    try {
      saveSubagentRegistryToDisk(subagentRuns);
    } catch {}
  },
  suppressAnnounceForSteerRestart = function (entry) {
    return entry?.suppressAnnounceReason === "steer-restart";
  },
  startSubagentAnnounceCleanupFlow = function (runId, entry) {
    if (!beginSubagentCleanup(runId)) {
      return false;
    }
    const requesterOrigin = normalizeDeliveryContext(entry.requesterOrigin);
    runSubagentAnnounceFlow({
      childSessionKey: entry.childSessionKey,
      childRunId: entry.runId,
      requesterSessionKey: entry.requesterSessionKey,
      requesterOrigin,
      requesterDisplayKey: entry.requesterDisplayKey,
      task: entry.task,
      expectsCompletionMessage: entry.expectsCompletionMessage,
      timeoutMs: SUBAGENT_ANNOUNCE_TIMEOUT_MS,
      cleanup: entry.cleanup,
      waitForCompletion: false,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      label: entry.label,
      outcome: entry.outcome,
    }).then((didAnnounce) => {
      finalizeSubagentCleanup(runId, entry.cleanup, didAnnounce);
    });
    return true;
  },
  resumeSubagentRun = function (runId) {
    if (!runId || resumedRuns.has(runId)) {
      return;
    }
    const entry = subagentRuns.get(runId);
    if (!entry) {
      return;
    }
    if (entry.cleanupCompletedAt) {
      return;
    }
    if ((entry.announceRetryCount ?? 0) >= MAX_ANNOUNCE_RETRY_COUNT) {
      logAnnounceGiveUp(entry, "retry-limit");
      entry.cleanupCompletedAt = Date.now();
      persistSubagentRuns();
      return;
    }
    if (typeof entry.endedAt === "number" && Date.now() - entry.endedAt > ANNOUNCE_EXPIRY_MS) {
      logAnnounceGiveUp(entry, "expiry");
      entry.cleanupCompletedAt = Date.now();
      persistSubagentRuns();
      return;
    }
    const now = Date.now();
    const delayMs = resolveAnnounceRetryDelayMs(entry.announceRetryCount ?? 0);
    const earliestRetryAt = (entry.lastAnnounceRetryAt ?? 0) + delayMs;
    if (
      entry.expectsCompletionMessage === true &&
      entry.lastAnnounceRetryAt &&
      now < earliestRetryAt
    ) {
      const waitMs = Math.max(1, earliestRetryAt - now);
      setTimeout(() => {
        resumeSubagentRun(runId);
      }, waitMs).unref?.();
      resumedRuns.add(runId);
      return;
    }
    if (typeof entry.endedAt === "number" && entry.endedAt > 0) {
      if (suppressAnnounceForSteerRestart(entry)) {
        resumedRuns.add(runId);
        return;
      }
      if (!startSubagentAnnounceCleanupFlow(runId, entry)) {
        return;
      }
      resumedRuns.add(runId);
      return;
    }
    const cfg = loadConfig();
    const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, entry.runTimeoutSeconds);
    waitForSubagentCompletion(runId, waitTimeoutMs);
    resumedRuns.add(runId);
  },
  restoreSubagentRunsOnce = function () {
    if (restoreAttempted) {
      return;
    }
    restoreAttempted = true;
    try {
      const restored = loadSubagentRegistryFromDisk();
      if (restored.size === 0) {
        return;
      }
      for (const [runId, entry] of restored.entries()) {
        if (!runId || !entry) {
          continue;
        }
        if (!subagentRuns.has(runId)) {
          subagentRuns.set(runId, entry);
        }
      }
      ensureListener();
      if ([...subagentRuns.values()].some((entry) => entry.archiveAtMs)) {
        startSweeper();
      }
      for (const runId of subagentRuns.keys()) {
        resumeSubagentRun(runId);
      }
    } catch {}
  },
  resolveArchiveAfterMs = function (cfg) {
    const config = cfg ?? loadConfig();
    const minutes = config.agents?.defaults?.subagents?.archiveAfterMinutes ?? 60;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    return Math.max(1, Math.floor(minutes)) * 60000;
  },
  resolveSubagentWaitTimeoutMs = function (cfg, runTimeoutSeconds) {
    return resolveAgentTimeoutMs({ cfg, overrideSeconds: runTimeoutSeconds ?? 0 });
  },
  startSweeper = function () {
    if (sweeper) {
      return;
    }
    sweeper = setInterval(() => {
      sweepSubagentRuns();
    }, 60000);
    sweeper.unref?.();
  },
  stopSweeper = function () {
    if (!sweeper) {
      return;
    }
    clearInterval(sweeper);
    sweeper = null;
  },
  ensureListener = function () {
    if (listenerStarted) {
      return;
    }
    listenerStarted = true;
    listenerStop = onAgentEvent((evt) => {
      if (!evt || evt.stream !== "lifecycle") {
        return;
      }
      const entry = subagentRuns.get(evt.runId);
      if (!entry) {
        return;
      }
      const phase = evt.data?.phase;
      if (phase === "start") {
        const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
        if (startedAt) {
          entry.startedAt = startedAt;
          persistSubagentRuns();
        }
        return;
      }
      if (phase !== "end" && phase !== "error") {
        return;
      }
      const endedAt = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : Date.now();
      entry.endedAt = endedAt;
      if (phase === "error") {
        const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
        entry.outcome = { status: "error", error };
      } else if (evt.data?.aborted) {
        entry.outcome = { status: "timeout" };
      } else {
        entry.outcome = { status: "ok" };
      }
      persistSubagentRuns();
      if (suppressAnnounceForSteerRestart(entry)) {
        return;
      }
      if (!startSubagentAnnounceCleanupFlow(evt.runId, entry)) {
        return;
      }
    });
  },
  finalizeSubagentCleanup = function (runId, cleanup, didAnnounce) {
    const entry = subagentRuns.get(runId);
    if (!entry) {
      return;
    }
    if (!didAnnounce) {
      const now = Date.now();
      const retryCount = (entry.announceRetryCount ?? 0) + 1;
      entry.announceRetryCount = retryCount;
      entry.lastAnnounceRetryAt = now;
      const endedAgo = typeof entry.endedAt === "number" ? now - entry.endedAt : 0;
      if (retryCount >= MAX_ANNOUNCE_RETRY_COUNT || endedAgo > ANNOUNCE_EXPIRY_MS) {
        logAnnounceGiveUp(entry, retryCount >= MAX_ANNOUNCE_RETRY_COUNT ? "retry-limit" : "expiry");
        entry.cleanupCompletedAt = now;
        persistSubagentRuns();
        retryDeferredCompletedAnnounces(runId);
        return;
      }
      entry.cleanupHandled = false;
      resumedRuns.delete(runId);
      persistSubagentRuns();
      if (entry.expectsCompletionMessage !== true) {
        return;
      }
      setTimeout(
        () => {
          resumeSubagentRun(runId);
        },
        resolveAnnounceRetryDelayMs(entry.announceRetryCount ?? 0),
      ).unref?.();
      return;
    }
    if (cleanup === "delete") {
      subagentRuns.delete(runId);
      persistSubagentRuns();
      retryDeferredCompletedAnnounces(runId);
      return;
    }
    entry.cleanupCompletedAt = Date.now();
    persistSubagentRuns();
    retryDeferredCompletedAnnounces(runId);
  },
  retryDeferredCompletedAnnounces = function (excludeRunId) {
    const now = Date.now();
    for (const [runId, entry] of subagentRuns.entries()) {
      if (excludeRunId && runId === excludeRunId) {
        continue;
      }
      if (typeof entry.endedAt !== "number") {
        continue;
      }
      if (entry.cleanupCompletedAt || entry.cleanupHandled) {
        continue;
      }
      if (suppressAnnounceForSteerRestart(entry)) {
        continue;
      }
      const endedAgo = now - (entry.endedAt ?? now);
      if (endedAgo > ANNOUNCE_EXPIRY_MS) {
        logAnnounceGiveUp(entry, "expiry");
        entry.cleanupCompletedAt = now;
        persistSubagentRuns();
        continue;
      }
      resumedRuns.delete(runId);
      resumeSubagentRun(runId);
    }
  },
  beginSubagentCleanup = function (runId) {
    const entry = subagentRuns.get(runId);
    if (!entry) {
      return false;
    }
    if (entry.cleanupCompletedAt) {
      return false;
    }
    if (entry.cleanupHandled) {
      return false;
    }
    entry.cleanupHandled = true;
    persistSubagentRuns();
    return true;
  },
  findRunIdsByChildSessionKey = function (childSessionKey) {
    const key = childSessionKey.trim();
    if (!key) {
      return [];
    }
    const runIds = [];
    for (const [runId, entry] of subagentRuns.entries()) {
      if (entry.childSessionKey === key) {
        runIds.push(runId);
      }
    }
    return runIds;
  },
  getRunsSnapshotForRead = function () {
    const merged = new Map();
    const shouldReadDisk = !(process.env.VITEST || false);
    if (shouldReadDisk) {
      try {
        for (const [runId, entry] of loadSubagentRegistryFromDisk().entries()) {
          merged.set(runId, entry);
        }
      } catch {}
    }
    for (const [runId, entry] of subagentRuns.entries()) {
      merged.set(runId, entry);
    }
    return merged;
  };
import { loadConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { onAgentEvent } from "../infra/agent-events.js";
import { defaultRuntime } from "../runtime.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import { resetAnnounceQueuesForTests } from "./subagent-announce-queue.js";
import { runSubagentAnnounceFlow } from "./subagent-announce.js";
import {
  loadSubagentRegistryFromDisk,
  saveSubagentRegistryToDisk,
} from "./subagent-registry.store.js";
import { resolveAgentTimeoutMs } from "./timeout.js";
const subagentRuns = new Map();
let sweeper = null;
let listenerStarted = false;
let listenerStop = null;
var restoreAttempted = false;
const SUBAGENT_ANNOUNCE_TIMEOUT_MS = 120000;
const MIN_ANNOUNCE_RETRY_DELAY_MS = 1000;
const MAX_ANNOUNCE_RETRY_DELAY_MS = 8000;
const MAX_ANNOUNCE_RETRY_COUNT = 3;
const ANNOUNCE_EXPIRY_MS = 300000;
const resumedRuns = new Set();
async function sweepSubagentRuns() {
  const now = Date.now();
  let mutated = false;
  for (const [runId, entry] of subagentRuns.entries()) {
    if (!entry.archiveAtMs || entry.archiveAtMs > now) {
      continue;
    }
    subagentRuns.delete(runId);
    mutated = true;
    try {
      await callGateway({
        method: "sessions.delete",
        params: { key: entry.childSessionKey, deleteTranscript: true },
        timeoutMs: 1e4,
      });
    } catch {}
  }
  if (mutated) {
    persistSubagentRuns();
  }
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}
export function markSubagentRunForSteerRestart(runId) {
  const key = runId.trim();
  if (!key) {
    return false;
  }
  const entry = subagentRuns.get(key);
  if (!entry) {
    return false;
  }
  if (entry.suppressAnnounceReason === "steer-restart") {
    return true;
  }
  entry.suppressAnnounceReason = "steer-restart";
  persistSubagentRuns();
  return true;
}
export function clearSubagentRunSteerRestart(runId) {
  const key = runId.trim();
  if (!key) {
    return false;
  }
  const entry = subagentRuns.get(key);
  if (!entry) {
    return false;
  }
  if (entry.suppressAnnounceReason !== "steer-restart") {
    return true;
  }
  entry.suppressAnnounceReason = undefined;
  persistSubagentRuns();
  resumedRuns.delete(key);
  if (typeof entry.endedAt === "number" && !entry.cleanupCompletedAt) {
    resumeSubagentRun(key);
  }
  return true;
}
export function replaceSubagentRunAfterSteer(params) {
  const previousRunId = params.previousRunId.trim();
  const nextRunId = params.nextRunId.trim();
  if (!previousRunId || !nextRunId) {
    return false;
  }
  const previous = subagentRuns.get(previousRunId);
  const source = previous ?? params.fallback;
  if (!source) {
    return false;
  }
  if (previousRunId !== nextRunId) {
    subagentRuns.delete(previousRunId);
    resumedRuns.delete(previousRunId);
  }
  const now = Date.now();
  const cfg = loadConfig();
  const archiveAfterMs = resolveArchiveAfterMs(cfg);
  const archiveAtMs = archiveAfterMs ? now + archiveAfterMs : undefined;
  const runTimeoutSeconds = params.runTimeoutSeconds ?? source.runTimeoutSeconds ?? 0;
  const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, runTimeoutSeconds);
  const next = {
    ...source,
    runId: nextRunId,
    startedAt: now,
    endedAt: undefined,
    outcome: undefined,
    cleanupCompletedAt: undefined,
    cleanupHandled: false,
    suppressAnnounceReason: undefined,
    announceRetryCount: undefined,
    lastAnnounceRetryAt: undefined,
    archiveAtMs,
    runTimeoutSeconds,
  };
  subagentRuns.set(nextRunId, next);
  ensureListener();
  persistSubagentRuns();
  if (archiveAtMs) {
    startSweeper();
  }
  waitForSubagentCompletion(nextRunId, waitTimeoutMs);
  return true;
}
export function registerSubagentRun(params) {
  const now = Date.now();
  const cfg = loadConfig();
  const archiveAfterMs = resolveArchiveAfterMs(cfg);
  const archiveAtMs = archiveAfterMs ? now + archiveAfterMs : undefined;
  const runTimeoutSeconds = params.runTimeoutSeconds ?? 0;
  const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, runTimeoutSeconds);
  const requesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
  subagentRuns.set(params.runId, {
    runId: params.runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: params.requesterSessionKey,
    requesterOrigin,
    requesterDisplayKey: params.requesterDisplayKey,
    task: params.task,
    cleanup: params.cleanup,
    expectsCompletionMessage: params.expectsCompletionMessage,
    label: params.label,
    model: params.model,
    runTimeoutSeconds,
    createdAt: now,
    startedAt: now,
    archiveAtMs,
    cleanupHandled: false,
  });
  ensureListener();
  persistSubagentRuns();
  if (archiveAfterMs) {
    startSweeper();
  }
  waitForSubagentCompletion(params.runId, waitTimeoutMs);
}
async function waitForSubagentCompletion(runId, waitTimeoutMs) {
  try {
    const timeoutMs = Math.max(1, Math.floor(waitTimeoutMs));
    const wait = await callGateway({
      method: "agent.wait",
      params: {
        runId,
        timeoutMs,
      },
      timeoutMs: timeoutMs + 1e4,
    });
    if (wait?.status !== "ok" && wait?.status !== "error" && wait?.status !== "timeout") {
      return;
    }
    const entry = subagentRuns.get(runId);
    if (!entry) {
      return;
    }
    let mutated = false;
    if (typeof wait.startedAt === "number") {
      entry.startedAt = wait.startedAt;
      mutated = true;
    }
    if (typeof wait.endedAt === "number") {
      entry.endedAt = wait.endedAt;
      mutated = true;
    }
    if (!entry.endedAt) {
      entry.endedAt = Date.now();
      mutated = true;
    }
    const waitError = typeof wait.error === "string" ? wait.error : undefined;
    entry.outcome =
      wait.status === "error"
        ? { status: "error", error: waitError }
        : wait.status === "timeout"
          ? { status: "timeout" }
          : { status: "ok" };
    mutated = true;
    if (mutated) {
      persistSubagentRuns();
    }
    if (suppressAnnounceForSteerRestart(entry)) {
      return;
    }
    if (!startSubagentAnnounceCleanupFlow(runId, entry)) {
      return;
    }
  } catch {}
}
export function resetSubagentRegistryForTests(opts) {
  subagentRuns.clear();
  resumedRuns.clear();
  resetAnnounceQueuesForTests();
  stopSweeper();
  restoreAttempted = false;
  if (listenerStop) {
    listenerStop();
    listenerStop = null;
  }
  listenerStarted = false;
  if (opts?.persist !== false) {
    persistSubagentRuns();
  }
}
export function addSubagentRunForTests(entry) {
  subagentRuns.set(entry.runId, entry);
}
export function releaseSubagentRun(runId) {
  const didDelete = subagentRuns.delete(runId);
  if (didDelete) {
    persistSubagentRuns();
  }
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}
export function resolveRequesterForChildSession(childSessionKey) {
  const key = childSessionKey.trim();
  if (!key) {
    return null;
  }
  let best;
  for (const entry of getRunsSnapshotForRead().values()) {
    if (entry.childSessionKey !== key) {
      continue;
    }
    if (!best || entry.createdAt > best.createdAt) {
      best = entry;
    }
  }
  if (!best) {
    return null;
  }
  return {
    requesterSessionKey: best.requesterSessionKey,
    requesterOrigin: normalizeDeliveryContext(best.requesterOrigin),
  };
}
export function isSubagentSessionRunActive(childSessionKey) {
  const runIds = findRunIdsByChildSessionKey(childSessionKey);
  for (const runId of runIds) {
    const entry = subagentRuns.get(runId);
    if (!entry) {
      continue;
    }
    if (typeof entry.endedAt !== "number") {
      return true;
    }
  }
  return false;
}
export function markSubagentRunTerminated(params) {
  const runIds = new Set();
  if (typeof params.runId === "string" && params.runId.trim()) {
    runIds.add(params.runId.trim());
  }
  if (typeof params.childSessionKey === "string" && params.childSessionKey.trim()) {
    for (const runId of findRunIdsByChildSessionKey(params.childSessionKey)) {
      runIds.add(runId);
    }
  }
  if (runIds.size === 0) {
    return 0;
  }
  const now = Date.now();
  const reason = params.reason?.trim() || "killed";
  let updated = 0;
  for (const runId of runIds) {
    const entry = subagentRuns.get(runId);
    if (!entry) {
      continue;
    }
    if (typeof entry.endedAt === "number") {
      continue;
    }
    entry.endedAt = now;
    entry.outcome = { status: "error", error: reason };
    entry.cleanupHandled = true;
    entry.cleanupCompletedAt = now;
    entry.suppressAnnounceReason = "killed";
    updated += 1;
  }
  if (updated > 0) {
    persistSubagentRuns();
  }
  return updated;
}
export function listSubagentRunsForRequester(requesterSessionKey) {
  const key = requesterSessionKey.trim();
  if (!key) {
    return [];
  }
  return [...subagentRuns.values()].filter((entry) => entry.requesterSessionKey === key);
}
export function countActiveRunsForSession(requesterSessionKey) {
  const key = requesterSessionKey.trim();
  if (!key) {
    return 0;
  }
  let count = 0;
  for (const entry of getRunsSnapshotForRead().values()) {
    if (entry.requesterSessionKey !== key) {
      continue;
    }
    if (typeof entry.endedAt === "number") {
      continue;
    }
    count += 1;
  }
  return count;
}
export function countActiveDescendantRuns(rootSessionKey) {
  const root = rootSessionKey.trim();
  if (!root) {
    return 0;
  }
  const runs = getRunsSnapshotForRead();
  const pending = [root];
  const visited = new Set([root]);
  let count = 0;
  while (pending.length > 0) {
    const requester = pending.shift();
    if (!requester) {
      continue;
    }
    for (const entry of runs.values()) {
      if (entry.requesterSessionKey !== requester) {
        continue;
      }
      if (typeof entry.endedAt !== "number") {
        count += 1;
      }
      const childKey = entry.childSessionKey.trim();
      if (!childKey || visited.has(childKey)) {
        continue;
      }
      visited.add(childKey);
      pending.push(childKey);
    }
  }
  return count;
}
export function listDescendantRunsForRequester(rootSessionKey) {
  const root = rootSessionKey.trim();
  if (!root) {
    return [];
  }
  const runs = getRunsSnapshotForRead();
  const pending = [root];
  const visited = new Set([root]);
  const descendants = [];
  while (pending.length > 0) {
    const requester = pending.shift();
    if (!requester) {
      continue;
    }
    for (const entry of runs.values()) {
      if (entry.requesterSessionKey !== requester) {
        continue;
      }
      descendants.push(entry);
      const childKey = entry.childSessionKey.trim();
      if (!childKey || visited.has(childKey)) {
        continue;
      }
      visited.add(childKey);
      pending.push(childKey);
    }
  }
  return descendants;
}
export function initSubagentRegistry() {
  restoreSubagentRunsOnce();
}
