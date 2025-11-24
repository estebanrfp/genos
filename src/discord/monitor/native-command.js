let buildDiscordCommandOptions = function (params) {
    const { command, cfg } = params;
    const args = command.args;
    if (!args || args.length === 0) {
      return;
    }
    return args.map((arg) => {
      const required = arg.required ?? false;
      if (arg.type === "number") {
        return {
          name: arg.name,
          description: arg.description,
          type: ApplicationCommandOptionType.Number,
          required,
        };
      }
      if (arg.type === "boolean") {
        return {
          name: arg.name,
          description: arg.description,
          type: ApplicationCommandOptionType.Boolean,
          required,
        };
      }
      const resolvedChoices = resolveCommandArgChoices({ command, arg, cfg });
      const shouldAutocomplete =
        resolvedChoices.length > 0 &&
        (typeof arg.choices === "function" || resolvedChoices.length > 25);
      const autocomplete = shouldAutocomplete
        ? async (interaction) => {
            const focused = interaction.options.getFocused();
            const focusValue =
              typeof focused?.value === "string" ? focused.value.trim().toLowerCase() : "";
            const choices = resolveCommandArgChoices({ command, arg, cfg });
            const filtered = focusValue
              ? choices.filter((choice) => choice.label.toLowerCase().includes(focusValue))
              : choices;
            await interaction.respond(
              filtered.slice(0, 25).map((choice) => ({ name: choice.label, value: choice.value })),
            );
          }
        : undefined;
      const choices =
        resolvedChoices.length > 0 && !autocomplete
          ? resolvedChoices
              .slice(0, 25)
              .map((choice) => ({ name: choice.label, value: choice.value }))
          : undefined;
      return {
        name: arg.name,
        description: arg.description,
        type: ApplicationCommandOptionType.String,
        required,
        choices,
        autocomplete,
      };
    });
  },
  readDiscordCommandArgs = function (interaction, definitions) {
    if (!definitions || definitions.length === 0) {
      return;
    }
    const values = {};
    for (const definition of definitions) {
      let value;
      if (definition.type === "number") {
        value = interaction.options.getNumber(definition.name) ?? null;
      } else if (definition.type === "boolean") {
        value = interaction.options.getBoolean(definition.name) ?? null;
      } else {
        value = interaction.options.getString(definition.name) ?? null;
      }
      if (value != null) {
        values[definition.name] = value;
      }
    }
    return Object.keys(values).length > 0 ? { values } : undefined;
  },
  createCommandArgsWithValue = function (params) {
    const values = { [params.argName]: params.value };
    return { values };
  },
  encodeDiscordCommandArgValue = function (value) {
    return encodeURIComponent(value);
  },
  decodeDiscordCommandArgValue = function (value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  },
  isDiscordUnknownInteraction = function (error) {
    if (!error || typeof error !== "object") {
      return false;
    }
    const err = error;
    if (err.discordCode === 10062 || err.rawBody?.code === 10062) {
      return true;
    }
    if (err.status === 404 && /Unknown interaction/i.test(err.message ?? "")) {
      return true;
    }
    if (/Unknown interaction/i.test(err.rawBody?.message ?? "")) {
      return true;
    }
    return false;
  },
  buildDiscordCommandArgCustomId = function (params) {
    return [
      `${DISCORD_COMMAND_ARG_CUSTOM_ID_KEY}:command=${encodeDiscordCommandArgValue(params.command)}`,
      `arg=${encodeDiscordCommandArgValue(params.arg)}`,
      `value=${encodeDiscordCommandArgValue(params.value)}`,
      `user=${encodeDiscordCommandArgValue(params.userId)}`,
    ].join(";");
  },
  parseDiscordCommandArgData = function (data) {
    if (!data || typeof data !== "object") {
      return null;
    }
    const coerce = (value) =>
      typeof value === "string" || typeof value === "number" ? String(value) : "";
    const rawCommand = coerce(data.command);
    const rawArg = coerce(data.arg);
    const rawValue = coerce(data.value);
    const rawUser = coerce(data.user);
    if (!rawCommand || !rawArg || !rawValue || !rawUser) {
      return null;
    }
    return {
      command: decodeDiscordCommandArgValue(rawCommand),
      arg: decodeDiscordCommandArgValue(rawArg),
      value: decodeDiscordCommandArgValue(rawValue),
      userId: decodeDiscordCommandArgValue(rawUser),
    };
  },
  buildDiscordCommandArgMenu = function (params) {
    const { command, menu, interaction } = params;
    const commandLabel = command.nativeName ?? command.key;
    const userId = interaction.user?.id ?? "";
    const rows = chunkItems(menu.choices, 4).map((choices) => {
      const buttons = choices.map(
        (choice) =>
          new DiscordCommandArgButton({
            label: choice.label,
            customId: buildDiscordCommandArgCustomId({
              command: commandLabel,
              arg: menu.arg.name,
              value: choice.value,
              userId,
            }),
            cfg: params.cfg,
            discordConfig: params.discordConfig,
            accountId: params.accountId,
            sessionPrefix: params.sessionPrefix,
          }),
      );
      return new Row(buttons);
    });
    const content =
      menu.title ?? `Choose ${menu.arg.description || menu.arg.name} for /${commandLabel}.`;
    return { content, components: rows };
  };
