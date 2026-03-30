let resolveStableCronOffsetMs = function (jobId, staggerMs) {
    if (staggerMs <= 1) {
      return 0;
    }
    const digest = crypto.createHash("sha256").update(jobId).digest();
    return digest.readUInt32BE(0) % staggerMs;
  },
  computeStaggeredCronNextRunAtMs = function (job, nowMs) {
    if (job.schedule.kind !== "cron") {
      return computeNextRunAtMs(job.schedule, nowMs);
    }
    const staggerMs = resolveCronStaggerMs(job.schedule);
    const offsetMs = resolveStableCronOffsetMs(job.id, staggerMs);
    if (offsetMs <= 0) {
      return computeNextRunAtMs(job.schedule, nowMs);
    }
    let cursorMs = Math.max(0, nowMs - offsetMs);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const baseNext = computeNextRunAtMs(job.schedule, cursorMs);
      if (baseNext === undefined) {
        return;
      }
      const shifted = baseNext + offsetMs;
      if (shifted > nowMs) {
        return shifted;
      }
      cursorMs = Math.max(cursorMs + 1, baseNext + 1000);
    }
    return;
  },
  resolveEveryAnchorMs = function (params) {
    const raw = params.schedule.anchorMs;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.max(0, Math.floor(raw));
    }
    return Math.max(0, Math.floor(params.fallbackAnchorMs));
  },
  assertDeliverySupport = function (job) {
    if (!job.delivery) {
      return;
    }
    if (job.delivery.mode === "webhook") {
      const target = normalizeHttpWebhookUrl(job.delivery.to);
      if (!target) {
        throw new Error("cron webhook delivery requires delivery.to to be a valid http(s) URL");
      }
      job.delivery.to = target;
      return;
    }
    if (job.sessionTarget !== "isolated") {
      throw new Error(
        'cron channel delivery config is only supported for sessionTarget="isolated"',
      );
    }
  },
  recordScheduleComputeError = function (params) {
    const { state, job, err } = params;
    const errorCount = (job.state.scheduleErrorCount ?? 0) + 1;
    const errText = String(err);
    job.state.scheduleErrorCount = errorCount;
    job.state.nextRunAtMs = undefined;
    job.state.lastError = `schedule error: ${errText}`;
    if (errorCount >= MAX_SCHEDULE_ERRORS) {
      job.enabled = false;
      state.deps.log.error(
        { jobId: job.id, name: job.name, errorCount, err: errText },
        "cron: auto-disabled job after repeated schedule errors",
      );
    } else {
      state.deps.log.warn(
        { jobId: job.id, name: job.name, errorCount, err: errText },
        "cron: failed to compute next run for job (skipping)",
      );
    }
    return true;
  },
  normalizeJobTickState = function (params) {
    const { state, job, nowMs } = params;
    let changed = false;
    if (!job.state) {
      job.state = {};
      changed = true;
    }
    if (!job.enabled) {
      if (job.state.nextRunAtMs !== undefined) {
        job.state.nextRunAtMs = undefined;
        changed = true;
      }
      if (job.state.runningAtMs !== undefined) {
        job.state.runningAtMs = undefined;
        changed = true;
      }
      return { changed, skip: true };
    }
    const runningAt = job.state.runningAtMs;
    if (typeof runningAt === "number" && nowMs - runningAt > STUCK_RUN_MS) {
      state.deps.log.warn(
        { jobId: job.id, runningAtMs: runningAt },
        "cron: clearing stuck running marker",
      );
      job.state.runningAtMs = undefined;
      changed = true;
    }
    return { changed, skip: false };
  },
  walkSchedulableJobs = function (state, fn) {
    if (!state.store) {
      return false;
    }
    let changed = false;
    const now = state.deps.nowMs();
    for (const job of state.store.jobs) {
      const tick = normalizeJobTickState({ state, job, nowMs: now });
      if (tick.changed) {
        changed = true;
      }
      if (tick.skip) {
        continue;
      }
      if (fn({ job, nowMs: now })) {
        changed = true;
      }
    }
    return changed;
  },
  recomputeJobNextRunAtMs = function (params) {
    let changed = false;
    try {
      const newNext = computeJobNextRunAtMs(params.job, params.nowMs);
      if (params.job.state.nextRunAtMs !== newNext) {
        params.job.state.nextRunAtMs = newNext;
        changed = true;
      }
      if (params.job.state.scheduleErrorCount) {
        params.job.state.scheduleErrorCount = undefined;
        changed = true;
      }
    } catch (err) {
      if (recordScheduleComputeError({ state: params.state, job: params.job, err })) {
        changed = true;
      }
    }
    return changed;
  },
  mergeCronPayload = function (existing, patch) {
    if (patch.kind !== existing.kind) {
      return buildPayloadFromPatch(patch);
    }
    if (patch.kind === "systemEvent") {
      if (existing.kind !== "systemEvent") {
        return buildPayloadFromPatch(patch);
      }
      const text = typeof patch.text === "string" ? patch.text : existing.text;
      return { kind: "systemEvent", text };
    }
    if (existing.kind !== "agentTurn") {
      return buildPayloadFromPatch(patch);
    }
    const next = { ...existing };
    if (typeof patch.message === "string") {
      next.message = patch.message;
    }
    if (typeof patch.model === "string") {
      next.model = patch.model;
    }
    if (typeof patch.thinking === "string") {
      next.thinking = patch.thinking;
    }
    if (typeof patch.timeoutSeconds === "number") {
      next.timeoutSeconds = patch.timeoutSeconds;
    }
    if (typeof patch.allowUnsafeExternalContent === "boolean") {
      next.allowUnsafeExternalContent = patch.allowUnsafeExternalContent;
    }
    if (typeof patch.deliver === "boolean") {
      next.deliver = patch.deliver;
    }
    if (typeof patch.channel === "string") {
      next.channel = patch.channel;
    }
    if (typeof patch.to === "string") {
      next.to = patch.to;
    }
    if (typeof patch.bestEffortDeliver === "boolean") {
      next.bestEffortDeliver = patch.bestEffortDeliver;
    }
    return next;
  },
  buildLegacyDeliveryPatch = function (payload) {
    const deliver = payload.deliver;
    const toRaw = typeof payload.to === "string" ? payload.to.trim() : "";
    const hasLegacyHints =
      typeof deliver === "boolean" ||
      typeof payload.bestEffortDeliver === "boolean" ||
      Boolean(toRaw);
    if (!hasLegacyHints) {
      return null;
    }
    const patch = {};
    let hasPatch = false;
    if (deliver === false) {
      patch.mode = "none";
      hasPatch = true;
    } else if (deliver === true || toRaw) {
      patch.mode = "announce";
      hasPatch = true;
    }
    if (typeof payload.channel === "string") {
      const channel = payload.channel.trim().toLowerCase();
      patch.channel = channel ? channel : undefined;
      hasPatch = true;
    }
    if (typeof payload.to === "string") {
      patch.to = payload.to.trim();
      hasPatch = true;
    }
    if (typeof payload.bestEffortDeliver === "boolean") {
      patch.bestEffort = payload.bestEffortDeliver;
      hasPatch = true;
    }
    return hasPatch ? patch : null;
  },
  buildPayloadFromPatch = function (patch) {
    if (patch.kind === "systemEvent") {
      if (typeof patch.text !== "string" || patch.text.length === 0) {
        throw new Error('cron.update payload.kind="systemEvent" requires text');
      }
      return { kind: "systemEvent", text: patch.text };
    }
    if (typeof patch.message !== "string" || patch.message.length === 0) {
      throw new Error('cron.update payload.kind="agentTurn" requires message');
    }
    return {
      kind: "agentTurn",
      message: patch.message,
      model: patch.model,
      thinking: patch.thinking,
      timeoutSeconds: patch.timeoutSeconds,
      allowUnsafeExternalContent: patch.allowUnsafeExternalContent,
      deliver: patch.deliver,
      channel: patch.channel,
      to: patch.to,
      bestEffortDeliver: patch.bestEffortDeliver,
    };
  },
  mergeCronDelivery = function (existing, patch) {
    const next = {
      mode: existing?.mode ?? "none",
      channel: existing?.channel,
      to: existing?.to,
      bestEffort: existing?.bestEffort,
    };
    if (typeof patch.mode === "string") {
      next.mode = patch.mode === "deliver" ? "announce" : patch.mode;
    }
    if ("channel" in patch) {
      const channel = typeof patch.channel === "string" ? patch.channel.trim() : "";
      next.channel = channel ? channel : undefined;
    }
    if ("to" in patch) {
      const to = typeof patch.to === "string" ? patch.to.trim() : "";
      next.to = to ? to : undefined;
    }
    if (typeof patch.bestEffort === "boolean") {
      next.bestEffort = patch.bestEffort;
    }
    return next;
  };
