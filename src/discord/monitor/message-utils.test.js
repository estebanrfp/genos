let asMessage = function (payload) {
  return payload;
};
import { ChannelType } from "@buape/carbon";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fetchRemoteMedia = vi.fn();
const saveMediaBuffer = vi.fn();
vi.mock("../../media/fetch.js", () => ({
  fetchRemoteMedia: (...args) => fetchRemoteMedia(...args),
}));
vi.mock("../../media/store.js", () => ({
  saveMediaBuffer: (...args) => saveMediaBuffer(...args),
}));
vi.mock("../../globals.js", () => ({
  logVerbose: () => {},
}));
const {
  __resetDiscordChannelInfoCacheForTest,
  resolveDiscordChannelInfo,
  resolveDiscordMessageChannelId,
  resolveDiscordMessageText,
  resolveForwardedMediaList,
} = await import("./message-utils.js");
describe("resolveDiscordMessageChannelId", () => {
  it("uses message.channelId when present", () => {
    const channelId = resolveDiscordMessageChannelId({
      message: asMessage({ channelId: " 123 " }),
    });
    expect(channelId).toBe("123");
  });
  it("falls back to message.channel_id", () => {
    const channelId = resolveDiscordMessageChannelId({
      message: asMessage({ channel_id: " 234 " }),
    });
    expect(channelId).toBe("234");
  });
  it("falls back to message.rawData.channel_id", () => {
    const channelId = resolveDiscordMessageChannelId({
      message: asMessage({ rawData: { channel_id: "456" } }),
    });
    expect(channelId).toBe("456");
  });
  it("falls back to eventChannelId and coerces numeric values", () => {
    const channelId = resolveDiscordMessageChannelId({
      message: asMessage({}),
      eventChannelId: 789,
    });
    expect(channelId).toBe("789");
  });
});
describe("resolveForwardedMediaList", () => {
  beforeEach(() => {
    fetchRemoteMedia.mockReset();
    saveMediaBuffer.mockReset();
  });
  it("downloads forwarded attachments", async () => {
    const attachment = {
      id: "att-1",
      url: "https://cdn.discordapp.com/attachments/1/image.png",
      filename: "image.png",
      content_type: "image/png",
    };
    fetchRemoteMedia.mockResolvedValueOnce({
      buffer: Buffer.from("image"),
      contentType: "image/png",
    });
    saveMediaBuffer.mockResolvedValueOnce({
      path: "/tmp/image.png",
      contentType: "image/png",
    });
    const result = await resolveForwardedMediaList(
      asMessage({
        rawData: {
          message_snapshots: [{ message: { attachments: [attachment] } }],
        },
      }),
      512,
    );
    expect(fetchRemoteMedia).toHaveBeenCalledTimes(1);
    expect(fetchRemoteMedia).toHaveBeenCalledWith({
      url: attachment.url,
      filePathHint: attachment.filename,
    });
    expect(saveMediaBuffer).toHaveBeenCalledTimes(1);
    expect(saveMediaBuffer).toHaveBeenCalledWith(expect.any(Buffer), "image/png", "inbound", 512);
    expect(result).toEqual([
      {
        path: "/tmp/image.png",
        contentType: "image/png",
        placeholder: "<media:image>",
      },
    ]);
  });
  it("returns empty when no snapshots are present", async () => {
    const result = await resolveForwardedMediaList(asMessage({}), 512);
    expect(result).toEqual([]);
    expect(fetchRemoteMedia).not.toHaveBeenCalled();
  });
  it("skips snapshots without attachments", async () => {
    const result = await resolveForwardedMediaList(
      asMessage({
        rawData: {
          message_snapshots: [{ message: { content: "hello" } }],
        },
      }),
      512,
    );
    expect(result).toEqual([]);
    expect(fetchRemoteMedia).not.toHaveBeenCalled();
  });
});
describe("resolveDiscordMessageText", () => {
  it("includes forwarded message snapshots in body text", () => {
    const text = resolveDiscordMessageText(
      asMessage({
        content: "",
        rawData: {
          message_snapshots: [
            {
              message: {
                content: "forwarded hello",
                embeds: [],
                attachments: [],
                author: {
                  id: "u2",
                  username: "Bob",
                  discriminator: "0",
                },
              },
            },
          ],
        },
      }),
      { includeForwarded: true },
    );
    expect(text).toContain("[Forwarded message from @Bob]");
    expect(text).toContain("forwarded hello");
  });
});
describe("resolveDiscordChannelInfo", () => {
  beforeEach(() => {
    __resetDiscordChannelInfoCacheForTest();
  });
  it("caches channel lookups between calls", async () => {
    const fetchChannel = vi.fn().mockResolvedValue({
      type: ChannelType.DM,
      name: "dm",
    });
    const client = { fetchChannel };
    const first = await resolveDiscordChannelInfo(client, "cache-channel-1");
    const second = await resolveDiscordChannelInfo(client, "cache-channel-1");
    expect(first).toEqual({
      type: ChannelType.DM,
      name: "dm",
      topic: undefined,
      parentId: undefined,
      ownerId: undefined,
    });
    expect(second).toEqual(first);
    expect(fetchChannel).toHaveBeenCalledTimes(1);
  });
  it("negative-caches missing channels", async () => {
    const fetchChannel = vi.fn().mockResolvedValue(null);
    const client = { fetchChannel };
    const first = await resolveDiscordChannelInfo(client, "missing-channel");
    const second = await resolveDiscordChannelInfo(client, "missing-channel");
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchChannel).toHaveBeenCalledTimes(1);
  });
});
