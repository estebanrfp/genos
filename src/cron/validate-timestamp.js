import { parseAbsoluteTimeMs } from "./parse.js";
const ONE_MINUTE_MS = 60000;
const TEN_YEARS_MS = 315576000000;
export function validateScheduleTimestamp(schedule, nowMs = Date.now()) {
  if (schedule.kind !== "at") {
    return { ok: true };
  }
  const atRaw = typeof schedule.at === "string" ? schedule.at.trim() : "";
  const atMs = atRaw ? parseAbsoluteTimeMs(atRaw) : null;
  if (atMs === null || !Number.isFinite(atMs)) {
    return {
      ok: false,
      message: `Invalid schedule.at: expected ISO-8601 timestamp (got ${String(schedule.at)})`,
    };
  }
  const diffMs = atMs - nowMs;
  if (diffMs < -ONE_MINUTE_MS) {
    const nowDate = new Date(nowMs).toISOString();
    const atDate = new Date(atMs).toISOString();
    const minutesAgo = Math.floor(-diffMs / ONE_MINUTE_MS);
    return {
      ok: false,
      message: `schedule.at is in the past: ${atDate} (${minutesAgo} minutes ago). Current time: ${nowDate}`,
    };
  }
  if (diffMs > TEN_YEARS_MS) {
    const atDate = new Date(atMs).toISOString();
    const yearsAhead = Math.floor(diffMs / 31557600000);
    return {
      ok: false,
      message: `schedule.at is too far in the future: ${atDate} (${yearsAhead} years ahead). Maximum allowed: 10 years`,
    };
  }
  return { ok: true };
}
