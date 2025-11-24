let normalizeTextField = function (value) {
    if (typeof value !== "string") {
      return;
    }
    return normalizeInboundTextNewlines(value);
  },
  normalizeMediaType = function (value) {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  countMediaEntries = function (ctx) {
    const pathCount = Array.isArray(ctx.MediaPaths) ? ctx.MediaPaths.length : 0;
    const urlCount = Array.isArray(ctx.MediaUrls) ? ctx.MediaUrls.length : 0;
    const single = ctx.MediaPath || ctx.MediaUrl ? 1 : 0;
    return Math.max(pathCount, urlCount, single);
  };
import { normalizeChatType } from "../../channels/chat-type.js";
import { resolveConversationLabel } from "../../channels/conversation-label.js";
import { normalizeInboundTextNewlines } from "./inbound-text.js";
const DEFAULT_MEDIA_TYPE = "application/octet-stream";
export function finalizeInboundContext(ctx, opts = {}) {
  const normalized = ctx;
  normalized.Body = normalizeInboundTextNewlines(
    typeof normalized.Body === "string" ? normalized.Body : "",
  );
  normalized.RawBody = normalizeTextField(normalized.RawBody);
  normalized.CommandBody = normalizeTextField(normalized.CommandBody);
  normalized.Transcript = normalizeTextField(normalized.Transcript);
  normalized.ThreadStarterBody = normalizeTextField(normalized.ThreadStarterBody);
  normalized.ThreadHistoryBody = normalizeTextField(normalized.ThreadHistoryBody);
  if (Array.isArray(normalized.UntrustedContext)) {
    const normalizedUntrusted = normalized.UntrustedContext.map((entry) =>
      normalizeInboundTextNewlines(entry),
    ).filter((entry) => Boolean(entry));
    normalized.UntrustedContext = normalizedUntrusted;
  }
  const chatType = normalizeChatType(normalized.ChatType);
  if (chatType && (opts.forceChatType || normalized.ChatType !== chatType)) {
    normalized.ChatType = chatType;
  }
  const bodyForAgentSource = opts.forceBodyForAgent
    ? normalized.Body
    : (normalized.BodyForAgent ?? normalized.CommandBody ?? normalized.RawBody ?? normalized.Body);
  normalized.BodyForAgent = normalizeInboundTextNewlines(bodyForAgentSource);
  const bodyForCommandsSource = opts.forceBodyForCommands
    ? (normalized.CommandBody ?? normalized.RawBody ?? normalized.Body)
    : (normalized.BodyForCommands ??
      normalized.CommandBody ??
      normalized.RawBody ??
      normalized.Body);
  normalized.BodyForCommands = normalizeInboundTextNewlines(bodyForCommandsSource);
  const explicitLabel = normalized.ConversationLabel?.trim();
  if (opts.forceConversationLabel || !explicitLabel) {
    const resolved = resolveConversationLabel(normalized)?.trim();
    if (resolved) {
      normalized.ConversationLabel = resolved;
    }
  } else {
    normalized.ConversationLabel = explicitLabel;
  }
  normalized.CommandAuthorized = normalized.CommandAuthorized === true;
  const mediaCount = countMediaEntries(normalized);
  if (mediaCount > 0) {
    const mediaType = normalizeMediaType(normalized.MediaType);
    const rawMediaTypes = Array.isArray(normalized.MediaTypes) ? normalized.MediaTypes : undefined;
    const normalizedMediaTypes = rawMediaTypes?.map((entry) => normalizeMediaType(entry));
    let mediaTypesFinal;
    if (normalizedMediaTypes && normalizedMediaTypes.length > 0) {
      const filled = normalizedMediaTypes.slice();
      while (filled.length < mediaCount) {
        filled.push(undefined);
      }
      mediaTypesFinal = filled.map((entry) => entry ?? DEFAULT_MEDIA_TYPE);
    } else if (mediaType) {
      mediaTypesFinal = [mediaType];
      while (mediaTypesFinal.length < mediaCount) {
        mediaTypesFinal.push(DEFAULT_MEDIA_TYPE);
      }
    } else {
      mediaTypesFinal = Array.from({ length: mediaCount }, () => DEFAULT_MEDIA_TYPE);
    }
    normalized.MediaTypes = mediaTypesFinal;
    normalized.MediaType = mediaType ?? mediaTypesFinal[0] ?? DEFAULT_MEDIA_TYPE;
  }
  return normalized;
}
