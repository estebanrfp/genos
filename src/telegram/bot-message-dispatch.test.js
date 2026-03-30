import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STATE_DIR } from "../config/paths.js";
const createTelegramDraftStream = vi.hoisted(() => vi.fn());
const dispatchReplyWithBufferedBlockDispatcher = vi.hoisted(() => vi.fn());
const deliverReplies = vi.hoisted(() => vi.fn());
const editMessageTelegram = vi.hoisted(() => vi.fn());
vi.mock("./draft-stream.js", () => ({
  createTelegramDraftStream,
}));
vi.mock("../auto-reply/reply/provider-dispatcher.js", () => ({
  dispatchReplyWithBufferedBlockDispatcher,
}));
vi.mock("./bot/delivery.js", () => ({
  deliverReplies,
}));
vi.mock("./send.js", () => ({
  editMessageTelegram,
}));
vi.mock("./sticker-cache.js", () => ({
  cacheSticker: vi.fn(),
  describeStickerImage: vi.fn(),
}));
import { dispatchTelegramMessage } from "./bot-message-dispatch.js";
describe("dispatchTelegramMessage draft streaming", () => {
  beforeEach(() => {
    createTelegramDraftStream.mockReset();
    dispatchReplyWithBufferedBlockDispatcher.mockReset();
    deliverReplies.mockReset();
    editMessageTelegram.mockReset();
  });
  function createDraftStream(messageId) {
    return {
      update: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      messageId: vi.fn().mockReturnValue(messageId),
      clear: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      forceNewMessage: vi.fn(),
    };
  }
  function createContext(overrides) {
    const base = {
      ctxPayload: {},
      primaryCtx: { message: { chat: { id: 123, type: "private" } } },
      msg: {
        chat: { id: 123, type: "private" },
        message_id: 456,
        message_thread_id: 777,
      },
      chatId: 123,
      isGroup: false,
      resolvedThreadId: undefined,
      replyThreadId: 777,
      threadSpec: { id: 777, scope: "dm" },
      historyKey: undefined,
      historyLimit: 0,
      groupHistories: new Map(),
      route: { agentId: "default", accountId: "default" },
      skillFilter: undefined,
      sendTyping: vi.fn(),
      sendRecordVoice: vi.fn(),
      ackReactionPromise: null,
      reactionApi: null,
      removeAckAfterReply: false,
    };
    return {
      ...base,
      ...overrides,
      primaryCtx: {
        ...base.primaryCtx,
        ...(overrides?.primaryCtx ? overrides.primaryCtx : null),
      },
      msg: {
        ...base.msg,
        ...(overrides?.msg ? overrides.msg : null),
      },
      route: {
        ...base.route,
        ...(overrides?.route ? overrides.route : null),
      },
    };
  }
  function createBot() {
    return { api: { sendMessage: vi.fn(), editMessageText: vi.fn() } };
  }
  function createRuntime() {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: () => {
        throw new Error("exit");
      },
    };
  }
  async function dispatchWithContext(params) {
    await dispatchTelegramMessage({
      context: params.context,
      bot: createBot(),
      cfg: {},
      runtime: createRuntime(),
      replyToMode: "first",
      streamMode: params.streamMode ?? "partial",
      textLimit: 4096,
      telegramCfg: params.telegramCfg ?? {},
      opts: { token: "token" },
    });
  }
  it("streams drafts in private threads and forwards thread id", async () => {
    const draftStream = createDraftStream();
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onPartialReply?.({ text: "Hello" });
        await dispatcherOptions.deliver({ text: "Hello" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    const context = createContext({
      route: {
        agentId: "work",
      },
    });
    await dispatchWithContext({ context });
    expect(createTelegramDraftStream).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 123,
        thread: { id: 777, scope: "dm" },
      }),
    );
    expect(draftStream.update).toHaveBeenCalledWith("Hello");
    expect(deliverReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        thread: { id: 777, scope: "dm" },
        mediaLocalRoots: expect.arrayContaining([path.join(STATE_DIR, "workspace-work")]),
      }),
    );
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        replyOptions: expect.objectContaining({
          disableBlockStreaming: true,
        }),
      }),
    );
    expect(editMessageTelegram).not.toHaveBeenCalled();
    expect(draftStream.clear).toHaveBeenCalledTimes(1);
  });
  it("keeps block streaming enabled when account config enables it", async () => {
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "Hello" }, { kind: "final" });
      return { queuedFinal: true };
    });
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({
      context: createContext(),
      telegramCfg: { blockStreaming: true },
    });
    expect(createTelegramDraftStream).not.toHaveBeenCalled();
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        replyOptions: expect.objectContaining({
          disableBlockStreaming: false,
          onPartialReply: undefined,
        }),
      }),
    );
  });
  it("finalizes text-only replies by editing the preview message in place", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onPartialReply?.({ text: "Hel" });
        await dispatcherOptions.deliver({ text: "Hello final" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    editMessageTelegram.mockResolvedValue({ ok: true, chatId: "123", messageId: "999" });
    await dispatchWithContext({ context: createContext() });
    expect(editMessageTelegram).toHaveBeenCalledWith(123, 999, "Hello final", expect.any(Object));
    expect(deliverReplies).not.toHaveBeenCalled();
    expect(draftStream.clear).not.toHaveBeenCalled();
    expect(draftStream.stop).toHaveBeenCalled();
  });
  it("edits the preview message created during stop() final flush", async () => {
    let messageId;
    const draftStream = {
      update: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      messageId: vi.fn().mockImplementation(() => messageId),
      clear: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockImplementation(async () => {
        messageId = 777;
      }),
      forceNewMessage: vi.fn(),
    };
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "Short final" }, { kind: "final" });
      return { queuedFinal: true };
    });
    deliverReplies.mockResolvedValue({ delivered: true });
    editMessageTelegram.mockResolvedValue({ ok: true, chatId: "123", messageId: "777" });
    await dispatchWithContext({ context: createContext() });
    expect(editMessageTelegram).toHaveBeenCalledWith(123, 777, "Short final", expect.any(Object));
    expect(deliverReplies).not.toHaveBeenCalled();
    expect(draftStream.stop).toHaveBeenCalled();
  });
  it("does not overwrite finalized preview when additional final payloads are sent", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "Primary result" }, { kind: "final" });
      await dispatcherOptions.deliver(
        { text: "\u26A0\uFE0F Recovered tool error details" },
        { kind: "final" },
      );
      return { queuedFinal: true };
    });
    deliverReplies.mockResolvedValue({ delivered: true });
    editMessageTelegram.mockResolvedValue({ ok: true, chatId: "123", messageId: "999" });
    await dispatchWithContext({ context: createContext() });
    expect(editMessageTelegram).toHaveBeenCalledTimes(1);
    expect(editMessageTelegram).toHaveBeenCalledWith(
      123,
      999,
      "Primary result",
      expect.any(Object),
    );
    expect(deliverReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: [expect.objectContaining({ text: "\u26A0\uFE0F Recovered tool error details" })],
      }),
    );
    expect(draftStream.clear).not.toHaveBeenCalled();
    expect(draftStream.stop).toHaveBeenCalled();
  });
  it("falls back to normal delivery when preview final is too long to edit", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    const longText = "x".repeat(5000);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: longText }, { kind: "final" });
      return { queuedFinal: true };
    });
    deliverReplies.mockResolvedValue({ delivered: true });
    editMessageTelegram.mockResolvedValue({ ok: true, chatId: "123", messageId: "999" });
    await dispatchWithContext({ context: createContext() });
    expect(editMessageTelegram).not.toHaveBeenCalled();
    expect(deliverReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: [expect.objectContaining({ text: longText })],
      }),
    );
    expect(draftStream.clear).toHaveBeenCalledTimes(1);
    expect(draftStream.stop).toHaveBeenCalled();
  });
  it("disables block streaming when streamMode is off", async () => {
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "Hello" }, { kind: "final" });
      return { queuedFinal: true };
    });
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({
      context: createContext(),
      streamMode: "off",
    });
    expect(createTelegramDraftStream).not.toHaveBeenCalled();
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        replyOptions: expect.objectContaining({
          disableBlockStreaming: true,
        }),
      }),
    );
  });
  it("forces new message when new assistant message starts after previous output", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onPartialReply?.({ text: "First response" });
        await replyOptions?.onAssistantMessageStart?.();
        await replyOptions?.onPartialReply?.({ text: "After tool call" });
        await dispatcherOptions.deliver({ text: "After tool call" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({ context: createContext(), streamMode: "block" });
    expect(draftStream.forceNewMessage).toHaveBeenCalled();
  });
  it("does not force new message in partial mode when assistant message restarts", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onPartialReply?.({ text: "First response" });
        await replyOptions?.onAssistantMessageStart?.();
        await replyOptions?.onPartialReply?.({ text: "After tool call" });
        await dispatcherOptions.deliver({ text: "After tool call" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({ context: createContext(), streamMode: "partial" });
    expect(draftStream.forceNewMessage).not.toHaveBeenCalled();
  });
  it("does not force new message on first assistant message start", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onAssistantMessageStart?.();
        await replyOptions?.onPartialReply?.({ text: "Hello" });
        await replyOptions?.onPartialReply?.({ text: "Hello world" });
        await dispatcherOptions.deliver({ text: "Hello world" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({ context: createContext(), streamMode: "block" });
    expect(draftStream.forceNewMessage).not.toHaveBeenCalled();
  });
  it("forces new message when reasoning ends after previous output", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onPartialReply?.({ text: "Let me check" });
        await replyOptions?.onReasoningStream?.({ text: "Analyzing..." });
        await replyOptions?.onReasoningEnd?.();
        await replyOptions?.onPartialReply?.({ text: "Here's the answer" });
        await dispatcherOptions.deliver({ text: "Here's the answer" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({ context: createContext(), streamMode: "block" });
    expect(draftStream.forceNewMessage).toHaveBeenCalled();
  });
  it("does not force new message in partial mode when reasoning ends", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onPartialReply?.({ text: "Let me check" });
        await replyOptions?.onReasoningEnd?.();
        await replyOptions?.onPartialReply?.({ text: "Here's the answer" });
        await dispatcherOptions.deliver({ text: "Here's the answer" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({ context: createContext(), streamMode: "partial" });
    expect(draftStream.forceNewMessage).not.toHaveBeenCalled();
  });
  it("does not force new message on reasoning end without previous output", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onReasoningStream?.({ text: "Thinking..." });
        await replyOptions?.onReasoningEnd?.();
        await replyOptions?.onPartialReply?.({ text: "Here's my answer" });
        await dispatcherOptions.deliver({ text: "Here's my answer" }, { kind: "final" });
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({ context: createContext(), streamMode: "block" });
    expect(draftStream.forceNewMessage).not.toHaveBeenCalled();
  });
  it("does not edit preview message when final payload is an error", async () => {
    const draftStream = createDraftStream(999);
    createTelegramDraftStream.mockReturnValue(draftStream);
    dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
      async ({ dispatcherOptions, replyOptions }) => {
        await replyOptions?.onPartialReply?.({ text: "Let me check that file" });
        await dispatcherOptions.deliver(
          {
            text: "\u26A0\uFE0F \uD83D\uDEE0\uFE0F Exec: cat /nonexistent failed: No such file",
            isError: true,
          },
          { kind: "final" },
        );
        return { queuedFinal: true };
      },
    );
    deliverReplies.mockResolvedValue({ delivered: true });
    await dispatchWithContext({ context: createContext(), streamMode: "block" });
    expect(editMessageTelegram).not.toHaveBeenCalled();
    expect(deliverReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: [expect.objectContaining({ text: expect.stringContaining("\u26A0\uFE0F") })],
      }),
    );
  });
});
