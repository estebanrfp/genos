let parseCronFields = function (expr) {
  return expr.trim().split(/\s+/).filter(Boolean);
};
export const DEFAULT_TOP_OF_HOUR_STAGGER_MS = 300000;
export function isRecurringTopOfHourCronExpr(expr) {
  const fields = parseCronFields(expr);
  if (fields.length === 5) {
    const [minuteField, hourField] = fields;
    return minuteField === "0" && hourField.includes("*");
  }
  if (fields.length === 6) {
    const [secondField, minuteField, hourField] = fields;
    return secondField === "0" && minuteField === "0" && hourField.includes("*");
  }
  return false;
}
export function normalizeCronStaggerMs(raw) {
  const numeric =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return;
  }
  return Math.max(0, Math.floor(numeric));
}
export function resolveDefaultCronStaggerMs(expr) {
  return isRecurringTopOfHourCronExpr(expr) ? DEFAULT_TOP_OF_HOUR_STAGGER_MS : undefined;
}
export function resolveCronStaggerMs(schedule) {
  const explicit = normalizeCronStaggerMs(schedule.staggerMs);
  if (explicit !== undefined) {
    return explicit;
  }
  return resolveDefaultCronStaggerMs(schedule.expr) ?? 0;
}
