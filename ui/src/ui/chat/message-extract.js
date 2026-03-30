import { stripEnvelope } from "../../../../src/shared/chat-envelope.js";
import { stripThinkingTags } from "../format.js";

// Strip [[reply_to_current]] and [[reply_to:<id>]] tags from assistant output.
const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]\s*/gi;
const stripReplyTags = (text) => text.replace(REPLY_TAG_RE, "");

/** Strip A2A stop tokens (REPLY_SKIP / ANNOUNCE_SKIP) from assistant output. */
const A2A_STOP_TOKEN_RE = /\s*\b(?:REPLY_SKIP|ANNOUNCE_SKIP)\s*$/;
const stripA2AStopTokens = (text) => text.replace(A2A_STOP_TOKEN_RE, "").trim();

/** Check if raw text contains an A2A stop token. */
export const containsA2AStopToken = (text) => A2A_STOP_TOKEN_RE.test(text ?? "");
const textCache = new WeakMap();
const thinkingCache = new WeakMap();

/** Strip all "(untrusted metadata/context)" blocks + JSON code fences from stored user messages. */
const UNTRUSTED_META_BLOCK_RE =
  /(?:Conversation info|Sender|Thread starter|Replied message|Forwarded message context|Chat history since last reply) \(untrusted[^)]*\):\n```json\n[\s\S]*?\n```\s*/g;

/** Match "System: [YYYY-MM-DD HH:MM... TZ] message" notification lines injected by the gateway. */
const SYSTEM_NOTIFICATION_RE = /System: \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s*([^\n]*)\n*/g;

const cleanUserText = (text) => {
  let cleaned = stripA2AStopTokens(text.replace(UNTRUSTED_META_BLOCK_RE, "")).trim();
  const systemLines = [];
  cleaned = cleaned
    .replace(SYSTEM_NOTIFICATION_RE, (_, msg) => {
      const trimmed = msg.trim();
      if (trimmed) {
        systemLines.push(trimmed);
      }
      return "";
    })
    .trim();
  cleaned = stripEnvelope(cleaned);
  // System notifications are now rendered as tool-card-style lines
  // (via extractSystemNotifications) — no longer converted to blockquotes.
  return cleaned.trim();
};

export function extractText(message) {
  const m = message;
  const role = typeof m.role === "string" ? m.role : "";
  const content = m.content;
  if (typeof content === "string") {
    const processed =
      role === "assistant"
        ? stripA2AStopTokens(stripReplyTags(stripThinkingTags(content)))
        : cleanUserText(content);
    return processed;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter((v) => typeof v === "string");
    if (parts.length > 0) {
      const joined = parts.join("\n");
      const processed =
        role === "assistant"
          ? stripA2AStopTokens(stripReplyTags(stripThinkingTags(joined)))
          : cleanUserText(joined);
      return processed;
    }
  }
  if (typeof m.text === "string") {
    const processed =
      role === "assistant"
        ? stripA2AStopTokens(stripReplyTags(stripThinkingTags(m.text)))
        : cleanUserText(m.text);
    return processed;
  }
  return null;
}
const systemNotifCache = new WeakMap();

/**
 * Extract system notification lines from a user message (e.g. "WhatsApp gateway connected").
 * @param {object} message
 * @returns {string[]}
 */
export function extractSystemNotifications(message) {
  if (!message || typeof message !== "object") {
    return [];
  }
  if (systemNotifCache.has(message)) {
    return systemNotifCache.get(message);
  }
  const role = typeof message.role === "string" ? message.role : "";
  if (role === "assistant") {
    systemNotifCache.set(message, []);
    return [];
  }
  const raw =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter((p) => p?.type === "text")
            .map((p) => p.text)
            .join("\n")
        : (message.text ?? "");
  const lines = [];
  const re = new RegExp(SYSTEM_NOTIFICATION_RE.source, "g");
  let match;
  while ((match = re.exec(raw)) !== null) {
    const trimmed = match[1]?.trim();
    if (trimmed) {
      lines.push(trimmed);
    }
  }
  systemNotifCache.set(message, lines);
  return lines;
}

export function extractTextCached(message) {
  if (!message || typeof message !== "object") {
    return extractText(message);
  }
  const obj = message;
  if (textCache.has(obj)) {
    return textCache.get(obj) ?? null;
  }
  const value = extractText(message);
  textCache.set(obj, value);
  return value;
}
export function extractThinking(message) {
  const m = message;
  const content = m.content;
  const parts = [];
  if (Array.isArray(content)) {
    for (const p of content) {
      const item = p;
      if (item.type === "thinking" && typeof item.thinking === "string") {
        const cleaned = item.thinking.trim();
        if (cleaned) {
          parts.push(cleaned);
        }
      }
    }
  }
  if (parts.length > 0) {
    return parts.join("\n");
  }
  const rawText = extractRawText(message);
  if (!rawText) {
    return null;
  }
  const matches = [
    ...rawText.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi),
  ];
  const extracted = matches.map((m) => (m[1] ?? "").trim()).filter(Boolean);
  return extracted.length > 0 ? extracted.join("\n") : null;
}
export function extractThinkingCached(message) {
  if (!message || typeof message !== "object") {
    return extractThinking(message);
  }
  const obj = message;
  if (thinkingCache.has(obj)) {
    return thinkingCache.get(obj) ?? null;
  }
  const value = extractThinking(message);
  thinkingCache.set(obj, value);
  return value;
}
export function extractRawText(message) {
  const m = message;
  const content = m.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter((v) => typeof v === "string");
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (typeof m.text === "string") {
    return m.text;
  }
  return null;
}
export function formatReasoningMarkdown(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `_${line}_`);
  return lines.length ? ["_Reasoning:_", ...lines].join("\n") : "";
}
