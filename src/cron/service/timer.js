let errorBackoffMs = function (consecutiveErrors) {
    const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_SCHEDULE_MS.length - 1);
    return ERROR_BACKOFF_SCHEDULE_MS[Math.max(0, idx)];
  },
  applyJobResult = function (state, job, result) {
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = result.startedAt;
    job.state.lastStatus = result.status;
    job.state.lastDurationMs = Math.max(0, result.endedAt - result.startedAt);
    job.state.lastError = result.error;
    job.updatedAtMs = result.endedAt;
    if (result.status === "error") {
      job.state.consecutiveErrors = (job.state.consecutiveErrors ?? 0) + 1;
    } else {
      job.state.consecutiveErrors = 0;
    }
    const shouldDelete =
      job.schedule.kind === "at" && job.deleteAfterRun === true && result.status === "ok";
    if (!shouldDelete) {
      if (job.schedule.kind === "at") {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
        if (result.status === "error") {
          state.deps.log.warn(
            {
              jobId: job.id,
              jobName: job.name,
              consecutiveErrors: job.state.consecutiveErrors,
              error: result.error,
            },
            "cron: disabling one-shot job after error",
          );
        }
      } else if (result.status === "error" && job.enabled) {
        const backoff = errorBackoffMs(job.state.consecutiveErrors ?? 1);
        const normalNext = computeJobNextRunAtMs(job, result.endedAt);
        const backoffNext = result.endedAt + backoff;
        job.state.nextRunAtMs =
          normalNext !== undefined ? Math.max(normalNext, backoffNext) : backoffNext;
        state.deps.log.info(
          {
            jobId: job.id,
            consecutiveErrors: job.state.consecutiveErrors,
            backoffMs: backoff,
            nextRunAtMs: job.state.nextRunAtMs,
          },
          "cron: applying error backoff",
        );
      } else if (job.enabled) {
        const naturalNext = computeJobNextRunAtMs(job, result.endedAt);
        if (job.schedule.kind === "cron") {
          const minNext = result.endedAt + MIN_REFIRE_GAP_MS;
          job.state.nextRunAtMs =
            naturalNext !== undefined ? Math.max(naturalNext, minNext) : minNext;
        } else {
          job.state.nextRunAtMs = naturalNext;
        }
      } else {
        job.state.nextRunAtMs = undefined;
      }
    }
    return shouldDelete;
  },
  findDueJobs = function (state) {
    if (!state.store) {
      return [];
    }
    const now = state.deps.nowMs();
    return collectRunnableJobs(state, now);
  },
  isRunnableJob = function (params) {
    const { job, nowMs } = params;
    if (!job.state) {
      job.state = {};
    }
    if (!job.enabled) {
      return false;
    }
    if (params.skipJobIds?.has(job.id)) {
      return false;
    }
    if (typeof job.state.runningAtMs === "number") {
      return false;
    }
    if (params.skipAtIfAlreadyRan && job.schedule.kind === "at" && job.state.lastStatus) {
      return false;
    }
    const next = job.state.nextRunAtMs;
    return typeof next === "number" && nowMs >= next;
  },
  collectRunnableJobs = function (state, nowMs, opts) {
    if (!state.store) {
      return [];
    }
    return state.store.jobs.filter((job) =>
      isRunnableJob({
        job,
        nowMs,
        skipJobIds: opts?.skipJobIds,
        skipAtIfAlreadyRan: opts?.skipAtIfAlreadyRan,
      }),
    );
  },
  emitJobFinished = function (state, job, result, runAtMs) {
    emit(state, {
      jobId: job.id,
      action: "finished",
      status: result.status,
      error: result.error,
      summary: result.summary,
      sessionId: result.sessionId,
      sessionKey: result.sessionKey,
      runAtMs,
      durationMs: job.state.lastDurationMs,
      nextRunAtMs: job.state.nextRunAtMs,
      model: result.model,
      provider: result.provider,
      usage: result.usage,
    });
  };
