import {
  createReplyPrefixOptions,
  createTypingCallbacks,
  logTypingFailure,
  resolveChannelMediaMaxBytes,
} from "genosos/plugin-sdk";
import {
  classifyMSTeamsSendError,
  formatMSTeamsSendErrorHint,
  formatUnknownError,
} from "./errors.js";
import { renderReplyPayloadsToMessages, sendMSTeamsMessages } from "./messenger.js";
import { getMSTeamsRuntime } from "./runtime.js";
export function createMSTeamsReplyDispatcher(params) {
  const core = getMSTeamsRuntime();
  const sendTypingIndicator = async () => {
    await params.context.sendActivity({ type: "typing" });
  };
  const typingCallbacks = createTypingCallbacks({
    start: sendTypingIndicator,
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.log.debug?.(message),
        channel: "msteams",
        action: "start",
        error: err,
      });
    },
  });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: "msteams",
    accountId: params.accountId,
  });
  const chunkMode = core.channel.text.resolveChunkMode(params.cfg, "msteams");
  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      ...prefixOptions,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(params.cfg, params.agentId),
      deliver: async (payload) => {
        const tableMode = core.channel.text.resolveMarkdownTableMode({
          cfg: params.cfg,
          channel: "msteams",
        });
        const messages = renderReplyPayloadsToMessages([payload], {
          textChunkLimit: params.textLimit,
          chunkText: true,
          mediaMode: "split",
          tableMode,
          chunkMode,
        });
        const mediaMaxBytes = resolveChannelMediaMaxBytes({
          cfg: params.cfg,
          resolveChannelLimitMb: ({ cfg }) => cfg.channels?.msteams?.mediaMaxMb,
        });
        const ids = await sendMSTeamsMessages({
          replyStyle: params.replyStyle,
          adapter: params.adapter,
          appId: params.appId,
          conversationRef: params.conversationRef,
          context: params.context,
          messages,
          retry: {},
          onRetry: (event) => {
            params.log.debug?.("retrying send", {
              replyStyle: params.replyStyle,
              ...event,
            });
          },
          tokenProvider: params.tokenProvider,
          sharePointSiteId: params.sharePointSiteId,
          mediaMaxBytes,
        });
        if (ids.length > 0) {
          params.onSentMessageIds?.(ids);
        }
      },
      onError: (err, info) => {
        const errMsg = formatUnknownError(err);
        const classification = classifyMSTeamsSendError(err);
        const hint = formatMSTeamsSendErrorHint(classification);
        params.runtime.error?.(
          `msteams ${info.kind} reply failed: ${errMsg}${hint ? ` (${hint})` : ""}`,
        );
        params.log.error("reply failed", {
          kind: info.kind,
          error: errMsg,
          classification,
          hint,
        });
      },
      onReplyStart: typingCallbacks.onReplyStart,
    });
  return {
    dispatcher,
    replyOptions: { ...replyOptions, onModelSelected },
    markDispatchIdle,
  };
}
