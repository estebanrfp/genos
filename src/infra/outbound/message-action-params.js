let resolveAttachmentMaxBytes = function (params) {
    const accountId = typeof params.accountId === "string" ? params.accountId.trim() : "";
    const channelCfg = params.cfg.channels?.[params.channel];
    const channelObj = channelCfg && typeof channelCfg === "object" ? channelCfg : undefined;
    const channelMediaMax =
      typeof channelObj?.mediaMaxMb === "number" ? channelObj.mediaMaxMb : undefined;
    const accountsObj =
      channelObj?.accounts && typeof channelObj.accounts === "object"
        ? channelObj.accounts
        : undefined;
    const accountCfg = accountId && accountsObj ? accountsObj[accountId] : undefined;
    const accountMediaMax =
      accountCfg && typeof accountCfg === "object" ? accountCfg.mediaMaxMb : undefined;
    const limitMb =
      (typeof accountMediaMax === "number" ? accountMediaMax : undefined) ??
      channelMediaMax ??
      params.cfg.agents?.defaults?.mediaMaxMb;
    return typeof limitMb === "number" ? limitMb * 1024 * 1024 : undefined;
  },
  inferAttachmentFilename = function (params) {
    const mediaHint = params.mediaHint?.trim();
    if (mediaHint) {
      try {
        if (mediaHint.startsWith("file://")) {
          const filePath = fileURLToPath(mediaHint);
          const base = path.basename(filePath);
          if (base) {
            return base;
          }
        } else if (/^https?:\/\//i.test(mediaHint)) {
          const url = new URL(mediaHint);
          const base = path.basename(url.pathname);
          if (base) {
            return base;
          }
        } else {
          const base = path.basename(mediaHint);
          if (base) {
            return base;
          }
        }
      } catch {}
    }
    const ext = params.contentType ? extensionForMime(params.contentType) : undefined;
    return ext ? `attachment${ext}` : "attachment";
  },
  normalizeBase64Payload = function (params) {
    if (!params.base64) {
      return { base64: params.base64, contentType: params.contentType };
    }
    const match = /^data:([^;]+);base64,(.*)$/i.exec(params.base64.trim());
    if (!match) {
      return { base64: params.base64, contentType: params.contentType };
    }
    const [, mime, payload] = match;
    return {
      base64: payload,
      contentType: params.contentType ?? mime,
    };
  };
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStringParam } from "../../agents/tools/common.js";
import { extensionForMime } from "../../media/mime.js";
import { parseSlackTarget } from "../../slack/targets.js";
import { parseTelegramTarget } from "../../telegram/targets.js";
import { loadWebMedia } from "../../web/media.js";
export function readBooleanParam(params, key) {
  const raw = params[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
  }
  return;
}
export function resolveSlackAutoThreadId(params) {
  const context = params.toolContext;
  if (!context?.currentThreadTs || !context.currentChannelId) {
    return;
  }
  if (context.replyToMode !== "all" && context.replyToMode !== "first") {
    return;
  }
  const parsedTarget = parseSlackTarget(params.to, { defaultKind: "channel" });
  if (!parsedTarget || parsedTarget.kind !== "channel") {
    return;
  }
  if (parsedTarget.id.toLowerCase() !== context.currentChannelId.toLowerCase()) {
    return;
  }
  if (context.replyToMode === "first" && context.hasRepliedRef?.value) {
    return;
  }
  return context.currentThreadTs;
}
export function resolveTelegramAutoThreadId(params) {
  const context = params.toolContext;
  if (!context?.currentThreadTs || !context.currentChannelId) {
    return;
  }
  const parsedTo = parseTelegramTarget(params.to);
  const parsedChannel = parseTelegramTarget(context.currentChannelId);
  if (parsedTo.chatId.toLowerCase() !== parsedChannel.chatId.toLowerCase()) {
    return;
  }
  return context.currentThreadTs;
}
async function hydrateAttachmentPayload(params) {
  const contentTypeParam = params.contentTypeParam ?? undefined;
  const rawBuffer = readStringParam(params.args, "buffer", { trim: false });
  const normalized = normalizeBase64Payload({
    base64: rawBuffer,
    contentType: contentTypeParam ?? undefined,
  });
  if (normalized.base64 !== rawBuffer && normalized.base64) {
    params.args.buffer = normalized.base64;
    if (normalized.contentType && !contentTypeParam) {
      params.args.contentType = normalized.contentType;
    }
  }
  const filename = readStringParam(params.args, "filename");
  const mediaSource = (params.mediaHint ?? undefined) || (params.fileHint ?? undefined);
  if (!params.dryRun && !readStringParam(params.args, "buffer", { trim: false }) && mediaSource) {
    const maxBytes = resolveAttachmentMaxBytes({
      cfg: params.cfg,
      channel: params.channel,
      accountId: params.accountId,
    });
    const media = await loadWebMedia(mediaSource, {
      maxBytes,
      sandboxValidated: true,
      readFile: (filePath) => fs.readFile(filePath),
    });
    params.args.buffer = media.buffer.toString("base64");
    if (!contentTypeParam && media.contentType) {
      params.args.contentType = media.contentType;
    }
    if (!filename) {
      params.args.filename = inferAttachmentFilename({
        mediaHint: media.fileName ?? mediaSource,
        contentType: media.contentType ?? contentTypeParam ?? undefined,
      });
    }
  } else if (!filename) {
    params.args.filename = inferAttachmentFilename({
      mediaHint: mediaSource,
      contentType: contentTypeParam ?? undefined,
    });
  }
}
export async function normalizeSandboxMediaParams(params) {
  const mediaKeys = ["media", "path", "filePath"];
  for (const key of mediaKeys) {
    const raw = readStringParam(params.args, key, { trim: false });
    if (!raw) {
      continue;
    }
    continue;
  }
}
export async function normalizeSandboxMediaList(params) {
  const normalized = [];
  const seen = new Set();
  for (const value of params.values) {
    const raw = value?.trim();
    if (!raw) {
      continue;
    }
    if (seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    normalized.push(raw);
  }
  return normalized;
}
async function hydrateAttachmentActionPayload(params) {
  const mediaHint = readStringParam(params.args, "media", { trim: false });
  const fileHint =
    readStringParam(params.args, "path", { trim: false }) ??
    readStringParam(params.args, "filePath", { trim: false });
  const contentTypeParam =
    readStringParam(params.args, "contentType") ?? readStringParam(params.args, "mimeType");
  if (params.allowMessageCaptionFallback) {
    const caption = readStringParam(params.args, "caption", { allowEmpty: true })?.trim();
    const message = readStringParam(params.args, "message", { allowEmpty: true })?.trim();
    if (!caption && message) {
      params.args.caption = message;
    }
  }
  await hydrateAttachmentPayload({
    cfg: params.cfg,
    channel: params.channel,
    accountId: params.accountId,
    args: params.args,
    dryRun: params.dryRun,
    contentTypeParam,
    mediaHint,
    fileHint,
  });
}
export async function hydrateSetGroupIconParams(params) {
  if (params.action !== "setGroupIcon") {
    return;
  }
  await hydrateAttachmentActionPayload(params);
}
export async function hydrateSendAttachmentParams(params) {
  if (params.action !== "sendAttachment") {
    return;
  }
  await hydrateAttachmentActionPayload({ ...params, allowMessageCaptionFallback: true });
}
export function parseButtonsParam(params) {
  const raw = params.buttons;
  if (typeof raw !== "string") {
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    delete params.buttons;
    return;
  }
  try {
    params.buttons = JSON.parse(trimmed);
  } catch {
    throw new Error("--buttons must be valid JSON");
  }
}
export function parseCardParam(params) {
  const raw = params.card;
  if (typeof raw !== "string") {
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    delete params.card;
    return;
  }
  try {
    params.card = JSON.parse(trimmed);
  } catch {
    throw new Error("--card must be valid JSON");
  }
}
export function parseComponentsParam(params) {
  const raw = params.components;
  if (typeof raw !== "string") {
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    delete params.components;
    return;
  }
  try {
    params.components = JSON.parse(trimmed);
  } catch {
    throw new Error("--components must be valid JSON");
  }
}
