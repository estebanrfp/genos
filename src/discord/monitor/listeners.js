let logSlowDiscordListener = function (params) {
  if (params.durationMs < DISCORD_SLOW_LISTENER_THRESHOLD_MS) {
    return;
  }
  const duration = formatDurationSeconds(params.durationMs, {
    decimals: 1,
    unit: "seconds",
  });
  const message = `Slow listener detected: ${params.listener} took ${duration} for event ${params.event}`;
  const logger = params.logger ?? discordEventQueueLog;
  logger.warn("Slow listener detected", {
    listener: params.listener,
    event: params.event,
    durationMs: params.durationMs,
    duration,
    consoleMessage: message,
  });
};
import {
  ChannelType,
  MessageCreateListener,
  MessageReactionAddListener,
  MessageReactionRemoveListener,
  PresenceUpdateListener,
} from "@buape/carbon";
import { danger } from "../../globals.js";
import { formatDurationSeconds } from "../../infra/format-time/format-duration.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveAgentRoute } from "../../routing/resolve-route.js";
import {
  normalizeDiscordSlug,
  resolveDiscordChannelConfigWithFallback,
  resolveDiscordGuildEntry,
  shouldEmitDiscordReactionNotification,
} from "./allow-list.js";
import { formatDiscordReactionEmoji, formatDiscordUserTag } from "./format.js";
import { resolveDiscordChannelInfo } from "./message-utils.js";
import { setPresence } from "./presence-cache.js";
const DISCORD_SLOW_LISTENER_THRESHOLD_MS = 30000;
const discordEventQueueLog = createSubsystemLogger("discord/event-queue");
export function registerDiscordListener(listeners, listener) {
  if (listeners.some((existing) => existing.constructor === listener.constructor)) {
    return false;
  }
  listeners.push(listener);
  return true;
}

export class DiscordMessageListener extends MessageCreateListener {
  handler;
  logger;
  constructor(handler, logger) {
    super();
    this.handler = handler;
    this.logger = logger;
  }
  async handle(data, client) {
    const startedAt = Date.now();
    const task = Promise.resolve(this.handler(data, client));
    task
      .catch((err) => {
        const logger = this.logger ?? discordEventQueueLog;
        logger.error(danger(`discord handler failed: ${String(err)}`));
      })
      .finally(() => {
        logSlowDiscordListener({
          logger: this.logger,
          listener: this.constructor.name,
          event: this.type,
          durationMs: Date.now() - startedAt,
        });
      });
  }
}

export class DiscordReactionListener extends MessageReactionAddListener {
  params;
  constructor(params) {
    super();
    this.params = params;
  }
  async handle(data, client) {
    await runDiscordReactionHandler({
      data,
      client,
      action: "added",
      handlerParams: this.params,
      listener: this.constructor.name,
      event: this.type,
    });
  }
}

