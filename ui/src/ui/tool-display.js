let shortenHomeInString = function (input) {
  if (!input) {
    return input;
  }
  const patterns = [
    { re: /^\/Users\/[^/]+(\/|$)/, replacement: "~$1" },
    { re: /^\/home\/[^/]+(\/|$)/, replacement: "~$1" },
    { re: /^C:\\Users\\[^\\]+(\\|$)/i, replacement: "~$1" },
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(input)) {
      return input.replace(pattern.re, pattern.replacement);
    }
  }
  return input;
};
import {
  defaultTitle,
  normalizeToolName,
  normalizeVerb,
  resolveActionSpec,
  resolveDetailFromKeys,
  resolveExecDetail,
  resolveReadDetail,
  resolveWebFetchDetail,
  resolveWebSearchDetail,
  resolveWriteDetail,
} from "../../../src/agents/tool-display-common.js";
import rawConfig from "./tool-display.json";
const TOOL_DISPLAY_CONFIG = rawConfig;
const FALLBACK = TOOL_DISPLAY_CONFIG.fallback ?? { icon: "puzzle" };
const TOOL_MAP = TOOL_DISPLAY_CONFIG.tools ?? {};
export function resolveToolDisplay(params) {
  const name = normalizeToolName(params.name);
  const key = name.toLowerCase();
  const spec = TOOL_MAP[key];
  const icon = spec?.icon ?? FALLBACK.icon ?? "puzzle";
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
      mode: "first",
      coerce: { includeFalse: true, includeZero: true },
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
    icon,
    title,
    label,
    verb,
    detail,
  };
}
export function formatToolDetail(display) {
  if (!display.detail) {
    return;
  }
  if (display.detail.includes(" \xB7 ")) {
    const compact = display.detail
      .split(" \xB7 ")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(", ");
    return compact ? `with ${compact}` : undefined;
  }
  return display.detail;
}
export function formatToolSummary(display) {
  const detail = formatToolDetail(display);
  return detail ? `${display.label}: ${detail}` : display.label;
}
