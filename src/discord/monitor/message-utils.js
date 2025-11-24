let normalizeDiscordChannelId = function (value) {
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value).trim();
    }
    return "";
  },
  inferPlaceholder = function (attachment) {
    const mime = attachment.content_type ?? "";
    if (mime.startsWith("image/")) {
      return "<media:image>";
    }
    if (mime.startsWith("video/")) {
      return "<media:video>";
    }
    if (mime.startsWith("audio/")) {
      return "<media:audio>";
    }
    return "<media:document>";
  },
  isImageAttachment = function (attachment) {
    const mime = attachment.content_type ?? "";
    if (mime.startsWith("image/")) {
      return true;
    }
    const name = attachment.filename?.toLowerCase() ?? "";
    if (!name) {
      return false;
    }
    return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/.test(name);
  },
  buildDiscordAttachmentPlaceholder = function (attachments) {
    if (!attachments || attachments.length === 0) {
      return "";
    }
    const count = attachments.length;
    const allImages = attachments.every(isImageAttachment);
    const label = allImages ? "image" : "file";
    const suffix = count === 1 ? label : `${label}s`;
    const tag = allImages ? "<media:image>" : "<media:document>";
    return `${tag} (${count} ${suffix})`;
  },
  resolveDiscordForwardedMessagesText = function (message) {
    const snapshots = resolveDiscordMessageSnapshots(message);
    if (snapshots.length === 0) {
      return "";
    }
    const forwardedBlocks = snapshots
      .map((snapshot) => {
        const snapshotMessage = snapshot.message;
        if (!snapshotMessage) {
          return null;
        }
        const text = resolveDiscordSnapshotMessageText(snapshotMessage);
        if (!text) {
          return null;
        }
        const authorLabel = formatDiscordSnapshotAuthor(snapshotMessage.author);
        const heading = authorLabel
          ? `[Forwarded message from ${authorLabel}]`
          : "[Forwarded message]";
        return `${heading}\n${text}`;
      })
      .filter((entry) => Boolean(entry));
    if (forwardedBlocks.length === 0) {
      return "";
    }
    return forwardedBlocks.join("\n\n");
  },
  resolveDiscordMessageSnapshots = function (message) {
    const rawData = message.rawData;
    const snapshots =
      rawData?.message_snapshots ?? message.message_snapshots ?? message.messageSnapshots;
    if (!Array.isArray(snapshots)) {
      return [];
    }
    return snapshots.filter((entry) => Boolean(entry) && typeof entry === "object");
  },
  resolveDiscordSnapshotMessageText = function (snapshot) {
    const content = snapshot.content?.trim() ?? "";
    const attachmentText = buildDiscordAttachmentPlaceholder(snapshot.attachments ?? undefined);
    const embed = snapshot.embeds?.[0];
    const embedText = embed?.description?.trim() || embed?.title?.trim() || "";
    return content || attachmentText || embedText || "";
  },
  formatDiscordSnapshotAuthor = function (author) {
    if (!author) {
      return;
    }
    const globalName = author.global_name ?? undefined;
    const username = author.username ?? undefined;
    const name = author.name ?? undefined;
    const discriminator = author.discriminator ?? undefined;
    const base = globalName || username || name;
    if (username && discriminator && discriminator !== "0") {
      return `@${username}#${discriminator}`;
    }
    if (base) {
      return `@${base}`;
    }
    if (author.id) {
      return `@${author.id}`;
    }
    return;
  };
