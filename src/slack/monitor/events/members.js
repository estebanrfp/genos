import { danger } from "../../../globals.js";
import { enqueueSystemEvent } from "../../../infra/system-events.js";
import { resolveSlackChannelLabel } from "../channel-config.js";
export function registerSlackMemberEvents(params) {
  const { ctx } = params;
  const handleMemberChannelEvent = async (params) => {
    try {
      if (ctx.shouldDropMismatchedSlackEvent(params.body)) {
        return;
      }
      const payload = params.event;
      const channelId = payload.channel;
      const channelInfo = channelId ? await ctx.resolveChannelName(channelId) : {};
      const channelType = payload.channel_type ?? channelInfo?.type;
      if (
        !ctx.isChannelAllowed({
          channelId,
          channelName: channelInfo?.name,
          channelType,
        })
      ) {
        return;
      }
      const userInfo = payload.user ? await ctx.resolveUserName(payload.user) : {};
      const userLabel = userInfo?.name ?? payload.user ?? "someone";
      const label = resolveSlackChannelLabel({
        channelId,
        channelName: channelInfo?.name,
      });
      const sessionKey = ctx.resolveSlackSystemEventSessionKey({
        channelId,
        channelType,
      });
      enqueueSystemEvent(`Slack: ${userLabel} ${params.verb} ${label}.`, {
        sessionKey,
        contextKey: `slack:member:${params.verb}:${channelId ?? "unknown"}:${payload.user ?? "unknown"}`,
      });
    } catch (err) {
      ctx.runtime.error?.(danger(`slack ${params.verb} handler failed: ${String(err)}`));
    }
  };
  ctx.app.event("member_joined_channel", async ({ event, body }) => {
    await handleMemberChannelEvent({
      verb: "joined",
      event,
      body,
    });
  });
  ctx.app.event("member_left_channel", async ({ event, body }) => {
    await handleMemberChannelEvent({
      verb: "left",
      event,
      body,
    });
  });
}
