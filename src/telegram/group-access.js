import { isSenderAllowed } from "./bot-access.js";
import { firstDefined } from "./bot-access.js";
export const evaluateTelegramGroupBaseAccess = (params) => {
  if (!params.isGroup) {
    return { allowed: true };
  }
  if (params.groupConfig?.enabled === false) {
    return { allowed: false, reason: "group-disabled" };
  }
  if (params.topicConfig?.enabled === false) {
    return { allowed: false, reason: "topic-disabled" };
  }
  if (!params.enforceAllowOverride || !params.hasGroupAllowOverride) {
    return { allowed: true };
  }
  const senderId = params.senderId ?? "";
  if (params.requireSenderForAllowOverride && !senderId) {
    return { allowed: false, reason: "group-override-unauthorized" };
  }
  const allowed = isSenderAllowed({
    allow: params.effectiveGroupAllow,
    senderId,
    senderUsername: params.senderUsername ?? "",
  });
  if (!allowed) {
    return { allowed: false, reason: "group-override-unauthorized" };
  }
  return { allowed: true };
};
export const evaluateTelegramGroupPolicyAccess = (params) => {
  const fallbackPolicy =
    firstDefined(
      params.telegramCfg.groupPolicy,
      params.cfg.channels?.defaults?.groupPolicy,
      "open",
    ) ?? "open";
  const groupPolicy = params.useTopicAndGroupOverrides
    ? (firstDefined(
        params.topicConfig?.groupPolicy,
        params.groupConfig?.groupPolicy,
        params.telegramCfg.groupPolicy,
        params.cfg.channels?.defaults?.groupPolicy,
        "open",
      ) ?? "open")
    : fallbackPolicy;
  if (!params.isGroup || !params.enforcePolicy) {
    return { allowed: true, groupPolicy };
  }
  if (groupPolicy === "disabled") {
    return { allowed: false, reason: "group-policy-disabled", groupPolicy };
  }
  if (groupPolicy === "allowlist" && params.enforceAllowlistAuthorization) {
    const senderId = params.senderId ?? "";
    if (params.requireSenderForAllowlistAuthorization && !senderId) {
      return { allowed: false, reason: "group-policy-allowlist-no-sender", groupPolicy };
    }
    if (!params.allowEmptyAllowlistEntries && !params.effectiveGroupAllow.hasEntries) {
      return { allowed: false, reason: "group-policy-allowlist-empty", groupPolicy };
    }
    const senderUsername = params.senderUsername ?? "";
    if (
      !isSenderAllowed({
        allow: params.effectiveGroupAllow,
        senderId,
        senderUsername,
      })
    ) {
      return { allowed: false, reason: "group-policy-allowlist-unauthorized", groupPolicy };
    }
  }
  if (params.checkChatAllowlist) {
    const groupAllowlist = params.resolveGroupPolicy(params.chatId);
    if (groupAllowlist.allowlistEnabled && !groupAllowlist.allowed) {
      return { allowed: false, reason: "group-chat-not-allowed", groupPolicy };
    }
  }
  return { allowed: true, groupPolicy };
};
