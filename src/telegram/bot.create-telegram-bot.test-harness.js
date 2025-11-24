import { beforeEach, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
const { sessionStorePath } = vi.hoisted(() => ({
  sessionStorePath: `/tmp/genosos-telegram-${Math.random().toString(16).slice(2)}.json`,
}));
const { loadWebMedia } = vi.hoisted(() => ({
  loadWebMedia: vi.fn(),
}));
export function getLoadWebMediaMock() {
  return loadWebMedia;
}
vi.mock("../web/media.js", () => ({
  loadWebMedia,
}));
const { loadConfig } = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
}));
export function getLoadConfigMock() {
  return loadConfig;
}
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig,
  };
});
vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveStorePath: vi.fn((storePath) => storePath ?? sessionStorePath),
  };
});
const { readChannelAllowFromStore, upsertChannelPairingRequest } = vi.hoisted(() => ({
  readChannelAllowFromStore: vi.fn(async () => []),
  upsertChannelPairingRequest: vi.fn(async () => ({
    code: "PAIRCODE",
    created: true,
  })),
}));
export function getReadChannelAllowFromStoreMock() {
  return readChannelAllowFromStore;
}
export function getUpsertChannelPairingRequestMock() {
  return upsertChannelPairingRequest;
}
vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
}));
const skillCommandsHoisted = vi.hoisted(() => ({
  listSkillCommandsForAgents: vi.fn(() => []),
}));
export const listSkillCommandsForAgents = skillCommandsHoisted.listSkillCommandsForAgents;
vi.mock("../auto-reply/skill-commands.js", () => ({
  listSkillCommandsForAgents,
}));
const systemEventsHoisted = vi.hoisted(() => ({
  enqueueSystemEventSpy: vi.fn(),
}));
export const enqueueSystemEventSpy = systemEventsHoisted.enqueueSystemEventSpy;
vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: enqueueSystemEventSpy,
}));
const sentMessageCacheHoisted = vi.hoisted(() => ({
  wasSentByBot: vi.fn(() => false),
}));
export const wasSentByBot = sentMessageCacheHoisted.wasSentByBot;
vi.mock("./sent-message-cache.js", () => ({
  wasSentByBot,
  recordSentMessage: vi.fn(),
  clearSentMessageCache: vi.fn(),
}));
export const useSpy = vi.fn();
export const middlewareUseSpy = vi.fn();
export const onSpy = vi.fn();
export const stopSpy = vi.fn();
export const commandSpy = vi.fn();
export const botCtorSpy = vi.fn();
export const answerCallbackQuerySpy = vi.fn(async () => {
  return;
});
export const sendChatActionSpy = vi.fn();
export const editMessageTextSpy = vi.fn(async () => ({ message_id: 88 }));
export const setMessageReactionSpy = vi.fn(async () => {
  return;
});
export const setMyCommandsSpy = vi.fn(async () => {
  return;
});
export const getMeSpy = vi.fn(async () => ({
  username: "genosos_bot",
  has_topics_enabled: true,
}));
export const sendMessageSpy = vi.fn(async () => ({ message_id: 77 }));
export const sendAnimationSpy = vi.fn(async () => ({ message_id: 78 }));
export const sendPhotoSpy = vi.fn(async () => ({ message_id: 79 }));
const apiStub = {
  config: { use: useSpy },
  answerCallbackQuery: answerCallbackQuerySpy,
  sendChatAction: sendChatActionSpy,
  editMessageText: editMessageTextSpy,
  setMessageReaction: setMessageReactionSpy,
  setMyCommands: setMyCommandsSpy,
  getMe: getMeSpy,
  sendMessage: sendMessageSpy,
  sendAnimation: sendAnimationSpy,
  sendPhoto: sendPhotoSpy,
};
vi.mock("grammy", () => ({
  Bot: class {
    token;
    options;
    api = apiStub;
    use = middlewareUseSpy;
    on = onSpy;
    stop = stopSpy;
    command = commandSpy;
    catch = vi.fn();
    constructor(token, options) {
      this.token = token;
      this.options = options;
      botCtorSpy(token, options);
    }
  },
  InputFile: class {},
  webhookCallback: vi.fn(),
}));
const sequentializeMiddleware = vi.fn();
export const sequentializeSpy = vi.fn(() => sequentializeMiddleware);
export let sequentializeKey;
vi.mock("@grammyjs/runner", () => ({
  sequentialize: (keyFn) => {
    sequentializeKey = keyFn;
    return sequentializeSpy();
  },
}));
export const throttlerSpy = vi.fn(() => "throttler");
vi.mock("@grammyjs/transformer-throttler", () => ({
  apiThrottler: () => throttlerSpy(),
}));
export const replySpy = vi.fn(async (_ctx, opts) => {
  await opts?.onReplyStart?.();
  return;
});
vi.mock("../auto-reply/reply.js", () => ({
  getReplyFromConfig: replySpy,
  __replySpy: replySpy,
}));
export const getOnHandler = (event) => {
  const handler = onSpy.mock.calls.find((call) => call[0] === event)?.[1];
  if (!handler) {
    throw new Error(`Missing handler for event: ${event}`);
  }
  return handler;
};
export function makeTelegramMessageCtx(params) {
  return {
    message: {
      chat: params.chat,
      from: params.from,
      text: params.text,
      date: params.date ?? 1736380800,
      message_id: params.messageId ?? 42,
      ...(params.messageThreadId === undefined
        ? {}
        : { message_thread_id: params.messageThreadId }),
    },
    me: { username: "genosos_bot" },
    getFile: async () => ({ download: async () => new Uint8Array() }),
  };
}
export function makeForumGroupMessageCtx(params) {
  return makeTelegramMessageCtx({
    chat: {
      id: params?.chatId ?? -1001234567890,
      type: "supergroup",
      title: params?.title ?? "Forum Group",
      is_forum: true,
    },
    from: { id: params?.fromId ?? 12345, username: params?.username ?? "testuser" },
    text: params?.text ?? "hello",
    messageThreadId: params?.threadId,
  });
}
beforeEach(() => {
  resetInboundDedupe();
  loadConfig.mockReset();
  loadConfig.mockReturnValue({
    agents: {
      defaults: {
        envelopeTimezone: "utc",
      },
    },
    channels: {
      telegram: { dmPolicy: "open", allowFrom: ["*"] },
    },
  });
  loadWebMedia.mockReset();
  readChannelAllowFromStore.mockReset();
  readChannelAllowFromStore.mockResolvedValue([]);
  upsertChannelPairingRequest.mockReset();
  upsertChannelPairingRequest.mockResolvedValue({ code: "PAIRCODE", created: true });
  onSpy.mockReset();
  commandSpy.mockReset();
  stopSpy.mockReset();
  useSpy.mockReset();
  replySpy.mockReset();
  replySpy.mockImplementation(async (_ctx, opts) => {
    await opts?.onReplyStart?.();
    return;
  });
  sendAnimationSpy.mockReset();
  sendAnimationSpy.mockResolvedValue({ message_id: 78 });
  sendPhotoSpy.mockReset();
  sendPhotoSpy.mockResolvedValue({ message_id: 79 });
  sendMessageSpy.mockReset();
  sendMessageSpy.mockResolvedValue({ message_id: 77 });
  setMessageReactionSpy.mockReset();
  setMessageReactionSpy.mockResolvedValue(undefined);
  answerCallbackQuerySpy.mockReset();
  answerCallbackQuerySpy.mockResolvedValue(undefined);
  sendChatActionSpy.mockReset();
  sendChatActionSpy.mockResolvedValue(undefined);
  setMyCommandsSpy.mockReset();
  setMyCommandsSpy.mockResolvedValue(undefined);
  getMeSpy.mockReset();
  getMeSpy.mockResolvedValue({
    username: "genosos_bot",
    has_topics_enabled: true,
  });
  editMessageTextSpy.mockReset();
  editMessageTextSpy.mockResolvedValue({ message_id: 88 });
  enqueueSystemEventSpy.mockReset();
  wasSentByBot.mockReset();
  wasSentByBot.mockReturnValue(false);
  listSkillCommandsForAgents.mockReset();
  listSkillCommandsForAgents.mockReturnValue([]);
  middlewareUseSpy.mockReset();
  sequentializeSpy.mockReset();
  botCtorSpy.mockReset();
  sequentializeKey = undefined;
});
