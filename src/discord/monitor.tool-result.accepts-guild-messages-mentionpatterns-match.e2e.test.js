let makeRuntime = function () {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: (code) => {
        throw new Error(`exit ${code}`);
      },
    };
  },
  captureNextDispatchCtx = function () {
    let capturedCtx;
    dispatchMock.mockImplementationOnce(async ({ ctx, dispatcher }) => {
      capturedCtx = ctx;
      dispatcher.sendFinalReply({ text: "hi" });
      return { queuedFinal: true, counts: { final: 1 } };
    });
    return () => capturedCtx;
  },
  createDefaultThreadConfig = function () {
    return {
      agents: {
        defaults: {
          model: "anthropic/claude-opus-4-5",
          workspace: "/tmp/genosos",
        },
      },
      session: { store: "/tmp/genosos-sessions.json" },
      messages: { responsePrefix: "PFX" },
      channels: {
        discord: {
          dm: { enabled: true, policy: "open" },
          groupPolicy: "open",
          guilds: { "*": { requireMention: false } },
        },
      },
    };
  },
  createThreadChannel = function (params = {}) {
    return {
      type: ChannelType.GuildText,
      name: "thread-name",
      parentId: "p1",
      parent: { id: "p1", name: "general" },
      isThread: () => true,
      ...(params.includeStarter
        ? {
            fetchStarterMessage: async () => ({
              content: "starter message",
              author: { tag: "Alice#1", username: "Alice" },
              createdTimestamp: Date.now(),
            }),
          }
        : {}),
    };
  },
  createThreadClient = function (params = {}) {
    return {
      fetchChannel:
        params.fetchChannel ??
        vi.fn().mockResolvedValue({
          type: ChannelType.GuildText,
          name: "thread-name",
        }),
      rest: {
        get:
          params.restGet ??
          vi.fn().mockResolvedValue({
            content: "starter message",
            author: { id: "u1", username: "Alice", discriminator: "0001" },
            timestamp: new Date().toISOString(),
          }),
      },
    };
  },
  createThreadEvent = function (messageId, channel) {
    return {
      message: {
        id: messageId,
        content: "thread reply",
        channelId: "t1",
        channel,
        timestamp: new Date().toISOString(),
        type: MessageType.Default,
        attachments: [],
        embeds: [],
        mentionedEveryone: false,
        mentionedUsers: [],
        mentionedRoles: [],
        author: { id: "u2", bot: false, username: "Bob", tag: "Bob#2" },
      },
      author: { id: "u2", bot: false, username: "Bob", tag: "Bob#2" },
      member: { displayName: "Bob" },
      guild: { id: "g1", name: "Guild" },
      guild_id: "g1",
    };
  };
