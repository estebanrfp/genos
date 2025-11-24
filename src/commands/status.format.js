import { formatDurationPrecise } from "../infra/format-time/format-duration.js";
import { formatRuntimeStatusWithDetails } from "../infra/runtime-status.js";
export const formatKTokens = (value) => `${(value / 1000).toFixed(value >= 1e4 ? 0 : 1)}k`;
export const formatDuration = (ms) => {
  if (ms == null || !Number.isFinite(ms)) {
    return "unknown";
  }
  return formatDurationPrecise(ms, { decimals: 1 });
};
export const shortenText = (value, maxLen) => {
  const chars = Array.from(value);
  if (chars.length <= maxLen) {
    return value;
  }
  return `${chars.slice(0, Math.max(0, maxLen - 1)).join("")}\u2026`;
};
export const formatTokensCompact = (sess) => {
  const used = sess.totalTokens;
  const ctx = sess.contextTokens;
  if (used == null) {
    return ctx ? `unknown/${formatKTokens(ctx)} (?%)` : "unknown used";
  }
  if (!ctx) {
    return `${formatKTokens(used)} used`;
  }
  const pctLabel = sess.percentUsed != null ? `${sess.percentUsed}%` : "?%";
  return `${formatKTokens(used)}/${formatKTokens(ctx)} (${pctLabel})`;
};
export const formatDaemonRuntimeShort = (runtime) => {
  if (!runtime) {
    return null;
  }
  const details = [];
  const detail = runtime.detail?.replace(/\s+/g, " ").trim() || "";
  const noisyLaunchctlDetail =
    runtime.missingUnit === true && detail.toLowerCase().includes("could not find service");
  if (detail && !noisyLaunchctlDetail) {
    details.push(detail);
  }
  return formatRuntimeStatusWithDetails({
    status: runtime.status,
    pid: runtime.pid,
    state: runtime.state,
    details,
  });
};
