import { describe, expect, it, vi } from "vitest";
import { handleSlackAction } from "./slack-actions.js";
const deleteSlackMessage = vi.fn(async (..._args) => ({}));
const editSlackMessage = vi.fn(async (..._args) => ({}));
const getSlackMemberInfo = vi.fn(async (..._args) => ({}));
const listSlackEmojis = vi.fn(async (..._args) => ({}));
const listSlackPins = vi.fn(async (..._args) => ({}));
const listSlackReactions = vi.fn(async (..._args) => ({}));
const pinSlackMessage = vi.fn(async (..._args) => ({}));
const reactSlackMessage = vi.fn(async (..._args) => ({}));
const readSlackMessages = vi.fn(async (..._args) => ({}));
const removeOwnSlackReactions = vi.fn(async (..._args) => ["thumbsup"]);
const removeSlackReaction = vi.fn(async (..._args) => ({}));
const sendSlackMessage = vi.fn(async (..._args) => ({}));
const unpinSlackMessage = vi.fn(async (..._args) => ({}));
vi.mock("../../slack/actions.js", () => ({
  deleteSlackMessage,
  editSlackMessage,
  getSlackMemberInfo,
  listSlackEmojis,
  listSlackPins,
  listSlackReactions,
  pinSlackMessage,
  reactSlackMessage,
  readSlackMessages,
  removeOwnSlackReactions,
  removeSlackReaction,
  sendSlackMessage,
  unpinSlackMessage,
}));
describe("handleSlackAction", () => {
  it("adds reactions", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await handleSlackAction(
      {
        action: "react",
        channelId: "C1",
        messageId: "123.456",
        emoji: "\u2705",
      },
      cfg,
    );
    expect(reactSlackMessage).toHaveBeenCalledWith("C1", "123.456", "\u2705");
  });
  it("strips channel: prefix for channelId params", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await handleSlackAction(
      {
        action: "react",
        channelId: "channel:C1",
        messageId: "123.456",
        emoji: "\u2705",
      },
      cfg,
    );
    expect(reactSlackMessage).toHaveBeenCalledWith("C1", "123.456", "\u2705");
  });
  it("removes reactions on empty emoji", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await handleSlackAction(
      {
        action: "react",
        channelId: "C1",
        messageId: "123.456",
        emoji: "",
      },
      cfg,
    );
    expect(removeOwnSlackReactions).toHaveBeenCalledWith("C1", "123.456");
  });
  it("removes reactions when remove flag set", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await handleSlackAction(
      {
        action: "react",
        channelId: "C1",
        messageId: "123.456",
        emoji: "\u2705",
        remove: true,
      },
      cfg,
    );
    expect(removeSlackReaction).toHaveBeenCalledWith("C1", "123.456", "\u2705");
  });
  it("rejects removes without emoji", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await expect(
      handleSlackAction(
        {
          action: "react",
          channelId: "C1",
          messageId: "123.456",
          emoji: "",
          remove: true,
        },
        cfg,
      ),
    ).rejects.toThrow(/Emoji is required/);
  });
  it("respects reaction gating", async () => {
    const cfg = {
      channels: { slack: { botToken: "tok", actions: { reactions: false } } },
    };
    await expect(
      handleSlackAction(
        {
          action: "react",
          channelId: "C1",
          messageId: "123.456",
          emoji: "\u2705",
        },
        cfg,
      ),
    ).rejects.toThrow(/Slack reactions are disabled/);
  });
  it("passes threadTs to sendSlackMessage for thread replies", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C123",
        content: "Hello thread",
        threadTs: "1234567890.123456",
      },
      cfg,
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C123", "Hello thread", {
      mediaUrl: undefined,
      threadTs: "1234567890.123456",
      blocks: undefined,
    });
  });
  it("accepts blocks JSON and allows empty content", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C123",
        blocks: JSON.stringify([
          { type: "section", text: { type: "mrkdwn", text: "*Deploy* status" } },
        ]),
      },
      cfg,
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C123", "", {
      mediaUrl: undefined,
      threadTs: undefined,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Deploy* status" } }],
    });
  });
  it("accepts blocks arrays directly", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C123",
        blocks: [{ type: "divider" }],
      },
      cfg,
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C123", "", {
      mediaUrl: undefined,
      threadTs: undefined,
      blocks: [{ type: "divider" }],
    });
  });
  it("rejects invalid blocks JSON", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await expect(
      handleSlackAction(
        {
          action: "sendMessage",
          to: "channel:C123",
          blocks: "{bad-json",
        },
        cfg,
      ),
    ).rejects.toThrow(/blocks must be valid JSON/i);
  });
  it("rejects empty blocks arrays", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await expect(
      handleSlackAction(
        {
          action: "sendMessage",
          to: "channel:C123",
          blocks: "[]",
        },
        cfg,
      ),
    ).rejects.toThrow(/at least one block/i);
  });
  it("requires at least one of content, blocks, or mediaUrl", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await expect(
      handleSlackAction(
        {
          action: "sendMessage",
          to: "channel:C123",
          content: "",
        },
        cfg,
      ),
    ).rejects.toThrow(/requires content, blocks, or mediaUrl/i);
  });
  it("rejects blocks combined with mediaUrl", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await expect(
      handleSlackAction(
        {
          action: "sendMessage",
          to: "channel:C123",
          blocks: [{ type: "divider" }],
          mediaUrl: "https://example.com/image.png",
        },
        cfg,
      ),
    ).rejects.toThrow(/does not support blocks with mediaUrl/i);
  });
  it("passes blocks JSON to editSlackMessage with empty content", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    editSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "editMessage",
        channelId: "C123",
        messageId: "123.456",
        blocks: JSON.stringify([{ type: "section", text: { type: "mrkdwn", text: "Updated" } }]),
      },
      cfg,
    );
    expect(editSlackMessage).toHaveBeenCalledWith("C123", "123.456", "", {
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Updated" } }],
    });
  });
  it("passes blocks arrays to editSlackMessage", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    editSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "editMessage",
        channelId: "C123",
        messageId: "123.456",
        blocks: [{ type: "divider" }],
      },
      cfg,
    );
    expect(editSlackMessage).toHaveBeenCalledWith("C123", "123.456", "", {
      blocks: [{ type: "divider" }],
    });
  });
  it("requires content or blocks for editMessage", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    await expect(
      handleSlackAction(
        {
          action: "editMessage",
          channelId: "C123",
          messageId: "123.456",
          content: "",
        },
        cfg,
      ),
    ).rejects.toThrow(/requires content or blocks/i);
  });
  it("auto-injects threadTs from context when replyToMode=all", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C123",
        content: "Auto-threaded",
      },
      cfg,
      {
        currentChannelId: "C123",
        currentThreadTs: "1111111111.111111",
        replyToMode: "all",
      },
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C123", "Auto-threaded", {
      mediaUrl: undefined,
      threadTs: "1111111111.111111",
      blocks: undefined,
    });
  });
  it("replyToMode=first threads first message then stops", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    const hasRepliedRef = { value: false };
    const context = {
      currentChannelId: "C123",
      currentThreadTs: "1111111111.111111",
      replyToMode: "first",
      hasRepliedRef,
    };
    await handleSlackAction(
      { action: "sendMessage", to: "channel:C123", content: "First" },
      cfg,
      context,
    );
    expect(sendSlackMessage).toHaveBeenLastCalledWith("channel:C123", "First", {
      mediaUrl: undefined,
      threadTs: "1111111111.111111",
      blocks: undefined,
    });
    expect(hasRepliedRef.value).toBe(true);
    await handleSlackAction(
      { action: "sendMessage", to: "channel:C123", content: "Second" },
      cfg,
      context,
    );
    expect(sendSlackMessage).toHaveBeenLastCalledWith("channel:C123", "Second", {
      mediaUrl: undefined,
      threadTs: undefined,
      blocks: undefined,
    });
  });
  it("replyToMode=first marks hasRepliedRef even when threadTs is explicit", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    const hasRepliedRef = { value: false };
    const context = {
      currentChannelId: "C123",
      currentThreadTs: "1111111111.111111",
      replyToMode: "first",
      hasRepliedRef,
    };
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C123",
        content: "Explicit",
        threadTs: "2222222222.222222",
      },
      cfg,
      context,
    );
    expect(sendSlackMessage).toHaveBeenLastCalledWith("channel:C123", "Explicit", {
      mediaUrl: undefined,
      threadTs: "2222222222.222222",
      blocks: undefined,
    });
    expect(hasRepliedRef.value).toBe(true);
    await handleSlackAction(
      { action: "sendMessage", to: "channel:C123", content: "Second" },
      cfg,
      context,
    );
    expect(sendSlackMessage).toHaveBeenLastCalledWith("channel:C123", "Second", {
      mediaUrl: undefined,
      threadTs: undefined,
      blocks: undefined,
    });
  });
  it("replyToMode=first without hasRepliedRef does not thread", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction({ action: "sendMessage", to: "channel:C123", content: "No ref" }, cfg, {
      currentChannelId: "C123",
      currentThreadTs: "1111111111.111111",
      replyToMode: "first",
    });
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C123", "No ref", {
      mediaUrl: undefined,
      threadTs: undefined,
      blocks: undefined,
    });
  });
  it("does not auto-inject threadTs when replyToMode=off", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C123",
        content: "Off mode",
      },
      cfg,
      {
        currentChannelId: "C123",
        currentThreadTs: "1111111111.111111",
        replyToMode: "off",
      },
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C123", "Off mode", {
      mediaUrl: undefined,
      threadTs: undefined,
      blocks: undefined,
    });
  });
  it("does not auto-inject threadTs when sending to different channel", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C999",
        content: "Different channel",
      },
      cfg,
      {
        currentChannelId: "C123",
        currentThreadTs: "1111111111.111111",
        replyToMode: "all",
      },
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C999", "Different channel", {
      mediaUrl: undefined,
      threadTs: undefined,
      blocks: undefined,
    });
  });
  it("explicit threadTs overrides context threadTs", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "channel:C123",
        content: "Explicit thread",
        threadTs: "2222222222.222222",
      },
      cfg,
      {
        currentChannelId: "C123",
        currentThreadTs: "1111111111.111111",
        replyToMode: "all",
      },
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("channel:C123", "Explicit thread", {
      mediaUrl: undefined,
      threadTs: "2222222222.222222",
      blocks: undefined,
    });
  });
  it("handles channel target without prefix when replyToMode=all", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    sendSlackMessage.mockClear();
    await handleSlackAction(
      {
        action: "sendMessage",
        to: "C123",
        content: "No prefix",
      },
      cfg,
      {
        currentChannelId: "C123",
        currentThreadTs: "1111111111.111111",
        replyToMode: "all",
      },
    );
    expect(sendSlackMessage).toHaveBeenCalledWith("C123", "No prefix", {
      mediaUrl: undefined,
      threadTs: "1111111111.111111",
      blocks: undefined,
    });
  });
  it("adds normalized timestamps to readMessages payloads", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    readSlackMessages.mockResolvedValueOnce({
      messages: [{ ts: "1735689600.456", text: "hi" }],
      hasMore: false,
    });
    const result = await handleSlackAction({ action: "readMessages", channelId: "C1" }, cfg);
    const payload = result.details;
    const expectedMs = Math.round(1735689600456);
    expect(payload.messages[0].timestampMs).toBe(expectedMs);
    expect(payload.messages[0].timestampUtc).toBe(new Date(expectedMs).toISOString());
  });
  it("passes threadId through to readSlackMessages", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    readSlackMessages.mockClear();
    readSlackMessages.mockResolvedValueOnce({ messages: [], hasMore: false });
    await handleSlackAction(
      { action: "readMessages", channelId: "C1", threadId: "12345.6789" },
      cfg,
    );
    const opts = readSlackMessages.mock.calls[0]?.[1];
    expect(opts?.threadId).toBe("12345.6789");
  });
  it("adds normalized timestamps to pin payloads", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    listSlackPins.mockResolvedValueOnce([
      {
        type: "message",
        message: { ts: "1735689600.789", text: "pinned" },
      },
    ]);
    const result = await handleSlackAction({ action: "listPins", channelId: "C1" }, cfg);
    const payload = result.details;
    const expectedMs = Math.round(1735689600789);
    expect(payload.pins[0].message?.timestampMs).toBe(expectedMs);
    expect(payload.pins[0].message?.timestampUtc).toBe(new Date(expectedMs).toISOString());
  });
  it("uses user token for reads when available", async () => {
    const cfg = {
      channels: { slack: { botToken: "xoxb-1", userToken: "xoxp-1" } },
    };
    readSlackMessages.mockClear();
    readSlackMessages.mockResolvedValueOnce({ messages: [], hasMore: false });
    await handleSlackAction({ action: "readMessages", channelId: "C1" }, cfg);
    const opts = readSlackMessages.mock.calls[0]?.[1];
    expect(opts?.token).toBe("xoxp-1");
  });
  it("falls back to bot token for reads when user token missing", async () => {
    const cfg = {
      channels: { slack: { botToken: "xoxb-1" } },
    };
    readSlackMessages.mockClear();
    readSlackMessages.mockResolvedValueOnce({ messages: [], hasMore: false });
    await handleSlackAction({ action: "readMessages", channelId: "C1" }, cfg);
    const opts = readSlackMessages.mock.calls[0]?.[1];
    expect(opts?.token).toBeUndefined();
  });
  it("uses bot token for writes when userTokenReadOnly is true", async () => {
    const cfg = {
      channels: { slack: { botToken: "xoxb-1", userToken: "xoxp-1" } },
    };
    sendSlackMessage.mockClear();
    await handleSlackAction({ action: "sendMessage", to: "channel:C1", content: "Hello" }, cfg);
    const opts = sendSlackMessage.mock.calls[0]?.[2];
    expect(opts?.token).toBeUndefined();
  });
  it("allows user token writes when bot token is missing", async () => {
    const cfg = {
      channels: {
        slack: { userToken: "xoxp-1", userTokenReadOnly: false },
      },
    };
    sendSlackMessage.mockClear();
    await handleSlackAction({ action: "sendMessage", to: "channel:C1", content: "Hello" }, cfg);
    const opts = sendSlackMessage.mock.calls[0]?.[2];
    expect(opts?.token).toBe("xoxp-1");
  });
  it("returns all emojis when no limit is provided", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    const emojiMap = { wave: "url1", smile: "url2", heart: "url3" };
    listSlackEmojis.mockResolvedValueOnce({ ok: true, emoji: emojiMap });
    const result = await handleSlackAction({ action: "emojiList" }, cfg);
    const payload = result.details;
    expect(payload.ok).toBe(true);
    expect(Object.keys(payload.emojis.emoji)).toHaveLength(3);
  });
  it("applies limit to emoji-list results", async () => {
    const cfg = { channels: { slack: { botToken: "tok" } } };
    const emojiMap = { wave: "url1", smile: "url2", heart: "url3", fire: "url4", star: "url5" };
    listSlackEmojis.mockResolvedValueOnce({ ok: true, emoji: emojiMap });
    const result = await handleSlackAction({ action: "emojiList", limit: 2 }, cfg);
    const payload = result.details;
    expect(payload.ok).toBe(true);
    const emojiKeys = Object.keys(payload.emojis.emoji);
    expect(emojiKeys).toHaveLength(2);
    expect(emojiKeys.every((k) => k in emojiMap)).toBe(true);
  });
});
