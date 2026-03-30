import { vi } from "vitest";
import { buildTelegramMessageContext } from "./bot-message-context.js";
export const baseTelegramMessageContextConfig = {
  agents: { defaults: { model: "anthropic/claude-opus-4-5", workspace: "/tmp/genosos" } },
  channels: { telegram: {} },
  messages: { groupChat: { mentionPatterns: [] } },
};
export async function buildTelegramMessageContextForTest(params) {
  return await buildTelegramMessageContext({
    primaryCtx: {
      message: {
        message_id: 1,
        date: 1700000000,
        text: "hello",
        from: { id: 42, first_name: "Alice" },
        ...params.message,
      },
      me: { id: 7, username: "bot" },
    },
    allMedia: [],
    storeAllowFrom: [],
    options: params.options ?? {},
    bot: {
      api: {
        sendChatAction: vi.fn(),
        setMessageReaction: vi.fn(),
      },
    },
    cfg: baseTelegramMessageContextConfig,
    account: { accountId: "default" },
    historyLimit: 0,
    groupHistories: new Map(),
    dmPolicy: "open",
    allowFrom: [],
    groupAllowFrom: [],
    ackReactionScope: "off",
    logger: { info: vi.fn() },
    resolveGroupActivation:
      params.resolveGroupActivation ??
      (() => {
        return;
      }),
    resolveGroupRequireMention: () => false,
    resolveTelegramGroupConfig: () => ({
      groupConfig: { requireMention: false },
      topicConfig: undefined,
    }),
  });
}
