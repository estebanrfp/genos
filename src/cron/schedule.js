let resolveCronTimezone = function (tz) {
  const trimmed = typeof tz === "string" ? tz.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};
import { Cron } from "croner";
import { parseAbsoluteTimeMs } from "./parse.js";
export function computeNextRunAtMs(schedule, nowMs) {
  if (schedule.kind === "at") {
    const sched = schedule;
    const atMs =
      typeof sched.atMs === "number" && Number.isFinite(sched.atMs) && sched.atMs > 0
        ? sched.atMs
        : typeof sched.atMs === "string"
          ? parseAbsoluteTimeMs(sched.atMs)
          : typeof sched.at === "string"
            ? parseAbsoluteTimeMs(sched.at)
            : null;
    if (atMs === null) {
      return;
    }
    return atMs > nowMs ? atMs : undefined;
  }
  if (schedule.kind === "every") {
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (nowMs < anchor) {
      return anchor;
    }
    const elapsed = nowMs - anchor;
    const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
    return anchor + steps * everyMs;
  }
  const expr = schedule.expr.trim();
  if (!expr) {
    return;
  }
  const cron = new Cron(expr, {
    timezone: resolveCronTimezone(schedule.tz),
    catch: false,
  });
  const next = cron.nextRun(new Date(nowMs));
  if (!next) {
    return;
  }
  const nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) {
    return;
  }
  if (nextMs > nowMs) {
    return nextMs;
  }
  const nextSecondMs = Math.floor(nowMs / 1000) * 1000 + 1000;
  const retry = cron.nextRun(new Date(nextSecondMs));
  if (!retry) {
    return;
  }
  const retryMs = retry.getTime();
  return Number.isFinite(retryMs) && retryMs > nowMs ? retryMs : undefined;
}