import { Button, ChannelType, Command, Row } from "@buape/carbon";
import { ApplicationCommandOptionType, ButtonStyle } from "discord-api-types/v10";
import { resolveHumanDelayConfig } from "../../agents/identity.js";
import { resolveChunkMode, resolveTextChunkLimit } from "../../auto-reply/chunk.js";
import {
  buildCommandTextFromArgs,
  findCommandByNativeName,
  listChatCommands,
  parseCommandArgs,
  resolveCommandArgChoices,
  resolveCommandArgMenu,
  serializeCommandArgs,
} from "../../auto-reply/commands-registry.js";
import { finalizeInboundContext } from "../../auto-reply/reply/inbound-context.js";
import { dispatchReplyWithDispatcher } from "../../auto-reply/reply/provider-dispatcher.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../../channels/command-gating.js";
import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
import { getAgentScopedMediaLocalRoots } from "../../media/local-roots.js";
import { buildPairingReply } from "../../pairing/pairing-messages.js";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../../pairing/pairing-store.js";
import { resolveAgentRoute } from "../../routing/resolve-route.js";
import { buildUntrustedChannelMetadata } from "../../security/channel-metadata.js";
import { chunkItems } from "../../utils/chunk-items.js";
import { loadWebMedia } from "../../web/media.js";
import { chunkDiscordTextWithMode } from "../chunk.js";
import {
  allowListMatches,
  isDiscordGroupAllowedByPolicy,
  normalizeDiscordAllowList,
  normalizeDiscordSlug,
  resolveDiscordChannelConfigWithFallback,
  resolveDiscordGuildEntry,
  resolveDiscordMemberAccessState,
  resolveDiscordOwnerAllowFrom,
} from "./allow-list.js";
import { resolveDiscordChannelInfo } from "./message-utils.js";
import { resolveDiscordSenderIdentity } from "./sender-identity.js";
import { resolveDiscordThreadParentInfo } from "./threading.js";
const DISCORD_COMMAND_ARG_CUSTOM_ID_KEY = "cmdarg";
async function safeDiscordInteractionCall(label, fn) {
  try {
    return await fn();
  } catch (error) {
    if (isDiscordUnknownInteraction(error)) {
      console.warn(`discord: ${label} skipped (interaction expired)`);
      return null;
    }
    throw error;
  }
}
async function handleDiscordCommandArgInteraction(interaction, data, ctx) {
  const parsed = parseDiscordCommandArgData(data);
  if (!parsed) {
    await safeDiscordInteractionCall("command arg update", () =>
      interaction.update({
        content: "Sorry, that selection is no longer available.",
        components: [],
      }),
    );
    return;
  }
  if (interaction.user?.id && interaction.user.id !== parsed.userId) {
    await safeDiscordInteractionCall("command arg ack", () => interaction.acknowledge());
    return;
  }
  const commandDefinition =
    findCommandByNativeName(parsed.command, "discord") ??
    listChatCommands().find((entry) => entry.key === parsed.command);
  if (!commandDefinition) {
    await safeDiscordInteractionCall("command arg update", () =>
      interaction.update({
        content: "Sorry, that command is no longer available.",
        components: [],
      }),
    );
    return;
  }
  const updated = await safeDiscordInteractionCall("command arg update", () =>
    interaction.update({
      content: `\u2705 Selected ${parsed.value}.`,
      components: [],
    }),
  );
  if (!updated) {
    return;
  }
  const commandArgs = createCommandArgsWithValue({
    argName: parsed.arg,
    value: parsed.value,
  });
  const commandArgsWithRaw = {
    ...commandArgs,
    raw: serializeCommandArgs(commandDefinition, commandArgs),
  };
  const prompt = buildCommandTextFromArgs(commandDefinition, commandArgsWithRaw);
  await dispatchDiscordCommandInteraction({
    interaction,
    prompt,
    command: commandDefinition,
    commandArgs: commandArgsWithRaw,
    cfg: ctx.cfg,
    discordConfig: ctx.discordConfig,
    accountId: ctx.accountId,
    sessionPrefix: ctx.sessionPrefix,
    preferFollowUp: true,
  });
}