import { DEFAULT_AGENT_ID } from "../../routing/session-key.js";
import { resolveCronDeliveryPlan } from "../delivery.js";
import { sweepCronRunSessions } from "../session-reaper.js";
import {
  computeJobNextRunAtMs,
  nextWakeAtMs,
  recomputeNextRunsForMaintenance,
  resolveJobPayloadTextForMain,
} from "./jobs.js";
import { locked } from "./locked.js";
import { ensureLoaded, persist } from "./store.js";
const MAX_TIMER_DELAY_MS = 60000;
const MIN_REFIRE_GAP_MS = 2000;
const DEFAULT_JOB_TIMEOUT_MS = 600000;
const ERROR_BACKOFF_SCHEDULE_MS = [30000, 60000, 300000, 900000, 3600000];
export function armTimer(state) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
  if (!state.deps.cronEnabled) {
    state.deps.log.debug({}, "cron: armTimer skipped - scheduler disabled");
    return;
  }
  const nextAt = nextWakeAtMs(state);
  if (!nextAt) {
    const jobCount = state.store?.jobs.length ?? 0;
    const enabledCount = state.store?.jobs.filter((j) => j.enabled).length ?? 0;
    const withNextRun =
      state.store?.jobs.filter((j) => j.enabled && typeof j.state.nextRunAtMs === "number")
        .length ?? 0;
    state.deps.log.debug(
      { jobCount, enabledCount, withNextRun },
      "cron: armTimer skipped - no jobs with nextRunAtMs",
    );
    return;
  }
  const now = state.deps.nowMs();
  const delay = Math.max(nextAt - now, 0);
  const clampedDelay = Math.min(delay, MAX_TIMER_DELAY_MS);
  state.timer = setTimeout(() => {
    onTimer(state).catch((err) => {
      state.deps.log.error({ err: String(err) }, "cron: timer tick failed");
    });
  }, clampedDelay);
  state.deps.log.debug(
    { nextAt, delayMs: clampedDelay, clamped: delay > MAX_TIMER_DELAY_MS },
    "cron: timer armed",
  );
}
export async function onTimer(state) {
  if (state.running) {
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      onTimer(state).catch((err) => {
        state.deps.log.error({ err: String(err) }, "cron: timer tick failed");
      });
    }, MAX_TIMER_DELAY_MS);
    return;
  }
  state.running = true;
  try {
    const dueJobs = await locked(state, async () => {
      await ensureLoaded(state, { forceReload: true, skipRecompute: true });
      const due = findDueJobs(state);
      if (due.length === 0) {
        const changed = recomputeNextRunsForMaintenance(state);
        if (changed) {
          await persist(state);
        }
        return [];
      }
      const now = state.deps.nowMs();
      for (const job of due) {
        job.state.runningAtMs = now;
        job.state.lastError = undefined;
      }
      await persist(state);
      return due.map((j) => ({
        id: j.id,
        job: j,
      }));
    });
    const results = [];
    for (const { id, job } of dueJobs) {
      const startedAt = state.deps.nowMs();
      job.state.runningAtMs = startedAt;
      emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });
      const configuredTimeoutMs =
        job.payload.kind === "agentTurn" && typeof job.payload.timeoutSeconds === "number"
          ? Math.floor(job.payload.timeoutSeconds * 1000)
          : undefined;
      const jobTimeoutMs =
        configuredTimeoutMs !== undefined
          ? configuredTimeoutMs <= 0
            ? undefined
            : configuredTimeoutMs
          : DEFAULT_JOB_TIMEOUT_MS;
      try {
        const result =
          typeof jobTimeoutMs === "number"
            ? await (async () => {
                let timeoutId;
                try {
                  return await Promise.race([
                    executeJobCore(state, job),
                    new Promise((_, reject) => {
                      timeoutId = setTimeout(
                        () => reject(new Error("cron: job execution timed out")),
                        jobTimeoutMs,
                      );
                    }),
                  ]);
                } finally {
                  if (timeoutId) {
                    clearTimeout(timeoutId);
                  }
                }
              })()
            : await executeJobCore(state, job);
        results.push({ jobId: id, ...result, startedAt, endedAt: state.deps.nowMs() });
      } catch (err) {
        state.deps.log.warn(
          { jobId: id, jobName: job.name, timeoutMs: jobTimeoutMs ?? null },
          `cron: job failed: ${String(err)}`,
        );
        results.push({
          jobId: id,
          status: "error",
          error: String(err),
          startedAt,
          endedAt: state.deps.nowMs(),
        });
      }
    }
    if (results.length > 0) {
      await locked(state, async () => {
        await ensureLoaded(state, { forceReload: true, skipRecompute: true });
        for (const result of results) {
          const job = state.store?.jobs.find((j) => j.id === result.jobId);
          if (!job) {
            continue;
          }
          const shouldDelete = applyJobResult(state, job, {
            status: result.status,
            error: result.error,
            startedAt: result.startedAt,
            endedAt: result.endedAt,
          });
          emitJobFinished(state, job, result, result.startedAt);
          if (shouldDelete && state.store) {
            state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
            emit(state, { jobId: job.id, action: "removed" });
          }
        }
        recomputeNextRunsForMaintenance(state);
        await persist(state);
      });
    }
    const storePaths = new Set();
    if (state.deps.resolveSessionStorePath) {
      const defaultAgentId = state.deps.defaultAgentId ?? DEFAULT_AGENT_ID;
      if (state.store?.jobs?.length) {
        for (const job of state.store.jobs) {
          const agentId =
            typeof job.agentId === "string" && job.agentId.trim() ? job.agentId : defaultAgentId;
          storePaths.add(state.deps.resolveSessionStorePath(agentId));
        }
      } else {
        storePaths.add(state.deps.resolveSessionStorePath(defaultAgentId));
      }
    } else if (state.deps.sessionStorePath) {
      storePaths.add(state.deps.sessionStorePath);
    }
    if (storePaths.size > 0) {
      const nowMs = state.deps.nowMs();
      for (const storePath of storePaths) {
        try {
          await sweepCronRunSessions({
            cronConfig: state.deps.cronConfig,
            sessionStorePath: storePath,
            nowMs,
            log: state.deps.log,
          });
        } catch (err) {
          state.deps.log.warn({ err: String(err), storePath }, "cron: session reaper sweep failed");
        }
      }
    }
  } finally {
    state.running = false;
    armTimer(state);
  }
}
export async function runMissedJobs(state, opts) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  const skipJobIds = opts?.skipJobIds;
  const missed = collectRunnableJobs(state, now, { skipJobIds, skipAtIfAlreadyRan: true });
  if (missed.length > 0) {
    state.deps.log.info(
      { count: missed.length, jobIds: missed.map((j) => j.id) },
      "cron: running missed jobs after restart",
    );
    for (const job of missed) {
      await executeJob(state, job, now, { forced: false });
    }
  }
}
export async function runDueJobs(state) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  const due = collectRunnableJobs(state, now);
  for (const job of due) {
    await executeJob(state, job, now, { forced: false });
  }
}
async function executeJobCore(state, job) {
  if (job.sessionTarget === "main") {
    const text = resolveJobPayloadTextForMain(job);
    if (!text) {
      const kind = job.payload.kind;
      return {
        status: "skipped",
        error:
          kind === "systemEvent"
            ? "main job requires non-empty systemEvent text"
            : 'main job requires payload.kind="systemEvent"',
      };
    }
    state.deps.enqueueSystemEvent(text, {
      agentId: job.agentId,
      sessionKey: job.sessionKey,
      contextKey: `cron:${job.id}`,
    });
    if (job.wakeMode === "now" && state.deps.runHeartbeatOnce) {
      const reason = `cron:${job.id}`;
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const maxWaitMs = state.deps.wakeNowHeartbeatBusyMaxWaitMs ?? 120000;
      const retryDelayMs = state.deps.wakeNowHeartbeatBusyRetryDelayMs ?? 250;
      const waitStartedAt = state.deps.nowMs();
      let heartbeatResult;
      for (;;) {
        heartbeatResult = await state.deps.runHeartbeatOnce({
          reason,
          agentId: job.agentId,
          sessionKey: job.sessionKey,
        });
        if (
          heartbeatResult.status !== "skipped" ||
          heartbeatResult.reason !== "requests-in-flight"
        ) {
          break;
        }
        if (state.deps.nowMs() - waitStartedAt > maxWaitMs) {
          state.deps.requestHeartbeatNow({
            reason,
            agentId: job.agentId,
            sessionKey: job.sessionKey,
          });
          return { status: "ok", summary: text };
        }
        await delay(retryDelayMs);
      }
      if (heartbeatResult.status === "ran") {
        return { status: "ok", summary: text };
      } else if (heartbeatResult.status === "skipped") {
        return { status: "skipped", error: heartbeatResult.reason, summary: text };
      } else {
        return { status: "error", error: heartbeatResult.reason, summary: text };
      }
    } else {
      state.deps.requestHeartbeatNow({
        reason: `cron:${job.id}`,
        agentId: job.agentId,
        sessionKey: job.sessionKey,
      });
      return { status: "ok", summary: text };
    }
  }
  if (job.payload.kind !== "agentTurn") {
    return { status: "skipped", error: "isolated job requires payload.kind=agentTurn" };
  }
  const res = await state.deps.runIsolatedAgentJob({
    job,
    message: job.payload.message,
  });
  const summaryText = res.summary?.trim();
  const deliveryPlan = resolveCronDeliveryPlan(job);
  if (summaryText && deliveryPlan.requested && !res.delivered && job.sessionKey) {
    const label = `Cron: ${summaryText}`;
    state.deps.sendToSession({
      sessionKey: job.sessionKey,
      message: label,
      jobId: job.id,
    });
  }
  const keysToDelete = new Set([res.cronSessionKey, res.sessionKey].filter(Boolean));
  for (const key of keysToDelete) {
    state.deps.deleteCronSession?.({ sessionKey: key, jobId: job.id });
  }
  return {
    status: res.status,
    error: res.error,
    summary: res.summary,
    sessionId: res.sessionId,
    sessionKey: res.sessionKey,
    model: res.model,
    provider: res.provider,
    usage: res.usage,
  };
}
export async function executeJob(state, job, _nowMs, _opts) {
  if (!job.state) {
    job.state = {};
  }
  const startedAt = state.deps.nowMs();
  job.state.runningAtMs = startedAt;
  job.state.lastError = undefined;
  emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });
  let coreResult;
  try {
    coreResult = await executeJobCore(state, job);
  } catch (err) {
    coreResult = { status: "error", error: String(err) };
  }
  const endedAt = state.deps.nowMs();
  const shouldDelete = applyJobResult(state, job, {
    status: coreResult.status,
    error: coreResult.error,
    startedAt,
    endedAt,
  });
  emitJobFinished(state, job, coreResult, startedAt);
  if (shouldDelete && state.store) {
    state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
    emit(state, { jobId: job.id, action: "removed" });
  }
}
export function wake(state, opts) {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false };
  }
  state.deps.enqueueSystemEvent(text);
  if (opts.mode === "now") {
    state.deps.requestHeartbeatNow({ reason: "wake" });
  }
  return { ok: true };
}
export function stopTimer(state) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
}
export function emit(state, evt) {
  try {
    state.deps.onEvent?.(evt);
  } catch {}
}
