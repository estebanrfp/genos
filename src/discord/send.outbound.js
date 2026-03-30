let deriveForumThreadName = function (text) {
    const firstLine =
      text
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ?? "";
    return firstLine.slice(0, DISCORD_THREAD_NAME_LIMIT) || new Date().toISOString().slice(0, 16);
  },
  isForumLikeType = function (channelType) {
    return channelType === ChannelType.GuildForum || channelType === ChannelType.GuildMedia;
  },
  toDiscordSendResult = function (result, fallbackChannelId) {
    return {
      messageId: result.id ? String(result.id) : "unknown",
      channelId: String(result.channel_id ?? fallbackChannelId),
    };
  };
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { serializePayload } from "@buape/carbon";
import { ChannelType, Routes } from "discord-api-types/v10";
import { resolveChunkMode } from "../auto-reply/chunk.js";
import { loadConfig } from "../config/config.js";
import { resolveMarkdownTableMode } from "../config/markdown-tables.js";
import { recordChannelActivity } from "../infra/channel-activity.js";
import { resolvePreferredGenosOSTmpDir } from "../infra/tmp-genosos-dir.js";
import { convertMarkdownTables } from "../markdown/tables.js";
import { maxBytesForKind } from "../media/constants.js";
import { extensionForMime } from "../media/mime.js";
import { loadWebMediaRaw } from "../web/media.js";
import { resolveDiscordAccount } from "./accounts.js";
import {
  buildDiscordMessagePayload,
  buildDiscordSendError,
  buildDiscordTextChunks,
  createDiscordClient,
  normalizeDiscordPollInput,
  normalizeStickerIds,
  parseAndResolveRecipient,
  resolveChannelId,
  resolveDiscordSendComponents,
  resolveDiscordSendEmbeds,
  sendDiscordMedia,
  sendDiscordText,
  stripUndefinedFields,
  SUPPRESS_NOTIFICATIONS_FLAG,
} from "./send.shared.js";
import {
  ensureOggOpus,
  getVoiceMessageMetadata,
  sendDiscordVoiceMessage,
} from "./voice-message.js";
const DISCORD_THREAD_NAME_LIMIT = 100;
async function resolveDiscordSendTarget(to, opts) {
  const cfg = loadConfig();
  const { rest, request } = createDiscordClient(opts, cfg);
  const recipient = await parseAndResolveRecipient(to, opts.accountId);
  const { channelId } = await resolveChannelId(rest, recipient, request);
  return { rest, request, channelId };
}
export async function sendMessageDiscord(to, text, opts = {}) {
  const cfg = loadConfig();
  const accountInfo = resolveDiscordAccount({
    cfg,
    accountId: opts.accountId,
  });
  const tableMode = resolveMarkdownTableMode({
    cfg,
    channel: "discord",
    accountId: accountInfo.accountId,
  });
  const chunkMode = resolveChunkMode(cfg, "discord", accountInfo.accountId);
  const textWithTables = convertMarkdownTables(text ?? "", tableMode);
  const { token, rest, request } = createDiscordClient(opts, cfg);
  const recipient = await parseAndResolveRecipient(to, opts.accountId);
  const { channelId } = await resolveChannelId(rest, recipient, request);
  let channelType;
  try {
    const channel = await rest.get(Routes.channel(channelId));
    channelType = channel?.type;
  } catch {}
  if (isForumLikeType(channelType)) {
    const threadName = deriveForumThreadName(textWithTables);
    const chunks = buildDiscordTextChunks(textWithTables, {
      maxLinesPerMessage: accountInfo.config.maxLinesPerMessage,
      chunkMode,
    });
    const starterContent = chunks[0]?.trim() ? chunks[0] : threadName;
    const starterComponents = resolveDiscordSendComponents({
      components: opts.components,
      text: starterContent,
      isFirst: true,
    });
    const starterEmbeds = resolveDiscordSendEmbeds({ embeds: opts.embeds, isFirst: true });
    const silentFlags = opts.silent ? 1 << 12 : undefined;
    const starterPayload = buildDiscordMessagePayload({
      text: starterContent,
      components: starterComponents,
      embeds: starterEmbeds,
      flags: silentFlags,
    });
    let threadRes;
    try {
      threadRes = await request(
        () =>
          rest.post(Routes.threads(channelId), {
            body: {
              name: threadName,
              message: stripUndefinedFields(serializePayload(starterPayload)),
            },
          }),
        "forum-thread",
      );
    } catch (err) {
      throw await buildDiscordSendError(err, {
        channelId,
        rest,
        token,
        hasMedia: Boolean(opts.mediaUrl),
      });
    }
    const threadId = threadRes.id;
    const messageId = threadRes.message?.id ?? threadId;
    const resultChannelId = threadRes.message?.channel_id ?? threadId;
    const remainingChunks = chunks.slice(1);
    try {
      if (opts.mediaUrl) {
        const [mediaCaption, ...afterMediaChunks] = remainingChunks;
        await sendDiscordMedia(
          rest,
          threadId,
          mediaCaption ?? "",
          opts.mediaUrl,
          opts.mediaLocalRoots,
          undefined,
          request,
          accountInfo.config.maxLinesPerMessage,
          undefined,
          undefined,
          chunkMode,
          opts.silent,
        );
        for (const chunk of afterMediaChunks) {
          await sendDiscordText(
            rest,
            threadId,
            chunk,
            undefined,
            request,
            accountInfo.config.maxLinesPerMessage,
            undefined,
            undefined,
            chunkMode,
            opts.silent,
          );
        }
      } else {
        for (const chunk of remainingChunks) {
          await sendDiscordText(
            rest,
            threadId,
            chunk,
            undefined,
            request,
            accountInfo.config.maxLinesPerMessage,
            undefined,
            undefined,
            chunkMode,
            opts.silent,
          );
        }
      }
    } catch (err) {
      throw await buildDiscordSendError(err, {
        channelId: threadId,
        rest,
        token,
        hasMedia: Boolean(opts.mediaUrl),
      });
    }
    recordChannelActivity({
      channel: "discord",
      accountId: accountInfo.accountId,
      direction: "outbound",
    });
    return toDiscordSendResult(
      {
        id: messageId,
        channel_id: resultChannelId,
      },
      channelId,
    );
  }
  let result;
  try {
    if (opts.mediaUrl) {
      result = await sendDiscordMedia(
        rest,
        channelId,
        textWithTables,
        opts.mediaUrl,
        opts.mediaLocalRoots,
        opts.replyTo,
        request,
        accountInfo.config.maxLinesPerMessage,
        opts.components,
        opts.embeds,
        chunkMode,
        opts.silent,
      );
    } else {
      result = await sendDiscordText(
        rest,
        channelId,
        textWithTables,
        opts.replyTo,
        request,
        accountInfo.config.maxLinesPerMessage,
        opts.components,
        opts.embeds,
        chunkMode,
        opts.silent,
      );
    }
  } catch (err) {
    throw await buildDiscordSendError(err, {
      channelId,
      rest,
      token,
      hasMedia: Boolean(opts.mediaUrl),
    });
  }
  recordChannelActivity({
    channel: "discord",
    accountId: accountInfo.accountId,
    direction: "outbound",
  });
  return toDiscordSendResult(result, channelId);
}
export async function sendStickerDiscord(to, stickerIds, opts = {}) {
  const { rest, request, channelId } = await resolveDiscordSendTarget(to, opts);
  const content = opts.content?.trim();
  const stickers = normalizeStickerIds(stickerIds);
  const res = await request(
    () =>
      rest.post(Routes.channelMessages(channelId), {
        body: {
          content: content || undefined,
          sticker_ids: stickers,
        },
      }),
    "sticker",
  );
  return toDiscordSendResult(res, channelId);
}
export async function sendPollDiscord(to, poll, opts = {}) {
  const { rest, request, channelId } = await resolveDiscordSendTarget(to, opts);
  const content = opts.content?.trim();
  if (poll.durationSeconds !== undefined) {
    throw new Error("Discord polls do not support durationSeconds; use durationHours");
  }
  const payload = normalizeDiscordPollInput(poll);
  const flags = opts.silent ? SUPPRESS_NOTIFICATIONS_FLAG : undefined;
  const res = await request(
    () =>
      rest.post(Routes.channelMessages(channelId), {
        body: {
          content: content || undefined,
          poll: payload,
          ...(flags ? { flags } : {}),
        },
      }),
    "poll",
  );
  return toDiscordSendResult(res, channelId);
}
async function materializeVoiceMessageInput(mediaUrl) {
  const media = await loadWebMediaRaw(mediaUrl, maxBytesForKind("audio"));
  const extFromName = media.fileName ? path.extname(media.fileName) : "";
  const extFromMime = media.contentType ? extensionForMime(media.contentType) : "";
  const ext = extFromName || extFromMime || ".bin";
  const tempDir = resolvePreferredGenosOSTmpDir();
  const filePath = path.join(tempDir, `voice-src-${crypto.randomUUID()}${ext}`);
  await fs.writeFile(filePath, media.buffer, { mode: 384 });
  return { filePath };
}
export async function sendVoiceMessageDiscord(to, audioPath, opts = {}) {
  const { filePath: localInputPath } = await materializeVoiceMessageInput(audioPath);
  let oggPath = null;
  let oggCleanup = false;
  let token;
  let rest;
  let channelId;
  try {
    const cfg = loadConfig();
    const accountInfo = resolveDiscordAccount({
      cfg,
      accountId: opts.accountId,
    });
    const client = createDiscordClient(opts, cfg);
    token = client.token;
    rest = client.rest;
    const request = client.request;
    const recipient = await parseAndResolveRecipient(to, opts.accountId);
    channelId = (await resolveChannelId(rest, recipient, request)).channelId;
    const ogg = await ensureOggOpus(localInputPath);
    oggPath = ogg.path;
    oggCleanup = ogg.cleanup;
    const metadata = await getVoiceMessageMetadata(oggPath);
    const audioBuffer = await fs.readFile(oggPath);
    const result = await sendDiscordVoiceMessage(
      rest,
      channelId,
      audioBuffer,
      metadata,
      opts.replyTo,
      request,
      opts.silent,
    );
    recordChannelActivity({
      channel: "discord",
      accountId: accountInfo.accountId,
      direction: "outbound",
    });
    return toDiscordSendResult(result, channelId);
  } catch (err) {
    if (channelId && rest && token) {
      throw await buildDiscordSendError(err, {
        channelId,
        rest,
        token,
        hasMedia: true,
      });
    }
    throw err;
  } finally {
    if (oggCleanup && oggPath) {
      try {
        await fs.unlink(oggPath);
      } catch {}
    }
    try {
      await fs.unlink(localInputPath);
    } catch {}
  }
}
