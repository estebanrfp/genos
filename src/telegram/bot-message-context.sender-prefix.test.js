import { describe, expect, it, vi } from "vitest";
import { buildTelegramMessageContext } from "./bot-message-context.js";
describe("buildTelegramMessageContext sender prefix", () => {
  async function buildCtx(params) {
    return await buildTelegramMessageContext({
      primaryCtx: {
        message: {
          message_id: params.messageId,
          chat: { id: -99, type: "supergroup", title: "Dev Chat" },
          date: 1700000000,
          text: "hello",
          from: { id: 42, first_name: "Alice" },
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
      cfg: {
        agents: { defaults: { model: "anthropic/claude-opus-4-5", workspace: "/tmp/genosos" } },
        channels: { telegram: {} },
        messages: { groupChat: { mentionPatterns: [] } },
      },
      account: { accountId: "default" },
      historyLimit: 0,
      groupHistories: new Map(),
      dmPolicy: "open",
      allowFrom: [],
      groupAllowFrom: [],
      ackReactionScope: "off",
      logger: { info: vi.fn() },
      resolveGroupActivation: () => {
        return;
      },
      resolveGroupRequireMention: () => false,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      }),
    });
  }
  it("prefixes group bodies with sender label", async () => {
    const ctx = await buildCtx({ messageId: 1 });
    expect(ctx).not.toBeNull();
    const body = ctx?.ctxPayload?.Body ?? "";
    expect(body).toContain("Alice (42): hello");
  });
  it("sets MessageSid from message_id", async () => {
    const ctx = await buildCtx({ messageId: 12345 });
    expect(ctx).not.toBeNull();
    expect(ctx?.ctxPayload?.MessageSid).toBe("12345");
  });
  it("respects messageIdOverride option", async () => {
    const ctx = await buildCtx({
      messageId: 12345,
      options: { messageIdOverride: "67890" },
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.ctxPayload?.MessageSid).toBe("67890");
  });
});
