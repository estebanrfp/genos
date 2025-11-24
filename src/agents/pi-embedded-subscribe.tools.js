let truncateToolText = function (text) {
    if (text.length <= TOOL_RESULT_MAX_CHARS) {
      return text;
    }
    return `${truncateUtf16Safe(text, TOOL_RESULT_MAX_CHARS)}
\u2026(truncated)\u2026`;
  },
  normalizeToolErrorText = function (text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
    if (!firstLine) {
      return;
    }
    return firstLine.length > TOOL_ERROR_MAX_CHARS
      ? `${truncateUtf16Safe(firstLine, TOOL_ERROR_MAX_CHARS)}\u2026`
      : firstLine;
  },
  isErrorLikeStatus = function (status) {
    const normalized = status.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (
      normalized === "0" ||
      normalized === "ok" ||
      normalized === "success" ||
      normalized === "completed" ||
      normalized === "running"
    ) {
      return false;
    }
    return /error|fail|timeout|timed[_\s-]?out|denied|cancel|invalid|forbidden/.test(normalized);
  },
  readErrorCandidate = function (value) {
    if (typeof value === "string") {
      return normalizeToolErrorText(value);
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value;
    if (typeof record.message === "string") {
      return normalizeToolErrorText(record.message);
    }
    if (typeof record.error === "string") {
      return normalizeToolErrorText(record.error);
    }
    return;
  },
  extractErrorField = function (value) {
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value;
    const direct =
      readErrorCandidate(record.error) ??
      readErrorCandidate(record.message) ??
      readErrorCandidate(record.reason);
    if (direct) {
      return direct;
    }
    const status = typeof record.status === "string" ? record.status.trim() : "";
    if (!status || !isErrorLikeStatus(status)) {
      return;
    }
    return normalizeToolErrorText(status);
  };
import { getChannelPlugin, normalizeChannelId } from "../channels/plugins/index.js";
import { normalizeTargetForProvider } from "../infra/outbound/target-normalization.js";
import { MEDIA_TOKEN_RE } from "../media/parse.js";
import { truncateUtf16Safe } from "../utils.js";
import { collectTextContentBlocks } from "./content-blocks.js";
const TOOL_RESULT_MAX_CHARS = 8000;
const TOOL_ERROR_MAX_CHARS = 400;
export function sanitizeToolResult(result) {
  if (!result || typeof result !== "object") {
    return result;
  }
  const record = result;
  const content = Array.isArray(record.content) ? record.content : null;
  if (!content) {
    return record;
  }
  const sanitized = content.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const entry = item;
    const type = typeof entry.type === "string" ? entry.type : undefined;
    if (type === "text" && typeof entry.text === "string") {
      return { ...entry, text: truncateToolText(entry.text) };
    }
    if (type === "image") {
      const data = typeof entry.data === "string" ? entry.data : undefined;
      const bytes = data ? data.length : undefined;
      const cleaned = { ...entry };
      delete cleaned.data;
      return { ...cleaned, bytes, omitted: true };
    }
    return entry;
  });
  return { ...record, content: sanitized };
}
export function extractToolResultText(result) {
  if (!result || typeof result !== "object") {
    return;
  }
  const record = result;
  const texts = collectTextContentBlocks(record.content)
    .map((item) => {
      const trimmed = item.trim();
      return trimmed ? trimmed : undefined;
    })
    .filter((value) => Boolean(value));
  if (texts.length === 0) {
    return;
  }
  return texts.join("\n");
}
export function extractToolResultMediaPaths(result) {
  if (!result || typeof result !== "object") {
    return [];
  }
  const record = result;
  const content = Array.isArray(record.content) ? record.content : null;
  if (!content) {
    return [];
  }
  const paths = [];
  let hasImageContent = false;
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const entry = item;
    if (entry.type === "image") {
      hasImageContent = true;
      continue;
    }
    if (entry.type === "text" && typeof entry.text === "string") {
      for (const line of entry.text.split("\n")) {
        if (!line.trimStart().startsWith("MEDIA:")) {
          continue;
        }
        MEDIA_TOKEN_RE.lastIndex = 0;
        let match;
        while ((match = MEDIA_TOKEN_RE.exec(line)) !== null) {
          const p = match[1]
            ?.replace(/^[`"'[{(]+/, "")
            .replace(/[`"'\]})\\,]+$/, "")
            .trim();
          if (p && p.length <= 4096) {
            paths.push(p);
          }
        }
      }
    }
  }
  if (paths.length > 0) {
    return paths;
  }
  if (hasImageContent) {
    const details = record.details;
    const p = typeof details?.path === "string" ? details.path.trim() : "";
    if (p) {
      return [p];
    }
  }
  return [];
}
export function isToolResultError(result) {
  if (!result || typeof result !== "object") {
    return false;
  }
  const record = result;
  const details = record.details;
  if (!details || typeof details !== "object") {
    return false;
  }
  const status = details.status;
  if (typeof status !== "string") {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return normalized === "error" || normalized === "timeout";
}
export function extractToolErrorMessage(result) {
  if (!result || typeof result !== "object") {
    return;
  }
  const record = result;
  const fromDetails = extractErrorField(record.details);
  if (fromDetails) {
    return fromDetails;
  }
  const fromRoot = extractErrorField(record);
  if (fromRoot) {
    return fromRoot;
  }
  const text = extractToolResultText(result);
  if (!text) {
    return;
  }
  try {
    const parsed = JSON.parse(text);
    const fromJson = extractErrorField(parsed);
    if (fromJson) {
      return fromJson;
    }
  } catch {}
  return normalizeToolErrorText(text);
}
export function extractMessagingToolSend(toolName, args) {
  const action = typeof args.action === "string" ? args.action.trim() : "";
  const accountIdRaw = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
  const accountId = accountIdRaw ? accountIdRaw : undefined;
  if (toolName === "message") {
    if (action !== "send" && action !== "thread-reply") {
      return;
    }
    const toRaw = typeof args.to === "string" ? args.to : undefined;
    if (!toRaw) {
      return;
    }
    const providerRaw = typeof args.provider === "string" ? args.provider.trim() : "";
    const channelRaw = typeof args.channel === "string" ? args.channel.trim() : "";
    const providerHint = providerRaw || channelRaw;
    const providerId = providerHint ? normalizeChannelId(providerHint) : null;
    const provider = providerId ?? (providerHint ? providerHint.toLowerCase() : "message");
    const to = normalizeTargetForProvider(provider, toRaw);
    return to ? { tool: toolName, provider, accountId, to } : undefined;
  }
  const providerId = normalizeChannelId(toolName);
  if (!providerId) {
    return;
  }
  const plugin = getChannelPlugin(providerId);
  const extracted = plugin?.actions?.extractToolSend?.({ args });
  if (!extracted?.to) {
    return;
  }
  const to = normalizeTargetForProvider(providerId, extracted.to);
  return to
    ? {
        tool: toolName,
        provider: providerId,
        accountId: extracted.accountId ?? accountId,
        to,
      }
    : undefined;
}
