let getChatKey = function (chatId) {
    return String(chatId);
  },
  cleanupExpired = function (entry) {
    const now = Date.now();
    for (const [msgId, timestamp] of entry.timestamps) {
      if (now - timestamp > TTL_MS) {
        entry.messageIds.delete(msgId);
        entry.timestamps.delete(msgId);
      }
    }
  };
const TTL_MS = 86400000;
const sentMessages = new Map();
export function recordSentMessage(chatId, messageId) {
  const key = getChatKey(chatId);
  let entry = sentMessages.get(key);
  if (!entry) {
    entry = { messageIds: new Set(), timestamps: new Map() };
    sentMessages.set(key, entry);
  }
  entry.messageIds.add(messageId);
  entry.timestamps.set(messageId, Date.now());
  if (entry.messageIds.size > 100) {
    cleanupExpired(entry);
  }
}
export function wasSentByBot(chatId, messageId) {
  const key = getChatKey(chatId);
  const entry = sentMessages.get(key);
  if (!entry) {
    return false;
  }
  cleanupExpired(entry);
  return entry.messageIds.has(messageId);
}
export function clearSentMessageCache() {
  sentMessages.clear();
}
