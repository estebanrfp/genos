let resolveReasonPriority = function (reason) {
    const kind = resolveHeartbeatReasonKind(reason);
    if (kind === "retry") {
      return REASON_PRIORITY.RETRY;
    }
    if (kind === "interval") {
      return REASON_PRIORITY.INTERVAL;
    }
    if (isHeartbeatActionWakeReason(reason)) {
      return REASON_PRIORITY.ACTION;
    }
    return REASON_PRIORITY.DEFAULT;
  },
  normalizeWakeReason = function (reason) {
    return normalizeHeartbeatWakeReason(reason);
  },
  normalizeWakeTarget = function (value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || undefined;
  },
  getWakeTargetKey = function (params) {
    const agentId = normalizeWakeTarget(params.agentId);
    const sessionKey = normalizeWakeTarget(params.sessionKey);
    return `${agentId ?? ""}::${sessionKey ?? ""}`;
  },
  queuePendingWakeReason = function (params) {
    const requestedAt = params?.requestedAt ?? Date.now();
    const normalizedReason = normalizeWakeReason(params?.reason);
    const normalizedAgentId = normalizeWakeTarget(params?.agentId);
    const normalizedSessionKey = normalizeWakeTarget(params?.sessionKey);
    const wakeTargetKey = getWakeTargetKey({
      agentId: normalizedAgentId,
      sessionKey: normalizedSessionKey,
    });
    const next = {
      reason: normalizedReason,
      priority: resolveReasonPriority(normalizedReason),
      requestedAt,
      agentId: normalizedAgentId,
      sessionKey: normalizedSessionKey,
    };
    const previous = pendingWakes.get(wakeTargetKey);
    if (!previous) {
      pendingWakes.set(wakeTargetKey, next);
      return;
    }
    if (next.priority > previous.priority) {
      pendingWakes.set(wakeTargetKey, next);
      return;
    }
    if (next.priority === previous.priority && next.requestedAt >= previous.requestedAt) {
      pendingWakes.set(wakeTargetKey, next);
    }
  },
  schedule = function (coalesceMs, kind = "normal") {
    const delay = Number.isFinite(coalesceMs) ? Math.max(0, coalesceMs) : DEFAULT_COALESCE_MS;
    const dueAt = Date.now() + delay;
    if (timer) {
      if (timerKind === "retry") {
        return;
      }
      if (typeof timerDueAt === "number" && timerDueAt <= dueAt) {
        return;
      }
      clearTimeout(timer);
      timer = null;
      timerDueAt = null;
      timerKind = null;
    }
    timerDueAt = dueAt;
    timerKind = kind;
    timer = setTimeout(async () => {
      timer = null;
      timerDueAt = null;
      timerKind = null;
      scheduled = false;
      const active = handler;
      if (!active) {
        return;
      }
      if (running) {
        scheduled = true;
        schedule(delay, kind);
        return;
      }
      const pendingBatch = Array.from(pendingWakes.values());
      pendingWakes.clear();
      running = true;
      try {
        for (const pendingWake of pendingBatch) {
          const wakeOpts = {
            reason: pendingWake.reason ?? undefined,
            ...(pendingWake.agentId ? { agentId: pendingWake.agentId } : {}),
            ...(pendingWake.sessionKey ? { sessionKey: pendingWake.sessionKey } : {}),
          };
          const res = await active(wakeOpts);
          if (res.status === "skipped" && res.reason === "requests-in-flight") {
            queuePendingWakeReason({
              reason: pendingWake.reason ?? "retry",
              agentId: pendingWake.agentId,
              sessionKey: pendingWake.sessionKey,
            });
            schedule(DEFAULT_RETRY_MS, "retry");
          }
        }
      } catch {
        for (const pendingWake of pendingBatch) {
          queuePendingWakeReason({
            reason: pendingWake.reason ?? "retry",
            agentId: pendingWake.agentId,
            sessionKey: pendingWake.sessionKey,
          });
        }
        schedule(DEFAULT_RETRY_MS, "retry");
      } finally {
        running = false;
        if (pendingWakes.size > 0 || scheduled) {
          schedule(delay, "normal");
        }
      }
    }, delay);
    timer.unref?.();
  };
import {
  isHeartbeatActionWakeReason,
  normalizeHeartbeatWakeReason,
  resolveHeartbeatReasonKind,
} from "./heartbeat-reason.js";
let handler = null;
let handlerGeneration = 0;
const pendingWakes = new Map();
let scheduled = false;
let running = false;
let timer = null;
let timerDueAt = null;
let timerKind = null;
const DEFAULT_COALESCE_MS = 250;
const DEFAULT_RETRY_MS = 1000;
const REASON_PRIORITY = {
  RETRY: 0,
  INTERVAL: 1,
  DEFAULT: 2,
  ACTION: 3,
};
export function setHeartbeatWakeHandler(next) {
  handlerGeneration += 1;
  const generation = handlerGeneration;
  handler = next;
  if (next) {
    if (timer) {
      clearTimeout(timer);
    }
    timer = null;
    timerDueAt = null;
    timerKind = null;
    running = false;
    scheduled = false;
  }
  if (handler && pendingWakes.size > 0) {
    schedule(DEFAULT_COALESCE_MS, "normal");
  }
  return () => {
    if (handlerGeneration !== generation) {
      return;
    }
    if (handler !== next) {
      return;
    }
    handlerGeneration += 1;
    handler = null;
  };
}
export function requestHeartbeatNow(opts) {
  queuePendingWakeReason({
    reason: opts?.reason,
    agentId: opts?.agentId,
    sessionKey: opts?.sessionKey,
  });
  schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS, "normal");
}
export function hasHeartbeatWakeHandler() {
  return handler !== null;
}
export function hasPendingHeartbeatWake() {
  return pendingWakes.size > 0 || Boolean(timer) || scheduled;
}
export function resetHeartbeatWakeStateForTests() {
  if (timer) {
    clearTimeout(timer);
  }
  timer = null;
  timerDueAt = null;
  timerKind = null;
  pendingWakes.clear();
  scheduled = false;
  running = false;
  handlerGeneration += 1;
  handler = null;
}
