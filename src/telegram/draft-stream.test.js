let createMockDraftApi = function (sendMessageImpl) {
    return {
      sendMessage: vi.fn(sendMessageImpl ?? (async () => ({ message_id: 17 }))),
      editMessageText: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    };
  },
  createForumDraftStream = function (api) {
    return createThreadedDraftStream(api, { id: 99, scope: "forum" });
  },
  createThreadedDraftStream = function (api, thread) {
    return createTelegramDraftStream({
      api,
      chatId: 123,
      thread,
    });
  };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramDraftStream } from "./draft-stream.js";
async function expectInitialForumSend(api, text = "Hello") {
  await vi.waitFor(() =>
    expect(api.sendMessage).toHaveBeenCalledWith(123, text, { message_thread_id: 99 }),
  );
}
describe("createTelegramDraftStream", () => {
  it("sends stream preview message with message_thread_id when provided", async () => {
    const api = createMockDraftApi();
    const stream = createForumDraftStream(api);
    stream.update("Hello");
    await expectInitialForumSend(api);
  });
  it("edits existing stream preview message on subsequent updates", async () => {
    const api = createMockDraftApi();
    const stream = createForumDraftStream(api);
    stream.update("Hello");
    await expectInitialForumSend(api);
    await api.sendMessage.mock.results[0]?.value;
    stream.update("Hello again");
    await stream.flush();
    expect(api.editMessageText).toHaveBeenCalledWith(123, 17, "Hello again");
  });
  it("waits for in-flight updates before final flush edit", async () => {
    let resolveSend;
    const firstSend = new Promise((resolve) => {
      resolveSend = resolve;
    });
    const api = createMockDraftApi(() => firstSend);
    const stream = createForumDraftStream(api);
    stream.update("Hello");
    await vi.waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
    stream.update("Hello final");
    const flushPromise = stream.flush();
    expect(api.editMessageText).not.toHaveBeenCalled();
    resolveSend?.({ message_id: 17 });
    await flushPromise;
    expect(api.editMessageText).toHaveBeenCalledWith(123, 17, "Hello final");
  });
  it("omits message_thread_id for general topic id", async () => {
    const api = createMockDraftApi();
    const stream = createThreadedDraftStream(api, { id: 1, scope: "forum" });
    stream.update("Hello");
    await vi.waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith(123, "Hello", undefined));
  });
  it("includes message_thread_id for dm threads and clears preview on cleanup", async () => {
    const api = createMockDraftApi();
    const stream = createThreadedDraftStream(api, { id: 42, scope: "dm" });
    stream.update("Hello");
    await vi.waitFor(() =>
      expect(api.sendMessage).toHaveBeenCalledWith(123, "Hello", { message_thread_id: 42 }),
    );
    await stream.clear();
    expect(api.deleteMessage).toHaveBeenCalledWith(123, 17);
  });
  it("creates new message after forceNewMessage is called", async () => {
    const api = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({ message_id: 17 })
        .mockResolvedValueOnce({ message_id: 42 }),
      editMessageText: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    };
    const stream = createTelegramDraftStream({
      api,
      chatId: 123,
    });
    stream.update("Hello");
    await stream.flush();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    stream.update("Hello edited");
    await stream.flush();
    expect(api.editMessageText).toHaveBeenCalledWith(123, 17, "Hello edited");
    stream.forceNewMessage();
    stream.update("After thinking");
    await stream.flush();
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenLastCalledWith(123, "After thinking", undefined);
  });
});
describe("draft stream initial message debounce", () => {
  const createMockApi = () => ({
    sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  describe("isFinal has highest priority", () => {
    it("sends immediately on stop() even with 1 character", async () => {
      const api = createMockApi();
      const stream = createTelegramDraftStream({
        api,
        chatId: 123,
        minInitialChars: 30,
      });
      stream.update("Y");
      await stream.stop();
      await stream.flush();
      expect(api.sendMessage).toHaveBeenCalledWith(123, "Y", undefined);
    });
    it("sends immediately on stop() with short sentence", async () => {
      const api = createMockApi();
      const stream = createTelegramDraftStream({
        api,
        chatId: 123,
        minInitialChars: 30,
      });
      stream.update("Ok.");
      await stream.stop();
      await stream.flush();
      expect(api.sendMessage).toHaveBeenCalledWith(123, "Ok.", undefined);
    });
  });
  describe("minInitialChars threshold", () => {
    it("does not send first message below threshold", async () => {
      const api = createMockApi();
      const stream = createTelegramDraftStream({
        api,
        chatId: 123,
        minInitialChars: 30,
      });
      stream.update("Processing");
      await stream.flush();
      expect(api.sendMessage).not.toHaveBeenCalled();
    });
    it("sends first message when reaching threshold", async () => {
      const api = createMockApi();
      const stream = createTelegramDraftStream({
        api,
        chatId: 123,
        minInitialChars: 30,
      });
      stream.update("I am processing your request..");
      await stream.flush();
      expect(api.sendMessage).toHaveBeenCalled();
    });
    it("works with longer text above threshold", async () => {
      const api = createMockApi();
      const stream = createTelegramDraftStream({
        api,
        chatId: 123,
        minInitialChars: 30,
      });
      stream.update("I am processing your request, please wait a moment");
      await stream.flush();
      expect(api.sendMessage).toHaveBeenCalled();
    });
  });
  describe("subsequent updates after first message", () => {
    it("edits normally after first message is sent", async () => {
      const api = createMockApi();
      const stream = createTelegramDraftStream({
        api,
        chatId: 123,
        minInitialChars: 30,
      });
      stream.update("I am processing your request..");
      await stream.flush();
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      stream.update("I am processing your request.. and summarizing");
      await stream.flush();
      expect(api.editMessageText).toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
  describe("default behavior without debounce params", () => {
    it("sends immediately without minInitialChars set (backward compatible)", async () => {
      const api = createMockApi();
      const stream = createTelegramDraftStream({
        api,
        chatId: 123,
      });
      stream.update("Hi");
      await stream.flush();
      expect(api.sendMessage).toHaveBeenCalledWith(123, "Hi", undefined);
    });
  });
});
