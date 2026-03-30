export function resolveTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return;
  }
}
export function formatUtcTimestamp(date, options) {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  if (!options?.displaySeconds) {
    return `${yyyy}-${mm}-${dd}T${hh}:${min}Z`;
  }
  const sec = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}Z`;
}
export function formatZonedTimestamp(date, options) {
  const intlOptions = {
    timeZone: options?.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  };
  if (options?.displaySeconds) {
    intlOptions.second = "2-digit";
  }
  const parts = new Intl.DateTimeFormat("en-US", intlOptions).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  const yyyy = pick("year");
  const mm = pick("month");
  const dd = pick("day");
  const hh = pick("hour");
  const min = pick("minute");
  const sec = options?.displaySeconds ? pick("second") : undefined;
  const tz = [...parts]
    .toReversed()
    .find((part) => part.type === "timeZoneName")
    ?.value?.trim();
  if (!yyyy || !mm || !dd || !hh || !min) {
    return;
  }
  if (options?.displaySeconds && sec) {
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}${tz ? ` ${tz}` : ""}`;
  }
  return `${yyyy}-${mm}-${dd} ${hh}:${min}${tz ? ` ${tz}` : ""}`;
}
