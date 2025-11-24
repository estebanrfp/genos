let extractConversationId = function (from) {
    const trimmed = from?.trim();
    if (!trimmed) {
      return;
    }
    const parts = trimmed.split(":").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : trimmed;
  },
  shouldAppendId = function (id) {
    if (/^[0-9]+$/.test(id)) {
      return true;
    }
    if (id.includes("@g.us")) {
      return true;
    }
    return false;
  };
import { normalizeChatType } from "./chat-type.js";
export function resolveConversationLabel(ctx) {
  const explicit = ctx.ConversationLabel?.trim();
  if (explicit) {
    return explicit;
  }
  const threadLabel = ctx.ThreadLabel?.trim();
  if (threadLabel) {
    return threadLabel;
  }
  const chatType = normalizeChatType(ctx.ChatType);
  if (chatType === "direct") {
    return ctx.SenderName?.trim() || ctx.From?.trim() || undefined;
  }
  const base =
    ctx.GroupChannel?.trim() ||
    ctx.GroupSubject?.trim() ||
    ctx.GroupSpace?.trim() ||
    ctx.From?.trim() ||
    "";
  if (!base) {
    return;
  }
  const id = extractConversationId(ctx.From);
  if (!id) {
    return base;
  }
  if (!shouldAppendId(id)) {
    return base;
  }
  if (base === id) {
    return base;
  }
  if (base.includes(id)) {
    return base;
  }
  if (base.toLowerCase().includes(" id:")) {
    return base;
  }
  if (base.startsWith("#") || base.startsWith("@")) {
    return base;
  }
  return `${base} id:${id}`;
}
