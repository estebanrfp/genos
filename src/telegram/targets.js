let resolveTelegramChatType = function (chatId) {
  const trimmed = chatId.trim();
  if (!trimmed) {
    return "unknown";
  }
  if (/^-?\d+$/.test(trimmed)) {
    return trimmed.startsWith("-") ? "group" : "direct";
  }
  return "unknown";
};
export function stripTelegramInternalPrefixes(to) {
  let trimmed = to.trim();
  let strippedTelegramPrefix = false;
  while (true) {
    const next = (() => {
      if (/^(telegram|tg):/i.test(trimmed)) {
        strippedTelegramPrefix = true;
        return trimmed.replace(/^(telegram|tg):/i, "").trim();
      }
      if (strippedTelegramPrefix && /^group:/i.test(trimmed)) {
        return trimmed.replace(/^group:/i, "").trim();
      }
      return trimmed;
    })();
    if (next === trimmed) {
      return trimmed;
    }
    trimmed = next;
  }
}
export function parseTelegramTarget(to) {
  const normalized = stripTelegramInternalPrefixes(to);
  const topicMatch = /^(.+?):topic:(\d+)$/.exec(normalized);
  if (topicMatch) {
    return {
      chatId: topicMatch[1],
      messageThreadId: Number.parseInt(topicMatch[2], 10),
      chatType: resolveTelegramChatType(topicMatch[1]),
    };
  }
  const colonMatch = /^(.+):(\d+)$/.exec(normalized);
  if (colonMatch) {
    return {
      chatId: colonMatch[1],
      messageThreadId: Number.parseInt(colonMatch[2], 10),
      chatType: resolveTelegramChatType(colonMatch[1]),
    };
  }
  return {
    chatId: normalized,
    chatType: resolveTelegramChatType(normalized),
  };
}
export function resolveTelegramTargetChatType(target) {
  return parseTelegramTarget(target).chatType;
}
