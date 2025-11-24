export function normalizeMSTeamsConversationId(raw) {
  return raw.split(";")[0] ?? raw;
}
export function extractMSTeamsConversationMessageId(raw) {
  if (!raw) {
    return;
  }
  const match = /(?:^|;)messageid=([^;]+)/i.exec(raw);
  const value = match?.[1]?.trim() ?? "";
  return value || undefined;
}
export function parseMSTeamsActivityTimestamp(value) {
  if (!value) {
    return;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== "string") {
    return;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
export function stripMSTeamsMentionTags(text) {
  return text.replace(/<at[^>]*>.*?<\/at>/gi, "").trim();
}
export function wasMSTeamsBotMentioned(activity) {
  const botId = activity.recipient?.id;
  if (!botId) {
    return false;
  }
  const entities = activity.entities ?? [];
  return entities.some((e) => e.type === "mention" && e.mentioned?.id === botId);
}