class DiscordCommandArgButton extends Button {
  label;
  customId;
  style = ButtonStyle.Secondary;
  cfg;
  discordConfig;
  accountId;
  sessionPrefix;
  constructor(params) {
    super();
    this.label = params.label;
    this.customId = params.customId;
    this.cfg = params.cfg;
    this.discordConfig = params.discordConfig;
    this.accountId = params.accountId;
    this.sessionPrefix = params.sessionPrefix;
  }
  async run(interaction, data) {
    await handleDiscordCommandArgInteraction(interaction, data, {
      cfg: this.cfg,
      discordConfig: this.discordConfig,
      accountId: this.accountId,
      sessionPrefix: this.sessionPrefix,
    });
  }
}

class DiscordCommandArgFallbackButton extends Button {
  label = "cmdarg";
  customId = "cmdarg:seed=1";
  ctx;
  constructor(ctx) {
    super();
    this.ctx = ctx;
  }
  async run(interaction, data) {
    await handleDiscordCommandArgInteraction(interaction, data, this.ctx);
  }
}
export function createDiscordCommandArgFallbackButton(params) {
  return new DiscordCommandArgFallbackButton(params);
}
export function createDiscordNativeCommand(params) {
  const { command, cfg, discordConfig, accountId, sessionPrefix, ephemeralDefault } = params;
  const commandDefinition = findCommandByNativeName(command.name, "discord") ?? {
    key: command.name,
    nativeName: command.name,
    description: command.description,
    textAliases: [],
    acceptsArgs: command.acceptsArgs,
    args: command.args,
    argsParsing: "none",
    scope: "native",
  };
  const argDefinitions = commandDefinition.args ?? command.args;
  const commandOptions = buildDiscordCommandOptions({
    command: commandDefinition,
    cfg,
  });
  const options = commandOptions
    ? commandOptions
    : command.acceptsArgs
      ? [
          {
            name: "input",
            description: "Command input",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ]
      : undefined;
  return new (class extends Command {
    name = command.name;
    description = command.description;
    defer = true;
    ephemeral = ephemeralDefault;
    options = options;
    async run(interaction) {
      const commandArgs = argDefinitions?.length
        ? readDiscordCommandArgs(interaction, argDefinitions)
        : command.acceptsArgs
          ? parseCommandArgs(commandDefinition, interaction.options.getString("input") ?? "")
          : undefined;
      const commandArgsWithRaw = commandArgs
        ? {
            ...commandArgs,
            raw: serializeCommandArgs(commandDefinition, commandArgs) ?? commandArgs.raw,
          }
        : undefined;
      const prompt = buildCommandTextFromArgs(commandDefinition, commandArgsWithRaw);
      await dispatchDiscordCommandInteraction({
        interaction,
        prompt,
        command: commandDefinition,
        commandArgs: commandArgsWithRaw,
        cfg,
        discordConfig,
        accountId,
        sessionPrefix,
        preferFollowUp: false,
      });
    }
  })();
}
async function dispatchDiscordCommandInteraction(params) {
  const {
    interaction,
    prompt,
    command,
    commandArgs,
    cfg,
    discordConfig,
    accountId,
    sessionPrefix,
    preferFollowUp,
  } = params;
  const respond = async (content, options) => {
    const payload = {
      content,
      ...(options?.ephemeral !== undefined ? { ephemeral: options.ephemeral } : {}),
    };
    await safeDiscordInteractionCall("interaction reply", async () => {
      if (preferFollowUp) {
        await interaction.followUp(payload);
        return;
      }
      await interaction.reply(payload);
    });
  };
  const useAccessGroups = cfg.commands?.useAccessGroups !== false;
  const user = interaction.user;
  if (!user) {
    return;
  }
  const sender = resolveDiscordSenderIdentity({ author: user, pluralkitInfo: null });
  const channel = interaction.channel;
  const channelType = channel?.type;
  const isDirectMessage = channelType === ChannelType.DM;
  const isGroupDm = channelType === ChannelType.GroupDM;
  const isThreadChannel =
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread ||
    channelType === ChannelType.AnnouncementThread;
  const channelName = channel && "name" in channel ? channel.name : undefined;
  const channelSlug = channelName ? normalizeDiscordSlug(channelName) : "";
  const rawChannelId = channel?.id ?? "";
  const memberRoleIds = Array.isArray(interaction.rawData.member?.roles)
    ? interaction.rawData.member.roles.map((roleId) => String(roleId))
    : [];
  const ownerAllowList = normalizeDiscordAllowList(
    discordConfig?.allowFrom ?? discordConfig?.dm?.allowFrom ?? [],
    ["discord:", "user:", "pk:"],
  );
  const ownerOk =
    ownerAllowList && user
      ? allowListMatches(ownerAllowList, {
          id: sender.id,
          name: sender.name,
          tag: sender.tag,
        })
      : false;
  const guildInfo = resolveDiscordGuildEntry({
    guild: interaction.guild ?? undefined,
    guildEntries: discordConfig?.guilds,
  });
  let threadParentId;
  let threadParentName;
  let threadParentSlug = "";
  if (interaction.guild && channel && isThreadChannel && rawChannelId) {
    const channelInfo = await resolveDiscordChannelInfo(interaction.client, rawChannelId);
    const parentInfo = await resolveDiscordThreadParentInfo({
      client: interaction.client,
      threadChannel: {
        id: rawChannelId,
        name: channelName,
        parentId: "parentId" in channel ? (channel.parentId ?? undefined) : undefined,
        parent: undefined,
      },
      channelInfo,
    });
    threadParentId = parentInfo.id;
    threadParentName = parentInfo.name;
    threadParentSlug = threadParentName ? normalizeDiscordSlug(threadParentName) : "";
  }
  const channelConfig = interaction.guild
    ? resolveDiscordChannelConfigWithFallback({
        guildInfo,
        channelId: rawChannelId,
        channelName,
        channelSlug,
        parentId: threadParentId,
        parentName: threadParentName,
        parentSlug: threadParentSlug,
        scope: isThreadChannel ? "thread" : "channel",
      })
    : null;
  if (channelConfig?.enabled === false) {
    await respond("This channel is disabled.");
    return;
  }
  if (interaction.guild && channelConfig?.allowed === false) {
    await respond("This channel is not allowed.");
    return;
  }
  if (useAccessGroups && interaction.guild) {
    const channelAllowlistConfigured =
      Boolean(guildInfo?.channels) && Object.keys(guildInfo?.channels ?? {}).length > 0;
    const channelAllowed = channelConfig?.allowed !== false;
    const allowByPolicy = isDiscordGroupAllowedByPolicy({
      groupPolicy: discordConfig?.groupPolicy ?? "open",
      guildAllowlisted: Boolean(guildInfo),
      channelAllowlistConfigured,
      channelAllowed,
    });
    if (!allowByPolicy) {
      await respond("This channel is not allowed.");
      return;
    }
  }
  const dmEnabled = discordConfig?.dm?.enabled ?? true;
  const dmPolicy = discordConfig?.dmPolicy ?? discordConfig?.dm?.policy ?? "pairing";
  let commandAuthorized = true;
  if (isDirectMessage) {
    if (!dmEnabled || dmPolicy === "disabled") {
      await respond("Discord DMs are disabled.");
      return;
    }
    if (dmPolicy !== "open") {
      const storeAllowFrom = await readChannelAllowFromStore("discord").catch(() => []);
      const effectiveAllowFrom = [
        ...(discordConfig?.allowFrom ?? discordConfig?.dm?.allowFrom ?? []),
        ...storeAllowFrom,
      ];
      const allowList = normalizeDiscordAllowList(effectiveAllowFrom, ["discord:", "user:", "pk:"]);
      const permitted = allowList
        ? allowListMatches(allowList, {
            id: sender.id,
            name: sender.name,
            tag: sender.tag,
          })
        : false;
      if (!permitted) {
        commandAuthorized = false;
        if (dmPolicy === "pairing") {
          const { code, created } = await upsertChannelPairingRequest({
            channel: "discord",
            id: user.id,
            meta: {
              tag: sender.tag,
              name: sender.name,
            },
          });
          if (created) {
            await respond(
              buildPairingReply({
                channel: "discord",
                idLine: `Your Discord user id: ${user.id}`,
                code,
              }),
              { ephemeral: true },
            );
          }
        } else {
          await respond("You are not authorized to use this command.", { ephemeral: true });
        }
        return;
      }
      commandAuthorized = true;
    }
  }
  if (!isDirectMessage) {
    const { hasAccessRestrictions, memberAllowed } = resolveDiscordMemberAccessState({
      channelConfig,
      guildInfo,
      memberRoleIds,
      sender,
    });
    const authorizers = useAccessGroups
      ? [
          { configured: ownerAllowList != null, allowed: ownerOk },
          { configured: hasAccessRestrictions, allowed: memberAllowed },
        ]
      : [{ configured: hasAccessRestrictions, allowed: memberAllowed }];
    commandAuthorized = resolveCommandAuthorizedFromAuthorizers({
      useAccessGroups,
      authorizers,
      modeWhenAccessGroupsOff: "configured",
    });
    if (!commandAuthorized) {
      await respond("You are not authorized to use this command.", { ephemeral: true });
      return;
    }
  }
  if (isGroupDm && discordConfig?.dm?.groupEnabled === false) {
    await respond("Discord group DMs are disabled.");
    return;
  }
  const menu = resolveCommandArgMenu({
    command,
    args: commandArgs,
    cfg,
  });
  if (menu) {
    const menuPayload = buildDiscordCommandArgMenu({
      command,
      menu,
      interaction,
      cfg,
      discordConfig,
      accountId,
      sessionPrefix,
    });
    if (preferFollowUp) {
      await safeDiscordInteractionCall("interaction follow-up", () =>
        interaction.followUp({
          content: menuPayload.content,
          components: menuPayload.components,
          ephemeral: true,
        }),
      );
      return;
    }
    await safeDiscordInteractionCall("interaction reply", () =>
      interaction.reply({
        content: menuPayload.content,
        components: menuPayload.components,
        ephemeral: true,
      }),
    );
    return;
  }
  const isGuild = Boolean(interaction.guild);
  const channelId = rawChannelId || "unknown";
  const interactionId = interaction.rawData.id;
  const route = resolveAgentRoute({
    cfg,
    channel: "discord",
    accountId,
    guildId: interaction.guild?.id ?? undefined,
    memberRoleIds,
    peer: {
      kind: isDirectMessage ? "direct" : isGroupDm ? "group" : "channel",
      id: isDirectMessage ? user.id : channelId,
    },
    parentPeer: threadParentId ? { kind: "channel", id: threadParentId } : undefined,
  });
  const conversationLabel = isDirectMessage ? (user.globalName ?? user.username) : channelId;
  const ownerAllowFrom = resolveDiscordOwnerAllowFrom({
    channelConfig,
    guildInfo,
    sender: { id: sender.id, name: sender.name, tag: sender.tag },
  });
  const ctxPayload = finalizeInboundContext({
    Body: prompt,
    BodyForAgent: prompt,
    RawBody: prompt,
    CommandBody: prompt,
    CommandArgs: commandArgs,
    From: isDirectMessage
      ? `discord:${user.id}`
      : isGroupDm
        ? `discord:group:${channelId}`
        : `discord:channel:${channelId}`,
    To: `slash:${user.id}`,
    SessionKey: `agent:${route.agentId}:${sessionPrefix}:${user.id}`,
    CommandTargetSessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isDirectMessage ? "direct" : isGroupDm ? "group" : "channel",
    ConversationLabel: conversationLabel,
    GroupSubject: isGuild ? interaction.guild?.name : undefined,
    GroupSystemPrompt: isGuild
      ? (() => {
          const systemPromptParts = [channelConfig?.systemPrompt?.trim() || null].filter((entry) =>
            Boolean(entry),
          );
          return systemPromptParts.length > 0 ? systemPromptParts.join("\n\n") : undefined;
        })()
      : undefined,
    UntrustedContext: isGuild
      ? (() => {
          const channelTopic =
            channel && "topic" in channel ? (channel.topic ?? undefined) : undefined;
          const untrustedChannelMetadata = buildUntrustedChannelMetadata({
            source: "discord",
            label: "Discord channel topic",
            entries: [channelTopic],
          });
          return untrustedChannelMetadata ? [untrustedChannelMetadata] : undefined;
        })()
      : undefined,
    OwnerAllowFrom: ownerAllowFrom,
    SenderName: user.globalName ?? user.username,
    SenderId: user.id,
    SenderUsername: user.username,
    SenderTag: sender.tag,
    Provider: "discord",
    Surface: "discord",
    WasMentioned: true,
    MessageSid: interactionId,
    Timestamp: Date.now(),
    CommandAuthorized: commandAuthorized,
    CommandSource: "native",
    OriginatingChannel: "discord",
    OriginatingTo: isDirectMessage ? `user:${user.id}` : `channel:${channelId}`,
  });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId: route.agentId,
    channel: "discord",
    accountId: route.accountId,
  });
  const mediaLocalRoots = getAgentScopedMediaLocalRoots(cfg, route.agentId);
  let didReply = false;
  await dispatchReplyWithDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      ...prefixOptions,
      humanDelay: resolveHumanDelayConfig(cfg, route.agentId),
      deliver: async (payload) => {
        try {
          await deliverDiscordInteractionReply({
            interaction,
            payload,
            mediaLocalRoots,
            textLimit: resolveTextChunkLimit(cfg, "discord", accountId, {
              fallbackLimit: 2000,
            }),
            maxLinesPerMessage: discordConfig?.maxLinesPerMessage,
            preferFollowUp: preferFollowUp || didReply,
            chunkMode: resolveChunkMode(cfg, "discord", accountId),
          });
        } catch (error) {
          if (isDiscordUnknownInteraction(error)) {
            console.warn("discord: interaction reply skipped (interaction expired)");
            return;
          }
          throw error;
        }
        didReply = true;
      },
      onError: (err, info) => {
        console.error(`discord slash ${info.kind} reply failed`, err);
      },
    },
    replyOptions: {
      skillFilter: channelConfig?.skills,
      disableBlockStreaming:
        typeof discordConfig?.blockStreaming === "boolean"
          ? !discordConfig.blockStreaming
          : undefined,
      onModelSelected,
    },
  });
}
async function deliverDiscordInteractionReply(params) {
  const { interaction, payload, textLimit, maxLinesPerMessage, preferFollowUp, chunkMode } = params;
  const mediaList = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
  const text = payload.text ?? "";
  let hasReplied = false;
  const sendMessage = async (content, files) => {
    const payload =
      files && files.length > 0
        ? {
            content,
            files: files.map((file) => {
              if (file.data instanceof Blob) {
                return { name: file.name, data: file.data };
              }
              const arrayBuffer = Uint8Array.from(file.data).buffer;
              return { name: file.name, data: new Blob([arrayBuffer]) };
            }),
          }
        : { content };
    await safeDiscordInteractionCall("interaction send", async () => {
      if (!preferFollowUp && !hasReplied) {
        await interaction.reply(payload);
        hasReplied = true;
        return;
      }
      await interaction.followUp(payload);
      hasReplied = true;
    });
  };
  if (mediaList.length > 0) {
    const media = await Promise.all(
      mediaList.map(async (url) => {
        const loaded = await loadWebMedia(url, {
          localRoots: params.mediaLocalRoots,
        });
        return {
          name: loaded.fileName ?? "upload",
          data: loaded.buffer,
        };
      }),
    );
    const chunks = chunkDiscordTextWithMode(text, {
      maxChars: textLimit,
      maxLines: maxLinesPerMessage,
      chunkMode,
    });
    if (!chunks.length && text) {
      chunks.push(text);
    }
    const caption = chunks[0] ?? "";
    await sendMessage(caption, media);
    for (const chunk of chunks.slice(1)) {
      if (!chunk.trim()) {
        continue;
      }
      await interaction.followUp({ content: chunk });
    }
    return;
  }
  if (!text.trim()) {
    return;
  }
  const chunks = chunkDiscordTextWithMode(text, {
    maxChars: textLimit,
    maxLines: maxLinesPerMessage,
    chunkMode,
  });
  if (!chunks.length && text) {
    chunks.push(text);
  }
  for (const chunk of chunks) {
    if (!chunk.trim()) {
      continue;
    }
    await sendMessage(chunk);
  }
}
