let resolveSlackSendIdentity = function (identity) {
  if (!identity) {
    return;
  }
  const username = identity.name?.trim() || undefined;
  const iconUrl = identity.avatarUrl?.trim() || undefined;
  const rawEmoji = identity.emoji?.trim();
  const iconEmoji = !iconUrl && rawEmoji && /^:[^:\s]+:$/.test(rawEmoji) ? rawEmoji : undefined;
  if (!username && !iconUrl && !iconEmoji) {
    return;
  }
  return { username, iconUrl, iconEmoji };
};
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { sendMessageSlack } from "../../../slack/send.js";
async function applySlackMessageSendingHooks(params) {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("message_sending")) {
    return { cancelled: false, text: params.text };
  }
  const hookResult = await hookRunner.runMessageSending(
    {
      to: params.to,
      content: params.text,
      metadata: {
        threadTs: params.threadTs,
        channelId: params.to,
        ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
      },
    },
    { channelId: "slack", accountId: params.accountId ?? undefined },
  );
  if (hookResult?.cancel) {
    return { cancelled: true, text: params.text };
  }
  return { cancelled: false, text: hookResult?.content ?? params.text };
}
async function sendSlackOutboundMessage(params) {
  const send = params.deps?.sendSlack ?? sendMessageSlack;
  const threadTs =
    params.replyToId ?? (params.threadId != null ? String(params.threadId) : undefined);
  const hookResult = await applySlackMessageSendingHooks({
    to: params.to,
    text: params.text,
    threadTs,
    mediaUrl: params.mediaUrl,
    accountId: params.accountId ?? undefined,
  });
  if (hookResult.cancelled) {
    return {
      channel: "slack",
      messageId: "cancelled-by-hook",
      channelId: params.to,
      meta: { cancelled: true },
    };
  }
  const slackIdentity = resolveSlackSendIdentity(params.identity);
  const result = await send(params.to, hookResult.text, {
    threadTs,
    accountId: params.accountId ?? undefined,
    ...(params.mediaUrl
      ? { mediaUrl: params.mediaUrl, mediaLocalRoots: params.mediaLocalRoots }
      : {}),
    ...(slackIdentity ? { identity: slackIdentity } : {}),
  });
  return { channel: "slack", ...result };
}
export const slackOutbound = {
  deliveryMode: "direct",
  chunker: null,
  textChunkLimit: 4000,
  sendText: async ({ to, text, accountId, deps, replyToId, threadId, identity }) => {
    return await sendSlackOutboundMessage({
      to,
      text,
      accountId,
      deps,
      replyToId,
      threadId,
      identity,
    });
  },
  sendMedia: async ({
    to,
    text,
    mediaUrl,
    mediaLocalRoots,
    accountId,
    deps,
    replyToId,
    threadId,
    identity,
  }) => {
    return await sendSlackOutboundMessage({
      to,
      text,
      mediaUrl,
      mediaLocalRoots,
      accountId,
      deps,
      replyToId,
      threadId,
      identity,
    });
  },
};
