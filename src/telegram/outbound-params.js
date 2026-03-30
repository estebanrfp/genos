export function parseTelegramReplyToMessageId(replyToId) {
  if (!replyToId) {
    return;
  }
  const parsed = Number.parseInt(replyToId, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function parseTelegramThreadId(threadId) {
  if (threadId == null) {
    return;
  }
  if (typeof threadId === "number") {
    return Number.isFinite(threadId) ? Math.trunc(threadId) : undefined;
  }
  const trimmed = threadId.trim();
  if (!trimmed) {
    return;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
