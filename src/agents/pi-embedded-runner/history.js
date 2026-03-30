import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
let stripThreadSuffix = function (value) {
  const match = value.match(THREAD_SUFFIX_REGEX);
  return match?.[1] ?? value;
};
const THREAD_SUFFIX_REGEX = /^(.*)(?::(?:thread|topic):\d+)$/i;
export function limitHistoryTurns(messages, limit) {
  if (!limit || limit <= 0 || messages.length === 0) {
    return messages;
  }
  let userCount = 0;
  let lastUserIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount++;
      if (userCount > limit) {
        const kept = messages.slice(lastUserIndex);
        const dropped = messages.length - kept.length;
        if (dropped > 0) {
          const notice = {
            role: "user",
            content: `[System: ${dropped} earlier messages from this conversation were truncated to save context. Ask the user if you need information from earlier in the conversation.]`,
            timestamp: Date.now(),
          };
          return [notice, ...kept];
        }
        return kept;
      }
      lastUserIndex = i;
    }
  }
  return messages;
}
export function getHistoryLimitFromSessionKey(sessionKey, config) {
  if (!sessionKey || !config) {
    return;
  }
  const parsed = parseAgentSessionKey(sessionKey);
  const providerParts = (parsed?.rest ?? sessionKey).split(":").filter(Boolean);
  const provider = providerParts[0]?.toLowerCase();
  if (!provider) {
    return;
  }
  const kind = providerParts[1]?.toLowerCase();
  const userIdRaw = providerParts.slice(2).join(":");
  const userId = stripThreadSuffix(userIdRaw);
  const resolveProviderConfig = (cfg, providerId) => {
    const channels = cfg?.channels;
    if (!channels || typeof channels !== "object") {
      return;
    }
    const entry = channels[providerId];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    return entry;
  };
  const providerConfig = resolveProviderConfig(config, provider);
  const resolveWithGlobalFallback = (channelLimit) => {
    if (channelLimit !== undefined) {
      return channelLimit;
    }
    const globalLimit = config?.agents?.defaults?.historyLimit;
    if (typeof globalLimit === "number" && globalLimit > 0) {
      return globalLimit;
    }
    return;
  };
  if (!providerConfig) {
    return resolveWithGlobalFallback(undefined);
  }
  if (kind === "dm" || kind === "direct") {
    if (userId && providerConfig.dms?.[userId]?.historyLimit !== undefined) {
      return providerConfig.dms[userId].historyLimit;
    }
    return resolveWithGlobalFallback(providerConfig.dmHistoryLimit);
  }
  if (kind === "channel" || kind === "group") {
    return resolveWithGlobalFallback(providerConfig.historyLimit);
  }
  return resolveWithGlobalFallback(undefined);
}
export const getDmHistoryLimitFromSessionKey = getHistoryLimitFromSessionKey;
