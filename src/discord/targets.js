let safeParseDiscordTarget = function (input, options) {
    try {
      return parseDiscordTarget(input, options);
    } catch {
      return;
    }
  },
  isExplicitUserLookup = function (input, options) {
    if (/^<@!?(\d+)>$/.test(input)) {
      return true;
    }
    if (/^(user:|discord:)/.test(input)) {
      return true;
    }
    if (input.startsWith("@")) {
      return true;
    }
    if (/^\d+$/.test(input)) {
      return options.defaultKind === "user";
    }
    return false;
  },
  isLikelyUsername = function (input) {
    if (/^(user:|channel:|discord:|@|<@!?)|[\d]+$/.test(input)) {
      return false;
    }
    return true;
  };
import {
  buildMessagingTarget,
  ensureTargetId,
  parseTargetMention,
  parseTargetPrefixes,
  requireTargetKind,
} from "../channels/targets.js";
import { listDiscordDirectoryPeersLive } from "./directory-live.js";
export function parseDiscordTarget(raw, options = {}) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }
  const mentionTarget = parseTargetMention({
    raw: trimmed,
    mentionPattern: /^<@!?(\d+)>$/,
    kind: "user",
  });
  if (mentionTarget) {
    return mentionTarget;
  }
  const prefixedTarget = parseTargetPrefixes({
    raw: trimmed,
    prefixes: [
      { prefix: "user:", kind: "user" },
      { prefix: "channel:", kind: "channel" },
      { prefix: "discord:", kind: "user" },
    ],
  });
  if (prefixedTarget) {
    return prefixedTarget;
  }
  if (trimmed.startsWith("@")) {
    const candidate = trimmed.slice(1).trim();
    const id = ensureTargetId({
      candidate,
      pattern: /^\d+$/,
      errorMessage: "Discord DMs require a user id (use user:<id> or a <@id> mention)",
    });
    return buildMessagingTarget("user", id, trimmed);
  }
  if (/^\d+$/.test(trimmed)) {
    if (options.defaultKind) {
      return buildMessagingTarget(options.defaultKind, trimmed, trimmed);
    }
    throw new Error(
      options.ambiguousMessage ??
        `Ambiguous Discord recipient "${trimmed}". Use "user:${trimmed}" for DMs or "channel:${trimmed}" for channel messages.`,
    );
  }
  return buildMessagingTarget("channel", trimmed, trimmed);
}
export function resolveDiscordChannelId(raw) {
  const target = parseDiscordTarget(raw, { defaultKind: "channel" });
  return requireTargetKind({ platform: "Discord", target, kind: "channel" });
}
export async function resolveDiscordTarget(raw, options, parseOptions = {}) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }
  const likelyUsername = isLikelyUsername(trimmed);
  const shouldLookup = isExplicitUserLookup(trimmed, parseOptions) || likelyUsername;
  const directParse = safeParseDiscordTarget(trimmed, parseOptions);
  if (directParse && directParse.kind !== "channel" && !likelyUsername) {
    return directParse;
  }
  if (!shouldLookup) {
    return directParse ?? parseDiscordTarget(trimmed, parseOptions);
  }
  try {
    const directoryEntries = await listDiscordDirectoryPeersLive({
      ...options,
      query: trimmed,
      limit: 1,
    });
    const match = directoryEntries[0];
    if (match && match.kind === "user") {
      const userId = match.id.replace(/^user:/, "");
      return buildMessagingTarget("user", userId, trimmed);
    }
  } catch {}
  return parseDiscordTarget(trimmed, parseOptions);
}