import crypto from "node:crypto";
import { parseAbsoluteTimeMs } from "../parse.js";
import { computeNextRunAtMs } from "../schedule.js";
import {
  normalizeCronStaggerMs,
  resolveCronStaggerMs,
  resolveDefaultCronStaggerMs,
} from "../stagger.js";
import { normalizeHttpWebhookUrl } from "../webhook-url.js";
import {
  normalizeOptionalAgentId,
  normalizeOptionalSessionKey,
  normalizeOptionalText,
  normalizePayloadToSystemText,
  normalizeRequiredName,
} from "./normalize.js";
const STUCK_RUN_MS = 7200000;
export function assertSupportedJobSpec(job) {
  if (job.sessionTarget === "main" && job.payload.kind !== "systemEvent") {
    throw new Error('main cron jobs require payload.kind="systemEvent"');
  }
  if (job.sessionTarget === "isolated" && job.payload.kind !== "agentTurn") {
    throw new Error('isolated cron jobs require payload.kind="agentTurn"');
  }
}
export function findJobOrThrow(state, id) {
  const job = state.store?.jobs.find((j) => j.id === id);
  if (!job) {
    throw new Error(`unknown cron job id: ${id}`);
  }
  return job;
}
export function computeJobNextRunAtMs(job, nowMs) {
  if (!job.enabled) {
    return;
  }
  if (job.schedule.kind === "every") {
    const anchorMs = resolveEveryAnchorMs({
      schedule: job.schedule,
      fallbackAnchorMs: job.createdAtMs,
    });
    return computeNextRunAtMs({ ...job.schedule, anchorMs }, nowMs);
  }
  if (job.schedule.kind === "at") {
    if (job.state.lastStatus === "ok" && job.state.lastRunAtMs) {
      return;
    }
    const schedule = job.schedule;
    const atMs =
      typeof schedule.atMs === "number" && Number.isFinite(schedule.atMs) && schedule.atMs > 0
        ? schedule.atMs
        : typeof schedule.atMs === "string"
          ? parseAbsoluteTimeMs(schedule.atMs)
          : typeof schedule.at === "string"
            ? parseAbsoluteTimeMs(schedule.at)
            : null;
    return atMs !== null ? atMs : undefined;
  }
  const next = computeStaggeredCronNextRunAtMs(job, nowMs);
  if (next === undefined && job.schedule.kind === "cron") {
    const nextSecondMs = Math.floor(nowMs / 1000) * 1000 + 1000;
    return computeStaggeredCronNextRunAtMs(job, nextSecondMs);
  }
  return next;
}
const MAX_SCHEDULE_ERRORS = 3;
export function recomputeNextRuns(state) {
  return walkSchedulableJobs(state, ({ job, nowMs: now }) => {
    let changed = false;
    const nextRun = job.state.nextRunAtMs;
    const isDueOrMissing = nextRun === undefined || now >= nextRun;
    if (isDueOrMissing) {
      if (recomputeJobNextRunAtMs({ state, job, nowMs: now })) {
        changed = true;
      }
    }
    return changed;
  });
}
export function recomputeNextRunsForMaintenance(state) {
  return walkSchedulableJobs(state, ({ job, nowMs: now }) => {
    let changed = false;
    if (job.state.nextRunAtMs === undefined) {
      if (recomputeJobNextRunAtMs({ state, job, nowMs: now })) {
        changed = true;
      }
    }
    return changed;
  });
}
export function nextWakeAtMs(state) {
  const jobs = state.store?.jobs ?? [];
  const enabled = jobs.filter((j) => j.enabled && typeof j.state.nextRunAtMs === "number");
  if (enabled.length === 0) {
    return;
  }
  return enabled.reduce(
    (min, j) => Math.min(min, j.state.nextRunAtMs),
    enabled[0].state.nextRunAtMs,
  );
}
export function createJob(state, input) {
  const now = state.deps.nowMs();
  const id = crypto.randomUUID();
  const schedule =
    input.schedule.kind === "every"
      ? {
          ...input.schedule,
          anchorMs: resolveEveryAnchorMs({
            schedule: input.schedule,
            fallbackAnchorMs: now,
          }),
        }
      : input.schedule.kind === "cron"
        ? (() => {
            const explicitStaggerMs = normalizeCronStaggerMs(input.schedule.staggerMs);
            if (explicitStaggerMs !== undefined) {
              return { ...input.schedule, staggerMs: explicitStaggerMs };
            }
            const defaultStaggerMs = resolveDefaultCronStaggerMs(input.schedule.expr);
            return defaultStaggerMs !== undefined
              ? { ...input.schedule, staggerMs: defaultStaggerMs }
              : input.schedule;
          })()
        : input.schedule;
  const deleteAfterRun =
    typeof input.deleteAfterRun === "boolean"
      ? input.deleteAfterRun
      : schedule.kind === "at"
        ? true
        : undefined;
  const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
  const job = {
    id,
    agentId: normalizeOptionalAgentId(input.agentId),
    sessionKey: normalizeOptionalSessionKey(input.sessionKey),
    name: normalizeRequiredName(input.name),
    description: normalizeOptionalText(input.description),
    enabled,
    deleteAfterRun,
    createdAtMs: now,
    updatedAtMs: now,
    schedule,
    sessionTarget: input.sessionTarget,
    wakeMode: input.wakeMode,
    payload: input.payload,
    delivery: input.delivery,
    state: {
      ...input.state,
    },
  };
  assertSupportedJobSpec(job);
  assertDeliverySupport(job);
  job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
  return job;
}
export function applyJobPatch(job, patch) {
  if ("name" in patch) {
    job.name = normalizeRequiredName(patch.name);
  }
  if ("description" in patch) {
    job.description = normalizeOptionalText(patch.description);
  }
  if (typeof patch.enabled === "boolean") {
    job.enabled = patch.enabled;
  }
  if (typeof patch.deleteAfterRun === "boolean") {
    job.deleteAfterRun = patch.deleteAfterRun;
  }
  if (patch.schedule) {
    if (patch.schedule.kind === "cron") {
      const explicitStaggerMs = normalizeCronStaggerMs(patch.schedule.staggerMs);
      if (explicitStaggerMs !== undefined) {
        job.schedule = { ...patch.schedule, staggerMs: explicitStaggerMs };
      } else if (job.schedule.kind === "cron") {
        job.schedule = { ...patch.schedule, staggerMs: job.schedule.staggerMs };
      } else {
        const defaultStaggerMs = resolveDefaultCronStaggerMs(patch.schedule.expr);
        job.schedule =
          defaultStaggerMs !== undefined
            ? { ...patch.schedule, staggerMs: defaultStaggerMs }
            : patch.schedule;
      }
    } else {
      job.schedule = patch.schedule;
    }
  }
  if (patch.sessionTarget) {
    job.sessionTarget = patch.sessionTarget;
  }
  if (patch.wakeMode) {
    job.wakeMode = patch.wakeMode;
  }
  if (patch.payload) {
    job.payload = mergeCronPayload(job.payload, patch.payload);
  }
  if (!patch.delivery && patch.payload?.kind === "agentTurn") {
    const legacyDeliveryPatch = buildLegacyDeliveryPatch(patch.payload);
    if (
      legacyDeliveryPatch &&
      job.sessionTarget === "isolated" &&
      job.payload.kind === "agentTurn"
    ) {
      job.delivery = mergeCronDelivery(job.delivery, legacyDeliveryPatch);
    }
  }
  if (patch.delivery) {
    job.delivery = mergeCronDelivery(job.delivery, patch.delivery);
  }
  if (job.sessionTarget === "main" && job.delivery?.mode !== "webhook") {
    job.delivery = undefined;
  }
  if (patch.state) {
    job.state = { ...job.state, ...patch.state };
  }
  if ("agentId" in patch) {
    job.agentId = normalizeOptionalAgentId(patch.agentId);
  }
  if ("sessionKey" in patch) {
    job.sessionKey = normalizeOptionalSessionKey(patch.sessionKey);
  }
  assertSupportedJobSpec(job);
  assertDeliverySupport(job);
}
export function isJobDue(job, nowMs, opts) {
  if (!job.state) {
    job.state = {};
  }
  if (typeof job.state.runningAtMs === "number") {
    return false;
  }
  if (opts.forced) {
    return true;
  }
  return job.enabled && typeof job.state.nextRunAtMs === "number" && nowMs >= job.state.nextRunAtMs;
}
export function resolveJobPayloadTextForMain(job) {
  if (job.payload.kind !== "systemEvent") {
    return;
  }
  const text = normalizePayloadToSystemText(job.payload);
  return text.trim() ? text : undefined;
}
