import { formatDurationHuman } from "../../../src/infra/format-time/format-duration.js";
import { formatRelativeTimestamp } from "../../../src/infra/format-time/format-relative.js";
import { stripReasoningTagsFromText } from "../../../src/shared/text/reasoning-tags.js";

export { formatRelativeTimestamp, formatDurationHuman };
export function formatMs(ms) {
  if (!ms && ms !== 0) {
    return "n/a";
  }
  return new Date(ms).toLocaleString();
}
export function formatList(values) {
  if (!values || values.length === 0) {
    return "none";
  }
  return values.filter((v) => Boolean(v && v.trim())).join(", ");
}
export function clampText(value, max = 120) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}\u2026`;
}
export function truncateText(value, max) {
  if (value.length <= max) {
    return { text: value, truncated: false, total: value.length };
  }
  return {
    text: value.slice(0, Math.max(0, max)),
    truncated: true,
    total: value.length,
  };
}
export function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
export function parseList(input) {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
export function stripThinkingTags(value) {
  return stripReasoningTagsFromText(value, { mode: "preserve", trim: "start" });
}
