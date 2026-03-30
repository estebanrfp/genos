let normalizeTarget = function (to) {
    const trimmed = to.trim();
    if (!trimmed) {
      throw new Error("Recipient is required for LINE sends");
    }
    let normalized = trimmed
      .replace(/^line:group:/i, "")
      .replace(/^line:room:/i, "")
      .replace(/^line:user:/i, "")
      .replace(/^line:/i, "");
    if (!normalized) {
      throw new Error("Recipient is required for LINE sends");
    }
    return normalized;
  },
  createLineMessagingClient = function (opts) {
    const cfg = loadConfig();
    const account = resolveLineAccount({
      cfg,
      accountId: opts.accountId,
    });
    const token = resolveLineChannelAccessToken(opts.channelAccessToken, account);
    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: token,
    });
    return { account, client };
  },
  createLinePushContext = function (to, opts) {
    const { account, client } = createLineMessagingClient(opts);
    const chatId = normalizeTarget(to);
    return { account, client, chatId };
  },
  createTextMessage = function (text) {
    return { type: "text", text };
  },
  logLineHttpError = function (err, context) {
    if (!err || typeof err !== "object") {
      return;
    }
    const { status, statusText, body } = err;
    if (typeof body === "string") {
      const summary = status ? `${status} ${statusText ?? ""}`.trim() : "unknown status";
      logVerbose(`line: ${context} failed (${summary}): ${body}`);
    }
  };