import { ChannelType, MessageType } from "@buape/carbon";
import { Routes } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReplyDispatcherWithTyping } from "../auto-reply/reply/reply-dispatcher.js";
import {
  dispatchMock,
  readAllowFromStoreMock,
  sendMock,
  updateLastRouteMock,
  upsertPairingRequestMock,
} from "./monitor.tool-result.test-harness.js";
import { __resetDiscordChannelInfoCacheForTest } from "./monitor/message-utils.js";
const loadConfigMock = vi.fn();
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: (...args) => loadConfigMock(...args),
  };
});
beforeEach(() => {
  vi.useRealTimers();
  sendMock.mockReset().mockResolvedValue(undefined);
  updateLastRouteMock.mockReset();
  dispatchMock.mockReset().mockImplementation(async (params) => {
    if (
      typeof params === "object" &&
      params !== null &&
      "dispatcher" in params &&
      typeof params.dispatcher === "object" &&
      params.dispatcher !== null &&
      "sendFinalReply" in params.dispatcher &&
      typeof params.dispatcher.sendFinalReply === "function"
    ) {
      params.dispatcher.sendFinalReply({ text: "hi" });
      return { queuedFinal: true, counts: { tool: 0, block: 0, final: 1 } };
    }
    if (
      typeof params === "object" &&
      params !== null &&
      "dispatcherOptions" in params &&
      params.dispatcherOptions
    ) {
      const { dispatcher, markDispatchIdle } = createReplyDispatcherWithTyping(
        params.dispatcherOptions,
      );
      dispatcher.sendFinalReply({ text: "final reply" });
      await dispatcher.waitForIdle();
      markDispatchIdle();
      return { queuedFinal: true, counts: dispatcher.getQueuedCounts() };
    }
    return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
  });
  readAllowFromStoreMock.mockReset().mockResolvedValue([]);
  upsertPairingRequestMock.mockReset().mockResolvedValue({ code: "PAIRCODE", created: true });
  loadConfigMock.mockReset().mockReturnValue({});
  __resetDiscordChannelInfoCacheForTest();
});
const MENTION_PATTERNS_TEST_TIMEOUT_MS = process.platform === "win32" ? 90000 : 60000;
async function createHandler(cfg) {
  const { createDiscordMessageHandler } = await import("./monitor.js");
  return createDiscordMessageHandler({
    cfg,
    discordConfig: cfg.channels?.discord,
    accountId: "default",
    token: "token",
    runtime: makeRuntime(),
    botUserId: "bot-id",
    guildHistories: new Map(),
    historyLimit: 0,
    mediaMaxBytes: 1e4,
    textLimit: 2000,
    replyToMode: "off",
    dmEnabled: true,
    groupDmEnabled: false,
    guildEntries: cfg.channels?.discord?.guilds,
  });
}
describe("discord tool result dispatch", () => {
  it(
    "accepts guild messages when mentionPatterns match",
    async () => {
      const cfg = {
        agents: {
          defaults: {
            model: "anthropic/claude-opus-4-5",
            workspace: "/tmp/genosos",
          },
        },
        session: { store: "/tmp/genosos-sessions.json" },
        channels: {
          discord: {
            dm: { enabled: true, policy: "open" },
            groupPolicy: "open",
            guilds: { "*": { requireMention: true } },
          },
        },
        messages: {
          responsePrefix: "PFX",
          groupChat: { mentionPatterns: ["\\bgenosos\\b"] },
        },
      };
      const handler = await createHandler(cfg);
      const client = {
        fetchChannel: vi.fn().mockResolvedValue({
          type: ChannelType.GuildText,
          name: "general",
        }),
      };
      await handler(
        {
          message: {
            id: "m2",
            content: "genosos: hello",
            channelId: "c1",
            timestamp: new Date().toISOString(),
            type: MessageType.Default,
            attachments: [],
            embeds: [],
            mentionedEveryone: false,
            mentionedUsers: [],
            mentionedRoles: [],
            author: { id: "u1", bot: false, username: "Ada" },
          },
          author: { id: "u1", bot: false, username: "Ada" },
          member: { nickname: "Ada" },
          guild: { id: "g1", name: "Guild" },
          guild_id: "g1",
        },
        client,
      );
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledTimes(1);
    },
    MENTION_PATTERNS_TEST_TIMEOUT_MS,
  );
  it(
    "skips tool results for native slash commands",
    { timeout: MENTION_PATTERNS_TEST_TIMEOUT_MS },
    async () => {
      const { createDiscordNativeCommand } = await import("./monitor.js");
      const cfg = {
        agents: {
          defaults: {
            model: "anthropic/claude-opus-4-5",
            humanDelay: { mode: "off" },
            workspace: "/tmp/genosos",
          },
        },
        session: { store: "/tmp/genosos-sessions.json" },
        channels: {
          discord: { dm: { enabled: true, policy: "open" } },
        },
      };
      const command = createDiscordNativeCommand({
        command: {
          name: "verbose",
          description: "Toggle verbose mode.",
          acceptsArgs: true,
        },
        cfg,
        discordConfig: cfg.channels.discord,
        accountId: "default",
        sessionPrefix: "discord:slash",
        ephemeralDefault: true,
      });
      const reply = vi.fn().mockResolvedValue(undefined);
      const followUp = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        user: { id: "u1", username: "Ada", globalName: "Ada" },
        channel: { type: ChannelType.DM },
        guild: null,
        rawData: { id: "i1" },
        options: { getString: vi.fn().mockReturnValue("on") },
        reply,
        followUp,
      };
      await command.run(interaction);
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(reply).toHaveBeenCalledTimes(1);
      expect(followUp).toHaveBeenCalledTimes(0);
      expect(reply.mock.calls[0]?.[0]?.content).toContain("final");
    },
  );
  it("accepts guild reply-to-bot messages as implicit mentions", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: "anthropic/claude-opus-4-5",
          workspace: "/tmp/genosos",
        },
      },
      session: { store: "/tmp/genosos-sessions.json" },
      channels: {
        discord: {
          dm: { enabled: true, policy: "open" },
          groupPolicy: "open",
          guilds: { "*": { requireMention: true } },
        },
      },
    };
    const handler = await createHandler(cfg);
    const client = {
      fetchChannel: vi.fn().mockResolvedValue({
        type: ChannelType.GuildText,
        name: "general",
      }),
    };
    await handler(
      {
        message: {
          id: "m3",
          content: "following up",
          channelId: "c1",
          timestamp: new Date().toISOString(),
          type: MessageType.Default,
          attachments: [],
          embeds: [],
          mentionedEveryone: false,
          mentionedUsers: [],
          mentionedRoles: [],
          author: { id: "u1", bot: false, username: "Ada" },
          referencedMessage: {
            id: "m2",
            channelId: "c1",
            content: "bot reply",
            timestamp: new Date().toISOString(),
            type: MessageType.Default,
            attachments: [],
            embeds: [],
            mentionedEveryone: false,
            mentionedUsers: [],
            mentionedRoles: [],
            author: { id: "bot-id", bot: true, username: "GenosOS" },
          },
        },
        author: { id: "u1", bot: false, username: "Ada" },
        member: { nickname: "Ada" },
        guild: { id: "g1", name: "Guild" },
        guild_id: "g1",
        channel: { id: "c1", type: ChannelType.GuildText },
        client,
        data: {
          id: "m3",
          content: "following up",
          channel_id: "c1",
          guild_id: "g1",
          type: MessageType.Default,
          mentions: [],
        },
      },
      client,
    );
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const payload = dispatchMock.mock.calls[0]?.[0]?.ctx;
    expect(payload.WasMentioned).toBe(true);
  });
  it("forks thread sessions and injects starter context", async () => {
    const getCapturedCtx = captureNextDispatchCtx();
    const cfg = createDefaultThreadConfig();
    const handler = await createHandler(cfg);
    const threadChannel = createThreadChannel({ includeStarter: true });
    const client = createThreadClient();
    await handler(createThreadEvent("m4", threadChannel), client);
    const capturedCtx = getCapturedCtx();
    expect(capturedCtx?.SessionKey).toBe("agent:default:discord:channel:t1");
    expect(capturedCtx?.ParentSessionKey).toBe("agent:default:discord:channel:p1");
    expect(capturedCtx?.ThreadStarterBody).toContain("starter message");
    expect(capturedCtx?.ThreadLabel).toContain("Discord thread #general");
  });
  it("skips thread starter context when disabled", async () => {
    const getCapturedCtx = captureNextDispatchCtx();
    const cfg = {
      ...createDefaultThreadConfig(),
      channels: {
        discord: {
          dm: { enabled: true, policy: "open" },
          groupPolicy: "open",
          guilds: {
            "*": {
              requireMention: false,
              channels: {
                "*": { includeThreadStarter: false },
              },
            },
          },
        },
      },
    };
    const handler = await createHandler(cfg);
    const threadChannel = createThreadChannel();
    const client = createThreadClient();
    await handler(createThreadEvent("m7", threadChannel), client);
    const capturedCtx = getCapturedCtx();
    expect(capturedCtx?.ThreadStarterBody).toBeUndefined();
  });
  it("treats forum threads as distinct sessions without channel payloads", async () => {
    const getCapturedCtx = captureNextDispatchCtx();
    const cfg = {
      agent: { model: "anthropic/claude-opus-4-5", workspace: "/tmp/genosos" },
      session: { store: "/tmp/genosos-sessions.json" },
      channels: {
        discord: {
          dm: { enabled: true, policy: "open" },
          groupPolicy: "open",
          guilds: { "*": { requireMention: false } },
        },
      },
      routing: { allowFrom: [] },
    };
    const handler = await createHandler(cfg);
    const fetchChannel = vi
      .fn()
      .mockResolvedValueOnce({
        type: ChannelType.PublicThread,
        name: "topic-1",
        parentId: "forum-1",
      })
      .mockResolvedValueOnce({
        type: ChannelType.GuildForum,
        name: "support",
      });
    const restGet = vi.fn().mockResolvedValue({
      content: "starter message",
      author: { id: "u1", username: "Alice", discriminator: "0001" },
      timestamp: new Date().toISOString(),
    });
    const client = createThreadClient({ fetchChannel, restGet });
    await handler(createThreadEvent("m6"), client);
    const capturedCtx = getCapturedCtx();
    expect(capturedCtx?.SessionKey).toBe("agent:default:discord:channel:t1");
    expect(capturedCtx?.ParentSessionKey).toBe("agent:default:discord:channel:forum-1");
    expect(capturedCtx?.ThreadStarterBody).toContain("starter message");
    expect(capturedCtx?.ThreadLabel).toContain("Discord thread #support");
    expect(restGet).toHaveBeenCalledWith(Routes.channelMessage("t1", "t1"));
  });
  it("scopes thread sessions to the routed agent", async () => {
    const getCapturedCtx = captureNextDispatchCtx();
    const cfg = {
      ...createDefaultThreadConfig(),
      bindings: [{ agentId: "support", match: { channel: "discord", guildId: "g1" } }],
    };
    loadConfigMock.mockReturnValue(cfg);
    const handler = await createHandler(cfg);
    const threadChannel = createThreadChannel();
    const client = createThreadClient();
    await handler(createThreadEvent("m5", threadChannel), client);
    const capturedCtx = getCapturedCtx();
    expect(capturedCtx?.SessionKey).toBe("agent:support:discord:channel:t1");
    expect(capturedCtx?.ParentSessionKey).toBe("agent:support:discord:channel:p1");
  });
});
