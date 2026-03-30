import {
  getChannelPlugin,
  normalizeChannelId as normalizeAnyChannelId,
} from "../../channels/plugins/index.js";
import { normalizeChannelId as normalizeChatChannelId } from "../../channels/registry.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { listAgentEntries, resolveAgentConfig } from "../agent-scope.js";
const ANNOUNCE_SKIP_TOKEN = "ANNOUNCE_SKIP";
const REPLY_SKIP_TOKEN = "REPLY_SKIP";
const DEFAULT_PING_PONG_TURNS = 2;
const MAX_PING_PONG_TURNS = 5;
/**
 * Resolve agent display name from config, falling back to agentId.
 * @param {object} cfg - Gateway config
 * @param {string} agentId - Agent identifier
 * @returns {string}
 */
export function resolveAgentDisplayName(cfg, agentId) {
  const entry = resolveAgentConfig(cfg, agentId);
  return entry?.name?.trim() || agentId;
}
/**
 * Resolve agentId from a name-or-id input. Tries exact ID match first,
 * then falls back to matching agents.list[].name (case-insensitive).
 * @param {object} cfg - Gateway config
 * @param {string} input - Agent ID or display name
 * @returns {string} Resolved agent ID (normalized)
 */
export function resolveAgentIdByNameOrId(cfg, input) {
  const normalized = normalizeAgentId(input);
  const byId = resolveAgentConfig(cfg, normalized);
  if (byId) {
    return normalized;
  }
  const byName = listAgentEntries(cfg).find((a) => a.name?.trim().toLowerCase() === normalized);
  return byName?.id ? normalizeAgentId(byName.id) : normalized;
}
export function resolveAnnounceTargetFromKey(sessionKey) {
  const parsed = parseAgentSessionKey(sessionKey);
  const parts = (parsed?.rest ?? sessionKey).split(":").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }
  const [channelRaw, kind, ...rest] = parts;
  if (kind !== "group" && kind !== "channel") {
    return null;
  }
  let threadId;
  const restJoined = rest.join(":");
  const topicMatch = restJoined.match(/:topic:(\d+)$/);
  const threadMatch = restJoined.match(/:thread:(\d+)$/);
  const match = topicMatch || threadMatch;
  if (match) {
    threadId = match[1];
  }
  const id = match ? restJoined.replace(/:(topic|thread):\d+$/, "") : restJoined.trim();
  if (!id) {
    return null;
  }
  if (!channelRaw) {
    return null;
  }
  const normalizedChannel = normalizeAnyChannelId(channelRaw) ?? normalizeChatChannelId(channelRaw);
  const channel = normalizedChannel ?? channelRaw.toLowerCase();
  const kindTarget = (() => {
    if (!normalizedChannel) {
      return id;
    }
    if (normalizedChannel === "discord" || normalizedChannel === "slack") {
      return `channel:${id}`;
    }
    return kind === "channel" ? `channel:${id}` : `group:${id}`;
  })();
  const normalized = normalizedChannel
    ? getChannelPlugin(normalizedChannel)?.messaging?.normalizeTarget?.(kindTarget)
    : undefined;
  return {
    channel,
    to: normalized ?? kindTarget,
    threadId,
  };
}
export function buildAgentToAgentMessageContext(params) {
  const sender = params.senderAgentId ?? "unknown";
  const receiver = params.receiverAgentId ?? "unknown";
  const lines = [
    "=== AGENT-TO-AGENT MESSAGE ===",
    `This message is from agent "${sender}", NOT from your human user.`,
    `You are agent "${receiver}". Address your reply to agent "${sender}".`,
    `Do NOT greet or address your human user in this reply.`,
    params.requesterSessionKey ? `Sender session: ${params.requesterSessionKey}.` : undefined,
    `Your session: ${params.targetSessionKey}.`,
  ].filter(Boolean);
  return lines.join("\n");
}
export function buildAgentToAgentReplyContext(params) {
  const senderAgent = params.senderAgentId ?? "unknown";
  const receiverAgent = params.receiverAgentId ?? "unknown";
  const lines = [
    "=== AGENT-TO-AGENT EXCHANGE ===",
    `The message below is from agent "${senderAgent}". You are agent "${receiverAgent}".`,
    `Turn ${params.turn} of ${params.maxTurns}.`,
    `Your reply goes to agent "${senderAgent}" — NOT to your human user.`,
    `Do NOT address or greet your human user in this reply.`,
    params.requesterSessionKey ? `Requester session: ${params.requesterSessionKey}.` : undefined,
    `Target session: ${params.targetSessionKey}.`,
    `Reply exactly "${REPLY_SKIP_TOKEN}" if this is a farewell, acknowledgment, or needs no follow-up.`,
  ].filter(Boolean);
  return lines.join("\n");
}
export function buildAgentToAgentAnnounceContext(params) {
  const sender = params.senderAgentId ?? "unknown";
  const receiver = params.receiverAgentId ?? "unknown";
  const lines = [
    "=== AGENT-TO-AGENT ANNOUNCE ===",
    `You are agent "${receiver}". The exchange was with agent "${sender}".`,
    `This is NOT a conversation with your human user.`,
    `Original request from "${sender}": ${params.originalMessage}`,
    params.roundOneReply
      ? `Your first reply: ${params.roundOneReply}`
      : "Your first reply: (not available).",
    params.latestReply ? `Latest reply: ${params.latestReply}` : "Latest reply: (not available).",
    `If you want to remain silent, reply exactly "${ANNOUNCE_SKIP_TOKEN}".`,
    "Any other reply will be posted to your channel as a summary.",
    "After this reply, the agent-to-agent conversation is over.",
  ].filter(Boolean);
  return lines.join("\n");
}
export function isAnnounceSkip(text) {
  return (text ?? "").trim() === ANNOUNCE_SKIP_TOKEN;
}
export function isReplySkip(text) {
  return (text ?? "").trim() === REPLY_SKIP_TOKEN;
}
export function resolvePingPongTurns(cfg) {
  const raw = cfg?.session?.agentToAgent?.maxPingPongTurns;
  const fallback = DEFAULT_PING_PONG_TURNS;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const rounded = Math.floor(raw);
  return Math.max(0, Math.min(MAX_PING_PONG_TURNS, rounded));
}
