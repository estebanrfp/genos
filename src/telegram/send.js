let createTelegramHttpLogger = function (cfg) {
    const enabled = isDiagnosticFlagEnabled("telegram.http", cfg);
    if (!enabled) {
      return () => {};
    }
    return (label, err) => {
      if (!(err instanceof HttpError)) {
        return;
      }
      const detail = redactSensitiveText(formatUncaughtError(err.error ?? err));
      diagLogger.warn(`telegram http error (${label}): ${detail}`);
    };
  },
  resolveTelegramClientOptions = function (account) {
    const proxyUrl = account.config.proxy?.trim();
    const proxyFetch = proxyUrl ? makeProxyFetch(proxyUrl) : undefined;
    const fetchImpl = resolveTelegramFetch(proxyFetch, {
      network: account.config.network,
    });
    const timeoutSeconds =
      typeof account.config.timeoutSeconds === "number" &&
      Number.isFinite(account.config.timeoutSeconds)
        ? Math.max(1, Math.floor(account.config.timeoutSeconds))
        : undefined;
    return fetchImpl || timeoutSeconds
      ? {
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
          ...(timeoutSeconds ? { timeoutSeconds } : {}),
        }
      : undefined;
  },
  resolveToken = function (explicit, params) {
    if (explicit?.trim()) {
      return explicit.trim();
    }
    if (!params.token) {
      throw new Error(
        `Telegram bot token missing for account "${params.accountId}" (set channels.telegram.accounts.${params.accountId}.botToken/tokenFile or TELEGRAM_BOT_TOKEN for default).`,
      );
    }
    return params.token.trim();
  },
  normalizeChatId = function (to) {
    const trimmed = to.trim();
    if (!trimmed) {
      throw new Error("Recipient is required for Telegram sends");
    }
    let normalized = stripTelegramInternalPrefixes(trimmed);
    const m =
      /^https?:\/\/t\.me\/([A-Za-z0-9_]+)$/i.exec(normalized) ??
      /^t\.me\/([A-Za-z0-9_]+)$/i.exec(normalized);
    if (m?.[1]) {
      normalized = `@${m[1]}`;
    }
    if (!normalized) {
      throw new Error("Recipient is required for Telegram sends");
    }
    if (normalized.startsWith("@")) {
      return normalized;
    }
    if (/^-?\d+$/.test(normalized)) {
      return normalized;
    }
    if (/^[A-Za-z0-9_]{5,}$/i.test(normalized)) {
      return `@${normalized}`;
    }
    return normalized;
  },
  normalizeMessageId = function (raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.trunc(raw);
    }
    if (typeof raw === "string") {
      const value = raw.trim();
      if (!value) {
        throw new Error("Message id is required for Telegram actions");
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    throw new Error("Message id is required for Telegram actions");
  },
  isTelegramThreadNotFoundError = function (err) {
    return THREAD_NOT_FOUND_RE.test(formatErrorMessage(err));
  },
  isTelegramMessageNotModifiedError = function (err) {
    return MESSAGE_NOT_MODIFIED_RE.test(formatErrorMessage(err));
  },
  hasMessageThreadIdParam = function (params) {
    if (!params) {
      return false;
    }
    const value = params.message_thread_id;
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return false;
  },
  removeMessageThreadIdParam = function (params) {
    if (!params || !hasMessageThreadIdParam(params)) {
      return params;
    }
    const next = { ...params };
    delete next.message_thread_id;
    return Object.keys(next).length > 0 ? next : undefined;
  },
  isTelegramHtmlParseError = function (err) {
    return PARSE_ERR_RE.test(formatErrorMessage(err));
  },
  buildTelegramThreadReplyParams = function (params) {
    const messageThreadId =
      params.messageThreadId != null ? params.messageThreadId : params.targetMessageThreadId;
    const threadScope = params.chatType === "direct" ? "dm" : "forum";
    const threadSpec =
      messageThreadId != null ? { id: messageThreadId, scope: threadScope } : undefined;
    const threadIdParams = buildTelegramThreadParams(threadSpec);
    const threadParams = threadIdParams ? { ...threadIdParams } : {};
    if (params.replyToMessageId != null) {
      const replyToMessageId = Math.trunc(params.replyToMessageId);
      if (params.quoteText?.trim()) {
        threadParams.reply_parameters = {
          message_id: replyToMessageId,
          quote: params.quoteText.trim(),
        };
      } else {
        threadParams.reply_to_message_id = replyToMessageId;
      }
    }
    return threadParams;
  },
  resolveTelegramApiContext = function (opts) {
    const cfg = opts.cfg ?? loadConfig();
    const account = resolveTelegramAccount({
      cfg,
      accountId: opts.accountId,
    });
    const token = resolveToken(opts.token, account);
    const client = resolveTelegramClientOptions(account);
    const api = opts.api ?? new Bot(token, client ? { client } : undefined).api;
    return { cfg, account, api };
  },
  createTelegramRequestWithDiag = function (params) {
    const request = createTelegramRetryRunner({
      retry: params.retry,
      configRetry: params.account.config.retry,
      verbose: params.verbose,
      ...(params.shouldRetry ? { shouldRetry: params.shouldRetry } : {}),
    });
    const logHttpError = createTelegramHttpLogger(params.cfg);
    return (fn, label, options) => {
      const runRequest = () => request(fn, label);
      const call =
        params.useApiErrorLogging === false
          ? runRequest()
          : withTelegramApiErrorLogging({
              operation: label ?? "request",
              fn: runRequest,
              ...(options?.shouldLog ? { shouldLog: options.shouldLog } : {}),
            });
      return call.catch((err) => {
        logHttpError(label ?? "request", err);
        throw err;
      });
    };
  },
  wrapTelegramChatNotFoundError = function (err, params) {
    if (!CHAT_NOT_FOUND_RE.test(formatErrorMessage(err))) {
      return err;
    }
    return new Error(
      [
        `Telegram send failed: chat not found (chat_id=${params.chatId}).`,
        "Likely: bot not started in DM, bot removed from group/channel, group migrated (new -100\u2026 id), or wrong bot token.",
        `Input was: ${JSON.stringify(params.input)}.`,
      ].join(" "),
    );
  },
  createRequestWithChatNotFound = function (params) {
    return async (fn, label) =>
      params.requestWithDiag(fn, label).catch((err) => {
        throw wrapTelegramChatNotFoundError(err, {
          chatId: params.chatId,
          input: params.input,
        });
      });
  },
  inferFilename = function (kind) {
    switch (kind) {
      case "image":
        return "image.jpg";
      case "video":
        return "video.mp4";
      case "audio":
        return "audio.ogg";
      default:
        return "file.bin";
    }
  };
import { Bot, HttpError, InputFile } from "grammy";
import { loadConfig } from "../config/config.js";
import { resolveMarkdownTableMode } from "../config/markdown-tables.js";
import { logVerbose } from "../globals.js";
import { recordChannelActivity } from "../infra/channel-activity.js";
import { isDiagnosticFlagEnabled } from "../infra/diagnostic-flags.js";
import { formatErrorMessage, formatUncaughtError } from "../infra/errors.js";
import { createTelegramRetryRunner } from "../infra/retry-policy.js";
import { redactSensitiveText } from "../logging/redact.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { mediaKindFromMime } from "../media/constants.js";
import { isGifMedia } from "../media/mime.js";
import { normalizePollInput } from "../polls.js";
import { loadWebMedia } from "../web/media.js";
import { resolveTelegramAccount } from "./accounts.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";
import { buildTelegramThreadParams } from "./bot/helpers.js";
import { splitTelegramCaption } from "./caption.js";
import { resolveTelegramFetch } from "./fetch.js";
import { renderTelegramHtmlText } from "./format.js";
import { isRecoverableTelegramNetworkError } from "./network-errors.js";
import { makeProxyFetch } from "./proxy.js";
import { recordSentMessage } from "./sent-message-cache.js";
import { parseTelegramTarget, stripTelegramInternalPrefixes } from "./targets.js";
import { resolveTelegramVoiceSend } from "./voice.js";
const PARSE_ERR_RE = /can't parse entities|parse entities|find end of the entity/i;
const THREAD_NOT_FOUND_RE = /400:\s*Bad Request:\s*message thread not found/i;
const MESSAGE_NOT_MODIFIED_RE =
  /400:\s*Bad Request:\s*message is not modified|MESSAGE_NOT_MODIFIED/i;
const CHAT_NOT_FOUND_RE = /400: Bad Request: chat not found/i;
const diagLogger = createSubsystemLogger("telegram/diagnostic");
async function withTelegramHtmlParseFallback(params) {
  try {
    return await params.requestHtml(params.label);
  } catch (err) {
    if (!isTelegramHtmlParseError(err)) {
      throw err;
    }
    if (params.verbose) {
      console.warn(
        `telegram ${params.label} failed with HTML parse error, retrying as plain text: ${formatErrorMessage(err)}`,
      );
    }
    return await params.requestPlain(`${params.label}-plain`);
  }
}
async function withTelegramThreadFallback(params, label, verbose, attempt) {
  try {
    return await attempt(params, label);
  } catch (err) {
    if (!hasMessageThreadIdParam(params) || !isTelegramThreadNotFoundError(err)) {
      throw err;
    }
    if (verbose) {
      console.warn(
        `telegram ${label} failed with message_thread_id, retrying without thread: ${formatErrorMessage(err)}`,
      );
    }
    const retriedParams = removeMessageThreadIdParam(params);
    return await attempt(retriedParams, `${label}-threadless`);
  }
}
export function buildInlineKeyboard(buttons) {
  if (!buttons?.length) {
    return;
  }
  const rows = buttons
    .map((row) =>
      row
        .filter((button) => button?.text && button?.callback_data)
        .map((button) => ({
          text: button.text,
          callback_data: button.callback_data,
          ...(button.style ? { style: button.style } : {}),
        })),
    )
    .filter((row) => row.length > 0);
  if (rows.length === 0) {
    return;
  }
  return { inline_keyboard: rows };
}
export async function sendMessageTelegram(to, text, opts = {}) {
  const { cfg, account, api } = resolveTelegramApiContext(opts);
  const target = parseTelegramTarget(to);
  const chatId = normalizeChatId(target.chatId);
  const mediaUrl = opts.mediaUrl?.trim();
  const replyMarkup = buildInlineKeyboard(opts.buttons);
  const threadParams = buildTelegramThreadReplyParams({
    targetMessageThreadId: target.messageThreadId,
    messageThreadId: opts.messageThreadId,
    chatType: target.chatType,
    replyToMessageId: opts.replyToMessageId,
    quoteText: opts.quoteText,
  });
  const hasThreadParams = Object.keys(threadParams).length > 0;
  const requestWithDiag = createTelegramRequestWithDiag({
    cfg,
    account,
    retry: opts.retry,
    verbose: opts.verbose,
    shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
  });
  const requestWithChatNotFound = createRequestWithChatNotFound({
    requestWithDiag,
    chatId,
    input: to,
  });
  const textMode = opts.textMode ?? "markdown";
  const tableMode = resolveMarkdownTableMode({
    cfg,
    channel: "telegram",
    accountId: account.accountId,
  });
  const renderHtmlText = (value) => renderTelegramHtmlText(value, { textMode, tableMode });
  const linkPreviewEnabled = account.config.linkPreview ?? true;
  const linkPreviewOptions = linkPreviewEnabled ? undefined : { is_disabled: true };
  const sendTelegramText = async (rawText, params, fallbackText) => {
    return await withTelegramThreadFallback(
      params,
      "message",
      opts.verbose,
      async (effectiveParams, label) => {
        const htmlText = renderHtmlText(rawText);
        const baseParams = effectiveParams ? { ...effectiveParams } : {};
        if (linkPreviewOptions) {
          baseParams.link_preview_options = linkPreviewOptions;
        }
        const hasBaseParams = Object.keys(baseParams).length > 0;
        const sendParams = {
          parse_mode: "HTML",
          ...baseParams,
          ...(opts.silent === true ? { disable_notification: true } : {}),
        };
        return await withTelegramHtmlParseFallback({
          label,
          verbose: opts.verbose,
          requestHtml: (retryLabel) =>
            requestWithChatNotFound(
              () => api.sendMessage(chatId, htmlText, sendParams),
              retryLabel,
            ),
          requestPlain: (retryLabel) => {
            const plainParams = hasBaseParams ? baseParams : undefined;
            return requestWithChatNotFound(
              () =>
                plainParams
                  ? api.sendMessage(chatId, fallbackText ?? rawText, plainParams)
                  : api.sendMessage(chatId, fallbackText ?? rawText),
              retryLabel,
            );
          },
        });
      },
    );
  };
  if (mediaUrl) {
    const media = await loadWebMedia(mediaUrl, {
      maxBytes: opts.maxBytes,
      localRoots: opts.mediaLocalRoots,
    });
    const kind = mediaKindFromMime(media.contentType ?? undefined);
    const isGif = isGifMedia({
      contentType: media.contentType,
      fileName: media.fileName,
    });
    const isVideoNote = kind === "video" && opts.asVideoNote === true;
    const fileName = media.fileName ?? (isGif ? "animation.gif" : inferFilename(kind)) ?? "file";
    const file = new InputFile(media.buffer, fileName);
    let caption;
    let followUpText;
    if (isVideoNote) {
      caption = undefined;
      followUpText = text.trim() ? text : undefined;
    } else {
      const split = splitTelegramCaption(text);
      caption = split.caption;
      followUpText = split.followUpText;
    }
    const htmlCaption = caption ? renderHtmlText(caption) : undefined;
    const needsSeparateText = Boolean(followUpText);
    const baseMediaParams = {
      ...(hasThreadParams ? threadParams : {}),
      ...(!needsSeparateText && replyMarkup ? { reply_markup: replyMarkup } : {}),
    };
    const mediaParams = {
      ...(htmlCaption ? { caption: htmlCaption, parse_mode: "HTML" } : {}),
      ...baseMediaParams,
      ...(opts.silent === true ? { disable_notification: true } : {}),
    };
    const sendMedia = async (label, sender) =>
      await withTelegramThreadFallback(
        mediaParams,
        label,
        opts.verbose,
        async (effectiveParams, retryLabel) =>
          requestWithChatNotFound(() => sender(effectiveParams), retryLabel),
      );
    const mediaSender = (() => {
      if (isGif) {
        return {
          label: "animation",
          sender: (effectiveParams) => api.sendAnimation(chatId, file, effectiveParams),
        };
      }
      if (kind === "image") {
        return {
          label: "photo",
          sender: (effectiveParams) => api.sendPhoto(chatId, file, effectiveParams),
        };
      }
      if (kind === "video") {
        if (isVideoNote) {
          return {
            label: "video_note",
            sender: (effectiveParams) => api.sendVideoNote(chatId, file, effectiveParams),
          };
        }
        return {
          label: "video",
          sender: (effectiveParams) => api.sendVideo(chatId, file, effectiveParams),
        };
      }
      if (kind === "audio") {
        const { useVoice } = resolveTelegramVoiceSend({
          wantsVoice: opts.asVoice === true,
          contentType: media.contentType,
          fileName,
          logFallback: logVerbose,
        });
        if (useVoice) {
          return {
            label: "voice",
            sender: (effectiveParams) => api.sendVoice(chatId, file, effectiveParams),
          };
        }
        return {
          label: "audio",
          sender: (effectiveParams) => api.sendAudio(chatId, file, effectiveParams),
        };
      }
      return {
        label: "document",
        sender: (effectiveParams) => api.sendDocument(chatId, file, effectiveParams),
      };
    })();
    const result = await sendMedia(mediaSender.label, mediaSender.sender);
    const mediaMessageId = String(result?.message_id ?? "unknown");
    const resolvedChatId = String(result?.chat?.id ?? chatId);
    if (result?.message_id) {
      recordSentMessage(chatId, result.message_id);
    }
    recordChannelActivity({
      channel: "telegram",
      accountId: account.accountId,
      direction: "outbound",
    });
    if (needsSeparateText && followUpText) {
      const textParams =
        hasThreadParams || replyMarkup
          ? {
              ...threadParams,
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }
          : undefined;
      const textRes = await sendTelegramText(followUpText, textParams);
      return {
        messageId: String(textRes?.message_id ?? mediaMessageId),
        chatId: resolvedChatId,
      };
    }
    return { messageId: mediaMessageId, chatId: resolvedChatId };
  }
  if (!text || !text.trim()) {
    throw new Error("Message must be non-empty for Telegram sends");
  }
  const textParams =
    hasThreadParams || replyMarkup
      ? {
          ...threadParams,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }
      : undefined;
  const res = await sendTelegramText(text, textParams, opts.plainText);
  const messageId = String(res?.message_id ?? "unknown");
  if (res?.message_id) {
    recordSentMessage(chatId, res.message_id);
  }
  recordChannelActivity({
    channel: "telegram",
    accountId: account.accountId,
    direction: "outbound",
  });
  return { messageId, chatId: String(res?.chat?.id ?? chatId) };
}
export async function reactMessageTelegram(chatIdInput, messageIdInput, emoji, opts = {}) {
  const { cfg, account, api } = resolveTelegramApiContext(opts);
  const chatId = normalizeChatId(String(chatIdInput));
  const messageId = normalizeMessageId(messageIdInput);
  const requestWithDiag = createTelegramRequestWithDiag({
    cfg,
    account,
    retry: opts.retry,
    verbose: opts.verbose,
    shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
  });
  const remove = opts.remove === true;
  const trimmedEmoji = emoji.trim();
  const reactions = remove || !trimmedEmoji ? [] : [{ type: "emoji", emoji: trimmedEmoji }];
  if (typeof api.setMessageReaction !== "function") {
    throw new Error("Telegram reactions are unavailable in this bot API.");
  }
  try {
    await requestWithDiag(() => api.setMessageReaction(chatId, messageId, reactions), "reaction");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/REACTION_INVALID/i.test(msg)) {
      return { ok: false, warning: `Reaction unavailable: ${trimmedEmoji}` };
    }
    throw err;
  }
  return { ok: true };
}
export async function deleteMessageTelegram(chatIdInput, messageIdInput, opts = {}) {
  const { cfg, account, api } = resolveTelegramApiContext(opts);
  const chatId = normalizeChatId(String(chatIdInput));
  const messageId = normalizeMessageId(messageIdInput);
  const requestWithDiag = createTelegramRequestWithDiag({
    cfg,
    account,
    retry: opts.retry,
    verbose: opts.verbose,
    shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
  });
  await requestWithDiag(() => api.deleteMessage(chatId, messageId), "deleteMessage");
  logVerbose(`[telegram] Deleted message ${messageId} from chat ${chatId}`);
  return { ok: true };
}
export async function editMessageTelegram(chatIdInput, messageIdInput, text, opts = {}) {
  const { cfg, account, api } = resolveTelegramApiContext({
    ...opts,
    cfg: opts.cfg,
  });
  const chatId = normalizeChatId(String(chatIdInput));
  const messageId = normalizeMessageId(messageIdInput);
  const requestWithDiag = createTelegramRequestWithDiag({
    cfg,
    account,
    retry: opts.retry,
    verbose: opts.verbose,
  });
  const requestWithEditShouldLog = (fn, label, shouldLog) =>
    requestWithDiag(fn, label, shouldLog ? { shouldLog } : undefined);
  const textMode = opts.textMode ?? "markdown";
  const tableMode = resolveMarkdownTableMode({
    cfg,
    channel: "telegram",
    accountId: account.accountId,
  });
  const htmlText = renderTelegramHtmlText(text, { textMode, tableMode });
  const shouldTouchButtons = opts.buttons !== undefined;
  const builtKeyboard = shouldTouchButtons ? buildInlineKeyboard(opts.buttons) : undefined;
  const replyMarkup = shouldTouchButtons ? (builtKeyboard ?? { inline_keyboard: [] }) : undefined;
  const editParams = {
    parse_mode: "HTML",
  };
  if (opts.linkPreview === false) {
    editParams.link_preview_options = { is_disabled: true };
  }
  if (replyMarkup !== undefined) {
    editParams.reply_markup = replyMarkup;
  }
  const plainParams = {};
  if (opts.linkPreview === false) {
    plainParams.link_preview_options = { is_disabled: true };
  }
  if (replyMarkup !== undefined) {
    plainParams.reply_markup = replyMarkup;
  }
  try {
    await withTelegramHtmlParseFallback({
      label: "editMessage",
      verbose: opts.verbose,
      requestHtml: (retryLabel) =>
        requestWithEditShouldLog(
          () => api.editMessageText(chatId, messageId, htmlText, editParams),
          retryLabel,
          (err) => !isTelegramMessageNotModifiedError(err),
        ),
      requestPlain: (retryLabel) =>
        requestWithEditShouldLog(
          () =>
            Object.keys(plainParams).length > 0
              ? api.editMessageText(chatId, messageId, text, plainParams)
              : api.editMessageText(chatId, messageId, text),
          retryLabel,
          (plainErr) => !isTelegramMessageNotModifiedError(plainErr),
        ),
    });
  } catch (err) {
    if (isTelegramMessageNotModifiedError(err)) {
    } else {
      throw err;
    }
  }
  logVerbose(`[telegram] Edited message ${messageId} in chat ${chatId}`);
  return { ok: true, messageId: String(messageId), chatId };
}
export async function sendStickerTelegram(to, fileId, opts = {}) {
  if (!fileId?.trim()) {
    throw new Error("Telegram sticker file_id is required");
  }
  const { cfg, account, api } = resolveTelegramApiContext(opts);
  const target = parseTelegramTarget(to);
  const chatId = normalizeChatId(target.chatId);
  const threadParams = buildTelegramThreadReplyParams({
    targetMessageThreadId: target.messageThreadId,
    messageThreadId: opts.messageThreadId,
    chatType: target.chatType,
    replyToMessageId: opts.replyToMessageId,
  });
  const hasThreadParams = Object.keys(threadParams).length > 0;
  const requestWithDiag = createTelegramRequestWithDiag({
    cfg,
    account,
    retry: opts.retry,
    verbose: opts.verbose,
    useApiErrorLogging: false,
  });
  const requestWithChatNotFound = createRequestWithChatNotFound({
    requestWithDiag,
    chatId,
    input: to,
  });
  const stickerParams = hasThreadParams ? threadParams : undefined;
  const result = await withTelegramThreadFallback(
    stickerParams,
    "sticker",
    opts.verbose,
    async (effectiveParams, label) =>
      requestWithChatNotFound(() => api.sendSticker(chatId, fileId.trim(), effectiveParams), label),
  );
  const messageId = String(result?.message_id ?? "unknown");
  const resolvedChatId = String(result?.chat?.id ?? chatId);
  if (result?.message_id) {
    recordSentMessage(chatId, result.message_id);
  }
  recordChannelActivity({
    channel: "telegram",
    accountId: account.accountId,
    direction: "outbound",
  });
  return { messageId, chatId: resolvedChatId };
}
export async function sendPollTelegram(to, poll, opts = {}) {
  const { cfg, account, api } = resolveTelegramApiContext(opts);
  const target = parseTelegramTarget(to);
  const chatId = normalizeChatId(target.chatId);
  const normalizedPoll = normalizePollInput(poll, { maxOptions: 10 });
  const threadParams = buildTelegramThreadReplyParams({
    targetMessageThreadId: target.messageThreadId,
    messageThreadId: opts.messageThreadId,
    chatType: target.chatType,
    replyToMessageId: opts.replyToMessageId,
  });
  const pollOptions = normalizedPoll.options;
  const requestWithDiag = createTelegramRequestWithDiag({
    cfg,
    account,
    retry: opts.retry,
    verbose: opts.verbose,
    shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
  });
  const requestWithChatNotFound = createRequestWithChatNotFound({
    requestWithDiag,
    chatId,
    input: to,
  });
  const durationSeconds = normalizedPoll.durationSeconds;
  if (durationSeconds === undefined && normalizedPoll.durationHours !== undefined) {
    throw new Error(
      "Telegram poll durationHours is not supported. Use durationSeconds (5-600) instead.",
    );
  }
  if (durationSeconds !== undefined && (durationSeconds < 5 || durationSeconds > 600)) {
    throw new Error("Telegram poll durationSeconds must be between 5 and 600");
  }
  const pollParams = {
    allows_multiple_answers: normalizedPoll.maxSelections > 1,
    is_anonymous: opts.isAnonymous ?? true,
    ...(durationSeconds !== undefined ? { open_period: durationSeconds } : {}),
    ...(Object.keys(threadParams).length > 0 ? threadParams : {}),
    ...(opts.silent === true ? { disable_notification: true } : {}),
  };
  const result = await withTelegramThreadFallback(
    pollParams,
    "poll",
    opts.verbose,
    async (effectiveParams, label) =>
      requestWithChatNotFound(
        () => api.sendPoll(chatId, normalizedPoll.question, pollOptions, effectiveParams),
        label,
      ),
  );
  const messageId = String(result?.message_id ?? "unknown");
  const resolvedChatId = String(result?.chat?.id ?? chatId);
  const pollId = result?.poll?.id;
  if (result?.message_id) {
    recordSentMessage(chatId, result.message_id);
  }
  recordChannelActivity({
    channel: "telegram",
    accountId: account.accountId,
    direction: "outbound",
  });
  return { messageId, chatId: resolvedChatId, pollId };
}
export async function createForumTopicTelegram(chatId, name, opts = {}) {
  if (!name?.trim()) {
    throw new Error("Forum topic name is required");
  }
  const trimmedName = name.trim();
  if (trimmedName.length > 128) {
    throw new Error("Forum topic name must be 128 characters or fewer");
  }
  const cfg = loadConfig();
  const account = resolveTelegramAccount({
    cfg,
    accountId: opts.accountId,
  });
  const token = resolveToken(opts.token, account);
  const target = parseTelegramTarget(chatId);
  const normalizedChatId = normalizeChatId(target.chatId);
  const client = resolveTelegramClientOptions(account);
  const api = opts.api ?? new Bot(token, client ? { client } : undefined).api;
  const request = createTelegramRetryRunner({
    retry: opts.retry,
    configRetry: account.config.retry,
    verbose: opts.verbose,
    shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
  });
  const logHttpError = createTelegramHttpLogger(cfg);
  const requestWithDiag = (fn, label) =>
    withTelegramApiErrorLogging({
      operation: label ?? "request",
      fn: () => request(fn, label),
    }).catch((err) => {
      logHttpError(label ?? "request", err);
      throw err;
    });
  const extra = {};
  if (opts.iconColor != null) {
    extra.icon_color = opts.iconColor;
  }
  if (opts.iconCustomEmojiId?.trim()) {
    extra.icon_custom_emoji_id = opts.iconCustomEmojiId.trim();
  }
  const hasExtra = Object.keys(extra).length > 0;
  const result = await requestWithDiag(
    () => api.createForumTopic(normalizedChatId, trimmedName, hasExtra ? extra : undefined),
    "createForumTopic",
  );
  const topicId = result.message_thread_id;
  recordChannelActivity({
    channel: "telegram",
    accountId: account.accountId,
    direction: "outbound",
  });
  return {
    topicId,
    name: result.name ?? trimmedName,
    chatId: normalizedChatId,
  };
}
