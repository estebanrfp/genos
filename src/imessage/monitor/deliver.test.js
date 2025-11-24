import { beforeEach, describe, expect, it, vi } from "vitest";
const sendMessageIMessageMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ messageId: "imsg-1" }),
);
const chunkTextWithModeMock = vi.hoisted(() => vi.fn((text) => [text]));
const resolveChunkModeMock = vi.hoisted(() => vi.fn(() => "length"));
const convertMarkdownTablesMock = vi.hoisted(() => vi.fn((text) => text));
const resolveMarkdownTableModeMock = vi.hoisted(() => vi.fn(() => "code"));
vi.mock("../send.js", () => ({
  sendMessageIMessage: (to, message, opts) => sendMessageIMessageMock(to, message, opts),
}));
vi.mock("../../auto-reply/chunk.js", () => ({
  chunkTextWithMode: (text) => chunkTextWithModeMock(text),
  resolveChunkMode: () => resolveChunkModeMock(),
}));
vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));
vi.mock("../../config/markdown-tables.js", () => ({
  resolveMarkdownTableMode: () => resolveMarkdownTableModeMock(),
}));
vi.mock("../../markdown/tables.js", () => ({
  convertMarkdownTables: (text) => convertMarkdownTablesMock(text),
}));
import { deliverReplies } from "./deliver.js";
describe("deliverReplies", () => {
  const runtime = { log: vi.fn(), error: vi.fn() };
  const client = {};
  beforeEach(() => {
    vi.clearAllMocks();
    chunkTextWithModeMock.mockImplementation((text) => [text]);
  });
  it("propagates payload replyToId through all text chunks", async () => {
    chunkTextWithModeMock.mockImplementation((text) => text.split("|"));
    await deliverReplies({
      replies: [{ text: "first|second", replyToId: "reply-1" }],
      target: "chat_id:10",
      client,
      accountId: "default",
      runtime,
      maxBytes: 4096,
      textLimit: 4000,
    });
    expect(sendMessageIMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageIMessageMock).toHaveBeenNthCalledWith(
      1,
      "chat_id:10",
      "first",
      expect.objectContaining({
        client,
        maxBytes: 4096,
        accountId: "default",
        replyToId: "reply-1",
      }),
    );
    expect(sendMessageIMessageMock).toHaveBeenNthCalledWith(
      2,
      "chat_id:10",
      "second",
      expect.objectContaining({
        client,
        maxBytes: 4096,
        accountId: "default",
        replyToId: "reply-1",
      }),
    );
  });
  it("propagates payload replyToId through media sends", async () => {
    await deliverReplies({
      replies: [
        {
          text: "caption",
          mediaUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
          replyToId: "reply-2",
        },
      ],
      target: "chat_id:20",
      client,
      accountId: "acct-2",
      runtime,
      maxBytes: 8192,
      textLimit: 4000,
    });
    expect(sendMessageIMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageIMessageMock).toHaveBeenNthCalledWith(
      1,
      "chat_id:20",
      "caption",
      expect.objectContaining({
        mediaUrl: "https://example.com/a.jpg",
        client,
        maxBytes: 8192,
        accountId: "acct-2",
        replyToId: "reply-2",
      }),
    );
    expect(sendMessageIMessageMock).toHaveBeenNthCalledWith(
      2,
      "chat_id:20",
      "",
      expect.objectContaining({
        mediaUrl: "https://example.com/b.jpg",
        client,
        maxBytes: 8192,
        accountId: "acct-2",
        replyToId: "reply-2",
      }),
    );
  });
});