export class DiscordReactionRemoveListener extends MessageReactionRemoveListener {
  params;
  constructor(params) {
    super();
    this.params = params;
  }
  async handle(data, client) {
    await runDiscordReactionHandler({
      data,
      client,
      action: "removed",
      handlerParams: this.params,
      listener: this.constructor.name,
      event: this.type,
    });
  }
}
async function runDiscordReactionHandler(params) {
  const startedAt = Date.now();
  try {
    await handleDiscordReactionEvent({
      data: params.data,
      client: params.client,
      action: params.action,
      cfg: params.handlerParams.cfg,
      accountId: params.handlerParams.accountId,
      botUserId: params.handlerParams.botUserId,
      guildEntries: params.handlerParams.guildEntries,
      logger: params.handlerParams.logger,
    });
  } finally {
    logSlowDiscordListener({
      logger: params.handlerParams.logger,
      listener: params.listener,
      event: params.event,
      durationMs: Date.now() - startedAt,
    });
  }
}
async function handleDiscordReactionEvent(params) {
  try {
    const { data, client, action, botUserId, guildEntries } = params;
    if (!("user" in data)) {
      return;
    }
    const user = data.user;
    if (!user || user.bot) {
      return;
    }
    if (botUserId && user.id === botUserId) {
      return;
    }
    const isGuildMessage = Boolean(data.guild_id);
    const guildInfo = isGuildMessage
      ? resolveDiscordGuildEntry({
          guild: data.guild ?? undefined,
          guildEntries,
        })
      : null;
    if (isGuildMessage && guildEntries && Object.keys(guildEntries).length > 0 && !guildInfo) {
      return;
    }
    const channel = await client.fetchChannel(data.channel_id);
    if (!channel) {
      return;
    }
    const channelName = "name" in channel ? (channel.name ?? undefined) : undefined;
    const channelSlug = channelName ? normalizeDiscordSlug(channelName) : "";
    const channelType = "type" in channel ? channel.type : undefined;
    const isDirectMessage = channelType === ChannelType.DM;
    const isGroupDm = channelType === ChannelType.GroupDM;
    const isThreadChannel =
      channelType === ChannelType.PublicThread ||
      channelType === ChannelType.PrivateThread ||
      channelType === ChannelType.AnnouncementThread;
    let parentId = "parentId" in channel ? (channel.parentId ?? undefined) : undefined;
    let parentName;
    let parentSlug = "";
    const memberRoleIds = Array.isArray(data.rawMember?.roles)
      ? data.rawMember.roles.map((roleId) => String(roleId))
      : [];
    let reactionBase = null;
    const resolveReactionBase = () => {
      if (reactionBase) {
        return reactionBase;
      }
      const emojiLabel = formatDiscordReactionEmoji(data.emoji);
      const actorLabel = formatDiscordUserTag(user);
      const guildSlug =
        guildInfo?.slug ||
        (data.guild?.name
          ? normalizeDiscordSlug(data.guild.name)
          : (data.guild_id ?? (isGroupDm ? "group-dm" : "dm")));
      const channelLabel = channelSlug
        ? `#${channelSlug}`
        : channelName
          ? `#${normalizeDiscordSlug(channelName)}`
          : `#${data.channel_id}`;
      const baseText = `Discord reaction ${action}: ${emojiLabel} by ${actorLabel} on ${guildSlug} ${channelLabel} msg ${data.message_id}`;
      const contextKey = `discord:reaction:${action}:${data.message_id}:${user.id}:${emojiLabel}`;
      reactionBase = { baseText, contextKey };
      return reactionBase;
    };
    const emitReaction = (text, parentPeerId) => {
      const { contextKey } = resolveReactionBase();
      const route = resolveAgentRoute({
        cfg: params.cfg,
        channel: "discord",
        accountId: params.accountId,
        guildId: data.guild_id ?? undefined,
        memberRoleIds,
        peer: {
          kind: isDirectMessage ? "direct" : isGroupDm ? "group" : "channel",
          id: isDirectMessage ? user.id : data.channel_id,
        },
        parentPeer: parentPeerId ? { kind: "channel", id: parentPeerId } : undefined,
      });
      enqueueSystemEvent(text, {
        sessionKey: route.sessionKey,
        contextKey,
      });
    };
    const shouldNotifyReaction = (options) =>
      shouldEmitDiscordReactionNotification({
        mode: options.mode,
        botId: botUserId,
        messageAuthorId: options.messageAuthorId,
        userId: user.id,
        userName: user.username,
        userTag: formatDiscordUserTag(user),
        allowlist: guildInfo?.users,
      });
    const emitReactionWithAuthor = (message) => {
      const { baseText } = resolveReactionBase();
      const authorLabel = message?.author ? formatDiscordUserTag(message.author) : undefined;
      const text = authorLabel ? `${baseText} from ${authorLabel}` : baseText;
      emitReaction(text, parentId);
    };
    const loadThreadParentInfo = async () => {
      if (!parentId) {
        return;
      }
      const parentInfo = await resolveDiscordChannelInfo(client, parentId);
      parentName = parentInfo?.name;
      parentSlug = parentName ? normalizeDiscordSlug(parentName) : "";
    };
    const resolveThreadChannelConfig = () =>
      resolveDiscordChannelConfigWithFallback({
        guildInfo,
        channelId: data.channel_id,
        channelName,
        channelSlug,
        parentId,
        parentName,
        parentSlug,
        scope: "thread",
      });
    if (isThreadChannel) {
      const reactionMode = guildInfo?.reactionNotifications ?? "own";
      if (reactionMode === "off") {
        return;
      }
      const channelInfoPromise = parentId
        ? Promise.resolve({ parentId })
        : resolveDiscordChannelInfo(client, data.channel_id);
      if (reactionMode === "all" || reactionMode === "allowlist") {
        const channelInfo = await channelInfoPromise;
        parentId = channelInfo?.parentId;
        await loadThreadParentInfo();
        const channelConfig = resolveThreadChannelConfig();
        if (channelConfig?.allowed === false) {
          return;
        }
        if (reactionMode === "allowlist") {
          if (!shouldNotifyReaction({ mode: reactionMode })) {
            return;
          }
        }
        const { baseText } = resolveReactionBase();
        emitReaction(baseText, parentId);
        return;
      }
      const messagePromise = data.message.fetch().catch(() => null);
      const [channelInfo, message] = await Promise.all([channelInfoPromise, messagePromise]);
      parentId = channelInfo?.parentId;
      await loadThreadParentInfo();
      const channelConfig = resolveThreadChannelConfig();
      if (channelConfig?.allowed === false) {
        return;
      }
      const messageAuthorId = message?.author?.id ?? undefined;
      if (!shouldNotifyReaction({ mode: reactionMode, messageAuthorId })) {
        return;
      }
      emitReactionWithAuthor(message);
      return;
    }
    const channelConfig = resolveDiscordChannelConfigWithFallback({
      guildInfo,
      channelId: data.channel_id,
      channelName,
      channelSlug,
      parentId,
      parentName,
      parentSlug,
      scope: "channel",
    });
    if (channelConfig?.allowed === false) {
      return;
    }
    const reactionMode = guildInfo?.reactionNotifications ?? "own";
    if (reactionMode === "off") {
      return;
    }
    if (reactionMode === "all" || reactionMode === "allowlist") {
      if (reactionMode === "allowlist") {
        if (!shouldNotifyReaction({ mode: reactionMode })) {
          return;
        }
      }
      const { baseText } = resolveReactionBase();
      emitReaction(baseText, parentId);
      return;
    }
    const message = await data.message.fetch().catch(() => null);
    const messageAuthorId = message?.author?.id ?? undefined;
    if (!shouldNotifyReaction({ mode: reactionMode, messageAuthorId })) {
      return;
    }
    emitReactionWithAuthor(message);
  } catch (err) {
    params.logger.error(danger(`discord reaction handler failed: ${String(err)}`));
  }
}

export class DiscordPresenceListener extends PresenceUpdateListener {
  logger;
  accountId;
  constructor(params) {
    super();
    this.logger = params.logger;
    this.accountId = params.accountId;
  }
  async handle(data) {
    try {
      const userId =
        "user" in data && data.user && typeof data.user === "object" && "id" in data.user
          ? String(data.user.id)
          : undefined;
      if (!userId) {
        return;
      }
      setPresence(this.accountId, userId, data);
    } catch (err) {
      const logger = this.logger ?? discordEventQueueLog;
      logger.error(danger(`discord presence handler failed: ${String(err)}`));
    }
  }
}
