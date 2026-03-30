let formatRateLimitOrOverloadedErrorCopy = function (raw) {
    if (isRateLimitErrorMessage(raw)) {
      return RATE_LIMIT_ERROR_USER_MESSAGE;
    }
    if (isOverloadedErrorMessage(raw)) {
      return OVERLOADED_ERROR_USER_MESSAGE;
    }
    return;
  },
  extractLeadingHttpStatus = function (raw) {
    const match = raw.match(HTTP_STATUS_CODE_PREFIX_RE);
    if (!match) {
      return null;
    }
    const code = Number(match[1]);
    if (!Number.isFinite(code)) {
      return null;
    }
    return { code, rest: (match[2] ?? "").trim() };
  },
  stripFinalTagsFromText = function (text) {
    if (!text) {
      return text;
    }
    return text.replace(FINAL_TAG_RE, "");
  },
  collapseConsecutiveDuplicateBlocks = function (text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return text;
    }
    const blocks = trimmed.split(/\n{2,}/);
    if (blocks.length < 2) {
      return text;
    }
    const normalizeBlock = (value) => value.trim().replace(/\s+/g, " ");
    const result = [];
    let lastNormalized = null;
    for (const block of blocks) {
      const normalized = normalizeBlock(block);
      if (lastNormalized && normalized === lastNormalized) {
        continue;
      }
      result.push(block.trim());
      lastNormalized = normalized;
    }
    if (result.length === blocks.length) {
      return text;
    }
    return result.join("\n\n");
  },
  isLikelyHttpErrorText = function (raw) {
    if (isCloudflareOrHtmlErrorPage(raw)) {
      return true;
    }
    const match = raw.match(HTTP_STATUS_PREFIX_RE);
    if (!match) {
      return false;
    }
    const code = Number(match[1]);
    if (!Number.isFinite(code) || code < 400) {
      return false;
    }
    const message = match[2].toLowerCase();
    return HTTP_ERROR_HINTS.some((hint) => message.includes(hint));
  },
  shouldRewriteContextOverflowText = function (raw) {
    if (!isContextOverflowError(raw)) {
      return false;
    }
    return (
      isRawApiErrorPayload(raw) ||
      isLikelyHttpErrorText(raw) ||
      ERROR_PREFIX_RE.test(raw) ||
      CONTEXT_OVERFLOW_ERROR_HEAD_RE.test(raw)
    );
  },
  shouldRewriteBillingText = function (raw) {
    if (!isBillingErrorMessage(raw)) {
      return false;
    }
    return (
      isRawApiErrorPayload(raw) ||
      isLikelyHttpErrorText(raw) ||
      ERROR_PREFIX_RE.test(raw) ||
      BILLING_ERROR_HEAD_RE.test(raw)
    );
  },
  isErrorPayloadObject = function (payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    const record = payload;
    if (record.type === "error") {
      return true;
    }
    if (typeof record.request_id === "string" || typeof record.requestId === "string") {
      return true;
    }
    if ("error" in record) {
      const err = record.error;
      if (err && typeof err === "object" && !Array.isArray(err)) {
        const errRecord = err;
        if (
          typeof errRecord.message === "string" ||
          typeof errRecord.type === "string" ||
          typeof errRecord.code === "string"
        ) {
          return true;
        }
      }
    }
    return false;
  },
  parseApiErrorPayload = function (raw) {
    if (!raw) {
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const candidates = [trimmed];
    if (ERROR_PAYLOAD_PREFIX_RE.test(trimmed)) {
      candidates.push(trimmed.replace(ERROR_PAYLOAD_PREFIX_RE, "").trim());
    }
    for (const candidate of candidates) {
      if (!candidate.startsWith("{") || !candidate.endsWith("}")) {
        continue;
      }
      try {
        const parsed = JSON.parse(candidate);
        if (isErrorPayloadObject(parsed)) {
          return parsed;
        }
      } catch {}
    }
    return null;
  },
  matchesErrorPatterns = function (raw, patterns) {
    if (!raw) {
      return false;
    }
    const value = raw.toLowerCase();
    return patterns.some((pattern) =>
      pattern instanceof RegExp ? pattern.test(value) : value.includes(pattern),
    );
  };
import { stableStringify } from "../stable-stringify.js";
export function formatBillingErrorMessage(provider, model) {
  const providerName = provider?.trim();
  const modelName = model?.trim();
  const providerLabel =
    providerName && modelName ? `${providerName} (${modelName})` : providerName || undefined;
  if (providerLabel) {
    return `\u26A0\uFE0F ${providerLabel} returned a billing error \u2014 your API key has run out of credits or has an insufficient balance. Check your ${providerName} billing dashboard and top up or switch to a different API key.`;
  }
  return "\u26A0\uFE0F API provider returned a billing error \u2014 your API key has run out of credits or has an insufficient balance. Check your provider's billing dashboard and top up or switch to a different API key.";
}
export const BILLING_ERROR_USER_MESSAGE = formatBillingErrorMessage();
const RATE_LIMIT_ERROR_USER_MESSAGE =
  "\u26A0\uFE0F API rate limit reached. Please try again later.";
const OVERLOADED_ERROR_USER_MESSAGE =
  "The AI service is temporarily overloaded. Please try again in a moment.";
export function isContextOverflowError(errorMessage) {
  if (!errorMessage) {
    return false;
  }
  const lower = errorMessage.toLowerCase();
  const hasRequestSizeExceeds = lower.includes("request size exceeds");
  const hasContextWindow =
    lower.includes("context window") ||
    lower.includes("context length") ||
    lower.includes("maximum context length");
  return (
    lower.includes("request_too_large") ||
    lower.includes("request exceeds the maximum size") ||
    lower.includes("context length exceeded") ||
    lower.includes("maximum context length") ||
    lower.includes("prompt is too long") ||
    lower.includes("exceeds model context window") ||
    (hasRequestSizeExceeds && hasContextWindow) ||
    lower.includes("context overflow:") ||
    (lower.includes("413") && lower.includes("too large"))
  );
}
const CONTEXT_WINDOW_TOO_SMALL_RE = /context window.*(too small|minimum is)/i;
const CONTEXT_OVERFLOW_HINT_RE =
  /context.*overflow|context window.*(too (?:large|long)|exceed|over|limit|max(?:imum)?|requested|sent|tokens)|prompt.*(too (?:large|long)|exceed|over|limit|max(?:imum)?)|(?:request|input).*(?:context|window|length|token).*(too (?:large|long)|exceed|over|limit|max(?:imum)?)/i;
const RATE_LIMIT_HINT_RE =
  /rate limit|too many requests|requests per (?:minute|hour|day)|quota|throttl|429\b/i;
export function isLikelyContextOverflowError(errorMessage) {
  if (!errorMessage) {
    return false;
  }
  if (CONTEXT_WINDOW_TOO_SMALL_RE.test(errorMessage)) {
    return false;
  }
  if (isRateLimitErrorMessage(errorMessage)) {
    return false;
  }
  if (isContextOverflowError(errorMessage)) {
    return true;
  }
  if (RATE_LIMIT_HINT_RE.test(errorMessage)) {
    return false;
  }
  return CONTEXT_OVERFLOW_HINT_RE.test(errorMessage);
}
export function isCompactionFailureError(errorMessage) {
  if (!errorMessage) {
    return false;
  }
  const lower = errorMessage.toLowerCase();
  const hasCompactionTerm =
    lower.includes("summarization failed") ||
    lower.includes("auto-compaction") ||
    lower.includes("compaction failed") ||
    lower.includes("compaction");
  if (!hasCompactionTerm) {
    return false;
  }
  if (isLikelyContextOverflowError(errorMessage)) {
    return true;
  }
  return lower.includes("context overflow");
}
const ERROR_PAYLOAD_PREFIX_RE =
  /^(?:error|api\s*error|apierror|openai\s*error|anthropic\s*error|gateway\s*error)[:\s-]+/i;
const FINAL_TAG_RE = /<\s*\/?\s*final\s*>/gi;
const ERROR_PREFIX_RE =
  /^(?:error|api\s*error|openai\s*error|anthropic\s*error|gateway\s*error|request failed|failed|exception)[:\s-]+/i;
const CONTEXT_OVERFLOW_ERROR_HEAD_RE =
  /^(?:context overflow:|request_too_large\b|request size exceeds\b|request exceeds the maximum size\b|context length exceeded\b|maximum context length\b|prompt is too long\b|exceeds model context window\b)/i;
const BILLING_ERROR_HEAD_RE =
  /^(?:error[:\s-]+)?billing(?:\s+error)?(?:[:\s-]+|$)|^(?:error[:\s-]+)?(?:credit balance|insufficient credits?|payment required|http\s*402\b)/i;
const HTTP_STATUS_PREFIX_RE = /^(?:http\s*)?(\d{3})\s+(.+)$/i;
const HTTP_STATUS_CODE_PREFIX_RE = /^(?:http\s*)?(\d{3})(?:\s+([\s\S]+))?$/i;
const HTML_ERROR_PREFIX_RE = /^\s*(?:<!doctype\s+html\b|<html\b)/i;
const CLOUDFLARE_HTML_ERROR_CODES = new Set([521, 522, 523, 524, 525, 526, 530]);
const TRANSIENT_HTTP_ERROR_CODES = new Set([500, 502, 503, 521, 522, 523, 524, 529]);
const HTTP_ERROR_HINTS = [
  "error",
  "bad request",
  "not found",
  "unauthorized",
  "forbidden",
  "internal server",
  "service unavailable",
  "gateway",
  "rate limit",
  "overloaded",
  "timeout",
  "timed out",
  "invalid",
  "too many requests",
  "permission",
];
export function isCloudflareOrHtmlErrorPage(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  const status = extractLeadingHttpStatus(trimmed);
  if (!status || status.code < 500) {
    return false;
  }
  if (CLOUDFLARE_HTML_ERROR_CODES.has(status.code)) {
    return true;
  }
  return (
    status.code < 600 && HTML_ERROR_PREFIX_RE.test(status.rest) && /<\/html>/i.test(status.rest)
  );
}
export function isTransientHttpError(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  const status = extractLeadingHttpStatus(trimmed);
  if (!status) {
    return false;
  }
  return TRANSIENT_HTTP_ERROR_CODES.has(status.code);
}
export function getApiErrorPayloadFingerprint(raw) {
  if (!raw) {
    return null;
  }
  const payload = parseApiErrorPayload(raw);
  if (!payload) {
    return null;
  }
  return stableStringify(payload);
}
export function isRawApiErrorPayload(raw) {
  return getApiErrorPayloadFingerprint(raw) !== null;
}
export function parseApiErrorInfo(raw) {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let httpCode;
  let candidate = trimmed;
  const httpPrefixMatch = candidate.match(/^(\d{3})\s+(.+)$/s);
  if (httpPrefixMatch) {
    httpCode = httpPrefixMatch[1];
    candidate = httpPrefixMatch[2].trim();
  }
  const payload = parseApiErrorPayload(candidate);
  if (!payload) {
    return null;
  }
  const requestId =
    typeof payload.request_id === "string"
      ? payload.request_id
      : typeof payload.requestId === "string"
        ? payload.requestId
        : undefined;
  const topType = typeof payload.type === "string" ? payload.type : undefined;
  const topMessage = typeof payload.message === "string" ? payload.message : undefined;
  let errType;
  let errMessage;
  if (payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)) {
    const err = payload.error;
    if (typeof err.type === "string") {
      errType = err.type;
    }
    if (typeof err.code === "string" && !errType) {
      errType = err.code;
    }
    if (typeof err.message === "string") {
      errMessage = err.message;
    }
  }
  return {
    httpCode,
    type: errType ?? topType,
    message: errMessage ?? topMessage,
    requestId,
  };
}
export function formatRawAssistantErrorForUi(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return "LLM request failed with an unknown error.";
  }
  const leadingStatus = extractLeadingHttpStatus(trimmed);
  if (leadingStatus && isCloudflareOrHtmlErrorPage(trimmed)) {
    return `The AI service is temporarily unavailable (HTTP ${leadingStatus.code}). Please try again in a moment.`;
  }
  const httpMatch = trimmed.match(HTTP_STATUS_PREFIX_RE);
  if (httpMatch) {
    const rest = httpMatch[2].trim();
    if (!rest.startsWith("{")) {
      return `HTTP ${httpMatch[1]}: ${rest}`;
    }
  }
  const info = parseApiErrorInfo(trimmed);
  if (info?.message) {
    const prefix = info.httpCode ? `HTTP ${info.httpCode}` : "LLM error";
    const type = info.type ? ` ${info.type}` : "";
    const requestId = info.requestId ? ` (request_id: ${info.requestId})` : "";
    return `${prefix}${type}: ${info.message}${requestId}`;
  }
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}\u2026` : trimmed;
}
export function formatAssistantErrorText(msg, opts) {
  const raw = (msg.errorMessage ?? "").trim();
  if (msg.stopReason !== "error" && !raw) {
    return;
  }
  if (!raw) {
    return "LLM request failed with an unknown error.";
  }
  const unknownTool =
    raw.match(/unknown tool[:\s]+["']?([a-z0-9_-]+)["']?/i) ??
    raw.match(/tool\s+["']?([a-z0-9_-]+)["']?\s+(?:not found|is not available)/i);
  if (unknownTool?.[1]) {
  }
  if (isContextOverflowError(raw)) {
    return "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.";
  }
  if (
    /incorrect role information|roles must alternate|400.*role|"message".*role.*information/i.test(
      raw,
    )
  ) {
    return "Message ordering conflict - please try again. If this persists, use /new to start a fresh session.";
  }
  if (isMissingToolCallInputError(raw)) {
    return "Session history looks corrupted (tool call input missing). Use /new to start a fresh session. If this keeps happening, reset the session or delete the corrupted session transcript.";
  }
  const invalidRequest = raw.match(/"type":"invalid_request_error".*?"message":"([^"]+)"/);
  if (invalidRequest?.[1]) {
    return `LLM request rejected: ${invalidRequest[1]}`;
  }
  const transientCopy = formatRateLimitOrOverloadedErrorCopy(raw);
  if (transientCopy) {
    return transientCopy;
  }
  if (isTimeoutErrorMessage(raw)) {
    return "LLM request timed out.";
  }
  if (isBillingErrorMessage(raw)) {
    return formatBillingErrorMessage(opts?.provider, opts?.model ?? msg.model);
  }
  if (isLikelyHttpErrorText(raw) || isRawApiErrorPayload(raw)) {
    return formatRawAssistantErrorForUi(raw);
  }
  if (raw.length > 600) {
    console.warn("[formatAssistantErrorText] Long error truncated:", raw.slice(0, 200));
  }
  return raw.length > 600 ? `${raw.slice(0, 600)}\u2026` : raw;
}
export function sanitizeUserFacingText(text, opts) {
  if (!text) {
    return text;
  }
  const errorContext = opts?.errorContext ?? false;
  const stripped = stripFinalTagsFromText(text);
  const trimmed = stripped.trim();
  if (!trimmed) {
    return "";
  }
  if (errorContext) {
    if (/incorrect role information|roles must alternate/i.test(trimmed)) {
      return "Message ordering conflict - please try again. If this persists, use /new to start a fresh session.";
    }
    if (shouldRewriteContextOverflowText(trimmed)) {
      return "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.";
    }
    if (isBillingErrorMessage(trimmed)) {
      return BILLING_ERROR_USER_MESSAGE;
    }
    if (isRawApiErrorPayload(trimmed) || isLikelyHttpErrorText(trimmed)) {
      return formatRawAssistantErrorForUi(trimmed);
    }
    if (ERROR_PREFIX_RE.test(trimmed)) {
      const prefixedCopy = formatRateLimitOrOverloadedErrorCopy(trimmed);
      if (prefixedCopy) {
        return prefixedCopy;
      }
      if (isTimeoutErrorMessage(trimmed)) {
        return "LLM request timed out.";
      }
      return formatRawAssistantErrorForUi(trimmed);
    }
  }
  if (shouldRewriteBillingText(trimmed)) {
    return BILLING_ERROR_USER_MESSAGE;
  }
  const withoutLeadingEmptyLines = stripped.replace(/^(?:[ \t]*\r?\n)+/, "");
  return collapseConsecutiveDuplicateBlocks(withoutLeadingEmptyLines);
}
export function isRateLimitAssistantError(msg) {
  if (!msg || msg.stopReason !== "error") {
    return false;
  }
  return isRateLimitErrorMessage(msg.errorMessage ?? "");
}
const ERROR_PATTERNS = {
  rateLimit: [
    /rate[_ ]limit|too many requests|429/,
    "exceeded your current quota",
    "resource has been exhausted",
    "quota exceeded",
    "resource_exhausted",
    "usage limit",
  ],
  overloaded: [/overloaded_error|"type"\s*:\s*"overloaded_error"/i, "overloaded"],
  timeout: [
    "timeout",
    "timed out",
    "deadline exceeded",
    "context deadline exceeded",
    /without sending (?:any )?chunks?/i,
    /\bstop reason:\s*abort\b/i,
    /\breason:\s*abort\b/i,
    /\bunhandled stop reason:\s*abort\b/i,
  ],
  billing: [
    /["']?(?:status|code)["']?\s*[:=]\s*402\b|\bhttp\s*402\b|\berror(?:\s+code)?\s*[:=]?\s*402\b|\b(?:got|returned|received)\s+(?:a\s+)?402\b|^\s*402\s+payment/i,
    "payment required",
    "insufficient credits",
    "credit balance",
    "plans & billing",
    "insufficient balance",
  ],
  auth: [
    /invalid[_ ]?api[_ ]?key/,
    "incorrect api key",
    "invalid token",
    "authentication",
    "re-authenticate",
    "oauth token refresh failed",
    "unauthorized",
    "forbidden",
    "access denied",
    "expired",
    "token has expired",
    /\b401\b/,
    /\b403\b/,
    "no credentials found",
    "no api key found",
  ],
  format: [
    "string should match pattern",
    "tool_use.id",
    "tool_use_id",
    "messages.1.content.1.tool_use.id",
    "invalid request format",
  ],
};
const TOOL_CALL_INPUT_MISSING_RE =
  /tool_(?:use|call)\.(?:input|arguments).*?(?:field required|required)/i;
const TOOL_CALL_INPUT_PATH_RE =
  /messages\.\d+\.content\.\d+\.tool_(?:use|call)\.(?:input|arguments)/i;
const IMAGE_DIMENSION_ERROR_RE =
  /image dimensions exceed max allowed size for many-image requests:\s*(\d+)\s*pixels/i;
const IMAGE_DIMENSION_PATH_RE = /messages\.(\d+)\.content\.(\d+)\.image/i;
const IMAGE_SIZE_ERROR_RE = /image exceeds\s*(\d+(?:\.\d+)?)\s*mb/i;
export function isRateLimitErrorMessage(raw) {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.rateLimit);
}
export function isTimeoutErrorMessage(raw) {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.timeout);
}
export function isBillingErrorMessage(raw) {
  const value = raw.toLowerCase();
  if (!value) {
    return false;
  }
  if (matchesErrorPatterns(value, ERROR_PATTERNS.billing)) {
    return true;
  }
  if (!BILLING_ERROR_HEAD_RE.test(raw)) {
    return false;
  }
  return (
    value.includes("upgrade") ||
    value.includes("credits") ||
    value.includes("payment") ||
    value.includes("plan")
  );
}
export function isMissingToolCallInputError(raw) {
  if (!raw) {
    return false;
  }
  return TOOL_CALL_INPUT_MISSING_RE.test(raw) || TOOL_CALL_INPUT_PATH_RE.test(raw);
}
export function isBillingAssistantError(msg) {
  if (!msg || msg.stopReason !== "error") {
    return false;
  }
  return isBillingErrorMessage(msg.errorMessage ?? "");
}
export function isAuthErrorMessage(raw) {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.auth);
}
export function isOverloadedErrorMessage(raw) {
  return matchesErrorPatterns(raw, ERROR_PATTERNS.overloaded);
}
export function parseImageDimensionError(raw) {
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (!lower.includes("image dimensions exceed max allowed size")) {
    return null;
  }
  const limitMatch = raw.match(IMAGE_DIMENSION_ERROR_RE);
  const pathMatch = raw.match(IMAGE_DIMENSION_PATH_RE);
  return {
    maxDimensionPx: limitMatch?.[1] ? Number.parseInt(limitMatch[1], 10) : undefined,
    messageIndex: pathMatch?.[1] ? Number.parseInt(pathMatch[1], 10) : undefined,
    contentIndex: pathMatch?.[2] ? Number.parseInt(pathMatch[2], 10) : undefined,
    raw,
  };
}
export function isImageDimensionErrorMessage(raw) {
  return Boolean(parseImageDimensionError(raw));
}
export function parseImageSizeError(raw) {
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (!lower.includes("image exceeds") || !lower.includes("mb")) {
    return null;
  }
  const match = raw.match(IMAGE_SIZE_ERROR_RE);
  return {
    maxMb: match?.[1] ? Number.parseFloat(match[1]) : undefined,
    raw,
  };
}
export function isImageSizeError(errorMessage) {
  if (!errorMessage) {
    return false;
  }
  return Boolean(parseImageSizeError(errorMessage));
}
export function isCloudCodeAssistFormatError(raw) {
  return !isImageDimensionErrorMessage(raw) && matchesErrorPatterns(raw, ERROR_PATTERNS.format);
}
export function isAuthAssistantError(msg) {
  if (!msg || msg.stopReason !== "error") {
    return false;
  }
  return isAuthErrorMessage(msg.errorMessage ?? "");
}
export function classifyFailoverReason(raw) {
  if (isImageDimensionErrorMessage(raw)) {
    return null;
  }
  if (isImageSizeError(raw)) {
    return null;
  }
  if (isTransientHttpError(raw)) {
    return "timeout";
  }
  if (isRateLimitErrorMessage(raw)) {
    return "rate_limit";
  }
  if (isOverloadedErrorMessage(raw)) {
    return "overloaded";
  }
  if (isCloudCodeAssistFormatError(raw)) {
    return "format";
  }
  if (isBillingErrorMessage(raw)) {
    return "billing";
  }
  if (isTimeoutErrorMessage(raw)) {
    return "timeout";
  }
  if (isAuthErrorMessage(raw)) {
    return "auth";
  }
  return null;
}
export function isFailoverErrorMessage(raw) {
  return classifyFailoverReason(raw) !== null;
}
export function isFailoverAssistantError(msg) {
  if (!msg || msg.stopReason !== "error") {
    return false;
  }
  return isFailoverErrorMessage(msg.errorMessage ?? "");
}