import { logVerbose } from "../../globals.js";
import { fetchRemoteMedia } from "../../media/fetch.js";
import { saveMediaBuffer } from "../../media/store.js";
const DISCORD_CHANNEL_INFO_CACHE_TTL_MS = 300000;
const DISCORD_CHANNEL_INFO_NEGATIVE_CACHE_TTL_MS = 30000;
const DISCORD_CHANNEL_INFO_CACHE = new Map();
export function __resetDiscordChannelInfoCacheForTest() {
  DISCORD_CHANNEL_INFO_CACHE.clear();
}
export function resolveDiscordMessageChannelId(params) {
  const message = params.message;
  return (
    normalizeDiscordChannelId(message.channelId) ||
    normalizeDiscordChannelId(message.channel_id) ||
    normalizeDiscordChannelId(message.rawData?.channel_id) ||
    normalizeDiscordChannelId(params.eventChannelId)
  );
}
export async function resolveDiscordChannelInfo(client, channelId) {
  const cached = DISCORD_CHANNEL_INFO_CACHE.get(channelId);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.value;
    }
    DISCORD_CHANNEL_INFO_CACHE.delete(channelId);
  }
  try {
    const channel = await client.fetchChannel(channelId);
    if (!channel) {
      DISCORD_CHANNEL_INFO_CACHE.set(channelId, {
        value: null,
        expiresAt: Date.now() + DISCORD_CHANNEL_INFO_NEGATIVE_CACHE_TTL_MS,
      });
      return null;
    }
    const name = "name" in channel ? (channel.name ?? undefined) : undefined;
    const topic = "topic" in channel ? (channel.topic ?? undefined) : undefined;
    const parentId = "parentId" in channel ? (channel.parentId ?? undefined) : undefined;
    const ownerId = "ownerId" in channel ? (channel.ownerId ?? undefined) : undefined;
    const payload = {
      type: channel.type,
      name,
      topic,
      parentId,
      ownerId,
    };
    DISCORD_CHANNEL_INFO_CACHE.set(channelId, {
      value: payload,
      expiresAt: Date.now() + DISCORD_CHANNEL_INFO_CACHE_TTL_MS,
    });
    return payload;
  } catch (err) {
    logVerbose(`discord: failed to fetch channel ${channelId}: ${String(err)}`);
    DISCORD_CHANNEL_INFO_CACHE.set(channelId, {
      value: null,
      expiresAt: Date.now() + DISCORD_CHANNEL_INFO_NEGATIVE_CACHE_TTL_MS,
    });
    return null;
  }
}
export async function resolveMediaList(message, maxBytes) {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return [];
  }
  const out = [];
  await appendResolvedMediaFromAttachments({
    attachments,
    maxBytes,
    out,
    errorPrefix: "discord: failed to download attachment",
  });
  return out;
}
export async function resolveForwardedMediaList(message, maxBytes) {
  const snapshots = resolveDiscordMessageSnapshots(message);
  if (snapshots.length === 0) {
    return [];
  }
  const out = [];
  for (const snapshot of snapshots) {
    await appendResolvedMediaFromAttachments({
      attachments: snapshot.message?.attachments,
      maxBytes,
      out,
      errorPrefix: "discord: failed to download forwarded attachment",
    });
  }
  return out;
}
async function appendResolvedMediaFromAttachments(params) {
  const attachments = params.attachments;
  if (!attachments || attachments.length === 0) {
    return;
  }
  for (const attachment of attachments) {
    try {
      const fetched = await fetchRemoteMedia({
        url: attachment.url,
        filePathHint: attachment.filename ?? attachment.url,
      });
      const saved = await saveMediaBuffer(
        fetched.buffer,
        fetched.contentType ?? attachment.content_type,
        "inbound",
        params.maxBytes,
      );
      params.out.push({
        path: saved.path,
        contentType: saved.contentType,
        placeholder: inferPlaceholder(attachment),
      });
    } catch (err) {
      const id = attachment.id ?? attachment.url;
      logVerbose(`${params.errorPrefix} ${id}: ${String(err)}`);
    }
  }
}
export function resolveDiscordMessageText(message, options) {
  const baseText =
    message.content?.trim() ||
    buildDiscordAttachmentPlaceholder(message.attachments) ||
    message.embeds?.[0]?.description ||
    options?.fallbackText?.trim() ||
    "";
  if (!options?.includeForwarded) {
    return baseText;
  }
  const forwardedText = resolveDiscordForwardedMessagesText(message);
  if (!forwardedText) {
    return baseText;
  }
  if (!baseText) {
    return forwardedText;
  }
  return `${baseText}\n${forwardedText}`;
}
export function buildDiscordMediaPayload(mediaList) {
  const first = mediaList[0];
  const mediaPaths = mediaList.map((media) => media.path);
  const mediaTypes = mediaList.map((media) => media.contentType).filter(Boolean);
  return {
    MediaPath: first?.path,
    MediaType: first?.contentType,
    MediaUrl: first?.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  };
}