import { messagingApi } from "@line/bot-sdk";
import { loadConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";
import { recordChannelActivity } from "../infra/channel-activity.js";
import { resolveLineAccount } from "./accounts.js";
import { resolveLineChannelAccessToken } from "./channel-access-token.js";
const userProfileCache = new Map();
const PROFILE_CACHE_TTL_MS = 300000;
export function createImageMessage(originalContentUrl, previewImageUrl) {
  return {
    type: "image",
    originalContentUrl,
    previewImageUrl: previewImageUrl ?? originalContentUrl,
  };
}
export function createLocationMessage(location) {
  return {
    type: "location",
    title: location.title.slice(0, 100),
    address: location.address.slice(0, 100),
    latitude: location.latitude,
    longitude: location.longitude,
  };
}
export async function sendMessageLine(to, text, opts = {}) {
  const cfg = loadConfig();
  const account = resolveLineAccount({
    cfg,
    accountId: opts.accountId,
  });
  const token = resolveLineChannelAccessToken(opts.channelAccessToken, account);
  const chatId = normalizeTarget(to);
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: token,
  });
  const messages = [];
  if (opts.mediaUrl?.trim()) {
    messages.push(createImageMessage(opts.mediaUrl.trim()));
  }
  if (text?.trim()) {
    messages.push(createTextMessage(text.trim()));
  }
  if (messages.length === 0) {
    throw new Error("Message must be non-empty for LINE sends");
  }
  if (opts.replyToken) {
    await client.replyMessage({
      replyToken: opts.replyToken,
      messages,
    });
    recordChannelActivity({
      channel: "line",
      accountId: account.accountId,
      direction: "outbound",
    });
    if (opts.verbose) {
      logVerbose(`line: replied to ${chatId}`);
    }
    return {
      messageId: "reply",
      chatId,
    };
  }
  await client.pushMessage({
    to: chatId,
    messages,
  });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: pushed message to ${chatId}`);
  }
  return {
    messageId: "push",
    chatId,
  };
}
export async function pushMessageLine(to, text, opts = {}) {
  return sendMessageLine(to, text, { ...opts, replyToken: undefined });
}
export async function replyMessageLine(replyToken, messages, opts = {}) {
  const { account, client } = createLineMessagingClient(opts);
  await client.replyMessage({
    replyToken,
    messages,
  });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: replied with ${messages.length} messages`);
  }
}
export async function pushMessagesLine(to, messages, opts = {}) {
  if (messages.length === 0) {
    throw new Error("Message must be non-empty for LINE sends");
  }
  const { account, client, chatId } = createLinePushContext(to, opts);
  await client
    .pushMessage({
      to: chatId,
      messages,
    })
    .catch((err) => {
      logLineHttpError(err, "push message");
      throw err;
    });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: pushed ${messages.length} messages to ${chatId}`);
  }
  return {
    messageId: "push",
    chatId,
  };
}
export function createFlexMessage(altText, contents) {
  return {
    type: "flex",
    altText,
    contents,
  };
}
export async function pushImageMessage(to, originalContentUrl, previewImageUrl, opts = {}) {
  const { account, client, chatId } = createLinePushContext(to, opts);
  const imageMessage = createImageMessage(originalContentUrl, previewImageUrl);
  await client.pushMessage({
    to: chatId,
    messages: [imageMessage],
  });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: pushed image to ${chatId}`);
  }
  return {
    messageId: "push",
    chatId,
  };
}
export async function pushLocationMessage(to, location, opts = {}) {
  const { account, client, chatId } = createLinePushContext(to, opts);
  const locationMessage = createLocationMessage(location);
  await client.pushMessage({
    to: chatId,
    messages: [locationMessage],
  });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: pushed location to ${chatId}`);
  }
  return {
    messageId: "push",
    chatId,
  };
}
export async function pushFlexMessage(to, altText, contents, opts = {}) {
  const { account, client, chatId } = createLinePushContext(to, opts);
  const flexMessage = {
    type: "flex",
    altText: altText.slice(0, 400),
    contents,
  };
  await client
    .pushMessage({
      to: chatId,
      messages: [flexMessage],
    })
    .catch((err) => {
      logLineHttpError(err, "push flex message");
      throw err;
    });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: pushed flex message to ${chatId}`);
  }
  return {
    messageId: "push",
    chatId,
  };
}
export async function pushTemplateMessage(to, template, opts = {}) {
  const { account, client, chatId } = createLinePushContext(to, opts);
  await client.pushMessage({
    to: chatId,
    messages: [template],
  });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: pushed template message to ${chatId}`);
  }
  return {
    messageId: "push",
    chatId,
  };
}
export async function pushTextMessageWithQuickReplies(to, text, quickReplyLabels, opts = {}) {
  const { account, client, chatId } = createLinePushContext(to, opts);
  const message = createTextMessageWithQuickReplies(text, quickReplyLabels);
  await client.pushMessage({
    to: chatId,
    messages: [message],
  });
  recordChannelActivity({
    channel: "line",
    accountId: account.accountId,
    direction: "outbound",
  });
  if (opts.verbose) {
    logVerbose(`line: pushed message with quick replies to ${chatId}`);
  }
  return {
    messageId: "push",
    chatId,
  };
}
export function createQuickReplyItems(labels) {
  const items = labels.slice(0, 13).map((label) => ({
    type: "action",
    action: {
      type: "message",
      label: label.slice(0, 20),
      text: label,
    },
  }));
  return { items };
}
export function createTextMessageWithQuickReplies(text, quickReplyLabels) {
  return {
    type: "text",
    text,
    quickReply: createQuickReplyItems(quickReplyLabels),
  };
}
export async function showLoadingAnimation(chatId, opts = {}) {
  const cfg = loadConfig();
  const account = resolveLineAccount({
    cfg,
    accountId: opts.accountId,
  });
  const token = resolveLineChannelAccessToken(opts.channelAccessToken, account);
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: token,
  });
  try {
    await client.showLoadingAnimation({
      chatId: normalizeTarget(chatId),
      loadingSeconds: opts.loadingSeconds ?? 20,
    });
    logVerbose(`line: showing loading animation to ${chatId}`);
  } catch (err) {
    logVerbose(`line: loading animation failed (non-fatal): ${String(err)}`);
  }
}
export async function getUserProfile(userId, opts = {}) {
  const useCache = opts.useCache ?? true;
  if (useCache) {
    const cached = userProfileCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
      return { displayName: cached.displayName, pictureUrl: cached.pictureUrl };
    }
  }
  const cfg = loadConfig();
  const account = resolveLineAccount({
    cfg,
    accountId: opts.accountId,
  });
  const token = resolveLineChannelAccessToken(opts.channelAccessToken, account);
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: token,
  });
  try {
    const profile = await client.getProfile(userId);
    const result = {
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
    };
    userProfileCache.set(userId, {
      ...result,
      fetchedAt: Date.now(),
    });
    return result;
  } catch (err) {
    logVerbose(`line: failed to fetch profile for ${userId}: ${String(err)}`);
    return null;
  }
}
export async function getUserDisplayName(userId, opts = {}) {
  const profile = await getUserProfile(userId, opts);
  return profile?.displayName ?? userId;
}
