import { parseAgentSessionKey } from "./session-key-utils.js";
let normalizeMatchValue = function (raw) {
    const value = raw?.trim().toLowerCase();
    return value ? value : undefined;
  },
  stripAgentSessionKeyPrefix = function (key) {
    if (!key) {
      return;
    }
    return parseAgentSessionKey(key)?.rest ?? key;
  },
  deriveChannelFromKey = function (key) {
    const normalizedKey = stripAgentSessionKeyPrefix(key);
    if (!normalizedKey) {
      return;
    }
    const parts = normalizedKey.split(":").filter(Boolean);
    if (parts.length >= 3 && (parts[1] === "group" || parts[1] === "channel")) {
      return normalizeMatchValue(parts[0]);
    }
    return;
  },
  deriveChatTypeFromKey = function (key) {
    const normalizedKey = stripAgentSessionKeyPrefix(key);
    if (!normalizedKey) {
      return;
    }
    if (normalizedKey.includes(":group:")) {
      return "group";
    }
    if (normalizedKey.includes(":channel:")) {
      return "channel";
    }
    return;
  };
import { normalizeChatType } from "../channels/chat-type.js";
export function normalizeSendPolicy(raw) {
  const value = raw?.trim().toLowerCase();
  if (value === "allow") {
    return "allow";
  }
  if (value === "deny") {
    return "deny";
  }
  return;
}
export function resolveSendPolicy(params) {
  const override = normalizeSendPolicy(params.entry?.sendPolicy);
  if (override) {
    return override;
  }
  const policy = params.cfg.session?.sendPolicy;
  if (!policy) {
    return "allow";
  }
  const channel =
    normalizeMatchValue(params.channel) ??
    normalizeMatchValue(params.entry?.channel) ??
    normalizeMatchValue(params.entry?.lastChannel) ??
    deriveChannelFromKey(params.sessionKey);
  const chatType =
    normalizeChatType(params.chatType ?? params.entry?.chatType) ??
    normalizeChatType(deriveChatTypeFromKey(params.sessionKey));
  const rawSessionKey = params.sessionKey ?? "";
  const strippedSessionKey = stripAgentSessionKeyPrefix(rawSessionKey) ?? "";
  const rawSessionKeyNorm = rawSessionKey.toLowerCase();
  const strippedSessionKeyNorm = strippedSessionKey.toLowerCase();
  let allowedMatch = false;
  for (const rule of policy.rules ?? []) {
    if (!rule) {
      continue;
    }
    const action = normalizeSendPolicy(rule.action) ?? "allow";
    const match = rule.match ?? {};
    const matchChannel = normalizeMatchValue(match.channel);
    const matchChatType = normalizeChatType(match.chatType);
    const matchPrefix = normalizeMatchValue(match.keyPrefix);
    const matchRawPrefix = normalizeMatchValue(match.rawKeyPrefix);
    if (matchChannel && matchChannel !== channel) {
      continue;
    }
    if (matchChatType && matchChatType !== chatType) {
      continue;
    }
    if (matchRawPrefix && !rawSessionKeyNorm.startsWith(matchRawPrefix)) {
      continue;
    }
    if (
      matchPrefix &&
      !rawSessionKeyNorm.startsWith(matchPrefix) &&
      !strippedSessionKeyNorm.startsWith(matchPrefix)
    ) {
      continue;
    }
    if (action === "deny") {
      return "deny";
    }
    allowedMatch = true;
  }
  if (allowedMatch) {
    return "allow";
  }
  const fallback = normalizeSendPolicy(policy.default);
  return fallback ?? "allow";
}
