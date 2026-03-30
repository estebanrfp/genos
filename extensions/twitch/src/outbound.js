import { DEFAULT_ACCOUNT_ID, getAccountConfig } from "./config.js";
import { sendMessageTwitchInternal } from "./send.js";
import { chunkTextForTwitch } from "./utils/markdown.js";
import { missingTargetError, normalizeTwitchChannel } from "./utils/twitch.js";
export const twitchOutbound = {
  deliveryMode: "direct",
  textChunkLimit: 500,
  chunker: chunkTextForTwitch,
  resolveTarget: ({ to, allowFrom, mode }) => {
    const trimmed = to?.trim() ?? "";
    const allowListRaw = (allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
    const hasWildcard = allowListRaw.includes("*");
    const allowList = allowListRaw
      .filter((entry) => entry !== "*")
      .map((entry) => normalizeTwitchChannel(entry))
      .filter((entry) => entry.length > 0);
    if (trimmed) {
      const normalizedTo = normalizeTwitchChannel(trimmed);
      if (!normalizedTo) {
        return {
          ok: false,
          error: missingTargetError("Twitch", "<channel-name>"),
        };
      }
      if (mode === "implicit" || mode === "heartbeat") {
        if (hasWildcard || allowList.length === 0) {
          return { ok: true, to: normalizedTo };
        }
        if (allowList.includes(normalizedTo)) {
          return { ok: true, to: normalizedTo };
        }
        return {
          ok: false,
          error: missingTargetError("Twitch", "<channel-name>"),
        };
      }
      return { ok: true, to: normalizedTo };
    }
    return {
      ok: false,
      error: missingTargetError("Twitch", "<channel-name>"),
    };
  },
  sendText: async (params) => {
    const { cfg, to, text, accountId } = params;
    const signal = params.signal;
    if (signal?.aborted) {
      throw new Error("Outbound delivery aborted");
    }
    const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
    const account = getAccountConfig(cfg, resolvedAccountId);
    if (!account) {
      const availableIds = Object.keys(cfg.channels?.twitch?.accounts ?? {});
      throw new Error(
        `Twitch account not found: ${resolvedAccountId}. ` +
          `Available accounts: ${availableIds.join(", ") || "none"}`,
      );
    }
    const channel = to || account.channel;
    if (!channel) {
      throw new Error("No channel specified and no default channel in account config");
    }
    const result = await sendMessageTwitchInternal(
      normalizeTwitchChannel(channel),
      text,
      cfg,
      resolvedAccountId,
      true,
      console,
    );
    if (!result.ok) {
      throw new Error(result.error ?? "Send failed");
    }
    return {
      channel: "twitch",
      messageId: result.messageId,
      timestamp: Date.now(),
    };
  },
  sendMedia: async (params) => {
    const { text, mediaUrl } = params;
    const signal = params.signal;
    if (signal?.aborted) {
      throw new Error("Outbound delivery aborted");
    }
    const message = mediaUrl ? `${text || ""} ${mediaUrl}`.trim() : text;
    if (!twitchOutbound.sendText) {
      throw new Error("sendText not implemented");
    }
    return twitchOutbound.sendText({
      ...params,
      text: message,
    });
  },
};
