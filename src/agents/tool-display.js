import { redactToolDetail } from "../logging/redact.js";
import { shortenHomeInString } from "../utils.js";
import {
  defaultTitle,
  formatDetailKey,
  normalizeToolName,
  normalizeVerb,
  resolveActionSpec,
  resolveDetailFromKeys,
  resolveExecDetail,
  resolveReadDetail,
  resolveWebFetchDetail,
  resolveWebSearchDetail,
  resolveWriteDetail,
} from "./tool-display-common.js";
import TOOL_DISPLAY_JSON from "./tool-display.json";
const TOOL_DISPLAY_CONFIG = TOOL_DISPLAY_JSON;
const FALLBACK = TOOL_DISPLAY_CONFIG.fallback ?? { emoji: "\uD83E\uDDE9" };
const TOOL_MAP = TOOL_DISPLAY_CONFIG.tools ?? {};
const DETAIL_LABEL_OVERRIDES = {
  agentId: "agent",
  sessionKey: "session",
  targetId: "target",
  targetUrl: "url",
  nodeId: "node",
  requestId: "request",
  messageId: "message",
  threadId: "thread",
  channelId: "channel",
  guildId: "guild",
  userId: "user",
  runTimeoutSeconds: "timeout",
  timeoutSeconds: "timeout",
  includeTools: "tools",
  pollQuestion: "poll",
  maxChars: "max chars",
};
const MAX_DETAIL_ENTRIES = 8;
export function resolveToolDisplay(params) {
  const name = normalizeToolName(params.name);
  const key = name.toLowerCase();
  const spec = TOOL_MAP[key];
  const emoji = spec?.emoji ?? FALLBACK.emoji ?? "\uD83E\uDDE9";
  const title = spec?.title ?? defaultTitle(name);
  const label = spec?.label ?? title;
  const actionRaw = params.args && typeof params.args === "object" ? params.args.action : undefined;
  const action = typeof actionRaw === "string" ? actionRaw.trim() : undefined;
  const actionSpec = resolveActionSpec(spec, action);
  const fallbackVerb =
    key === "web_search"
      ? "search"
      : key === "web_fetch"
        ? "fetch"
        : key.replace(/_/g, " ").replace(/\./g, " ");
  const verb = normalizeVerb(actionSpec?.label ?? action ?? fallbackVerb);
  let detail;
  if (key === "exec") {
    detail = resolveExecDetail(params.args);
  }
  if (!detail && key === "read") {
    detail = resolveReadDetail(params.args);
  }
  if (!detail && (key === "write" || key === "edit" || key === "attach")) {
    detail = resolveWriteDetail(key, params.args);
  }
  if (!detail && key === "web_search") {
    detail = resolveWebSearchDetail(params.args);
  }
  if (!detail && key === "web_fetch") {
    detail = resolveWebFetchDetail(params.args);
  }
  const detailKeys = actionSpec?.detailKeys ?? spec?.detailKeys ?? FALLBACK.detailKeys ?? [];
  if (!detail && detailKeys.length > 0) {
    detail = resolveDetailFromKeys(params.args, detailKeys, {
      mode: "summary",
      maxEntries: MAX_DETAIL_ENTRIES,
      formatKey: (raw) => formatDetailKey(raw, DETAIL_LABEL_OVERRIDES),
    });
  }
  if (!detail && params.meta) {
    detail = params.meta;
  }
  if (detail) {
    detail = shortenHomeInString(detail);
  }
  return {
    name,
    emoji,
    title,
    label,
    verb,
    detail,
  };
}
export function formatToolDetail(display) {
  const detailRaw = display.detail ? redactToolDetail(display.detail) : undefined;
  if (!detailRaw) {
    return;
  }
  if (detailRaw.includes(" \xB7 ")) {
    const compact = detailRaw
      .split(" \xB7 ")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(", ");
    return compact ? `with ${compact}` : undefined;
  }
  return detailRaw;
}
export function formatToolSummary(display) {
  const detail = formatToolDetail(display);
  return detail
    ? `${display.emoji} ${display.label}: ${detail}`
    : `${display.emoji} ${display.label}`;
}
