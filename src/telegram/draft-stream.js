import { createDraftStreamLoop } from "../channels/draft-stream-loop.js";
import { buildTelegramThreadParams } from "./bot/helpers.js";
const TELEGRAM_STREAM_MAX_CHARS = 4096;
const DEFAULT_THROTTLE_MS = 1000;
export function createTelegramDraftStream(params) {
  const maxChars = Math.min(
    params.maxChars ?? TELEGRAM_STREAM_MAX_CHARS,
    TELEGRAM_STREAM_MAX_CHARS,
  );
  const throttleMs = Math.max(250, params.throttleMs ?? DEFAULT_THROTTLE_MS);
  const minInitialChars = params.minInitialChars;
  const chatId = params.chatId;
  const threadParams = buildTelegramThreadParams(params.thread);
  const replyParams =
    params.replyToMessageId != null
      ? { ...threadParams, reply_to_message_id: params.replyToMessageId }
      : threadParams;
  let streamMessageId;
  let lastSentText = "";
  let stopped = false;
  let isFinal = false;
  const sendOrEditStreamMessage = async (text) => {
    if (stopped && !isFinal) {
      return false;
    }
    const trimmed = text.trimEnd();
    if (!trimmed) {
      return false;
    }
    if (trimmed.length > maxChars) {
      stopped = true;
      params.warn?.(
        `telegram stream preview stopped (text length ${trimmed.length} > ${maxChars})`,
      );
      return false;
    }
    if (trimmed === lastSentText) {
      return true;
    }
    if (typeof streamMessageId !== "number" && minInitialChars != null && !isFinal) {
      if (trimmed.length < minInitialChars) {
        return false;
      }
    }
    lastSentText = trimmed;
    try {
      if (typeof streamMessageId === "number") {
        await params.api.editMessageText(chatId, streamMessageId, trimmed);
        return true;
      }
      const sent = await params.api.sendMessage(chatId, trimmed, replyParams);
      const sentMessageId = sent?.message_id;
      if (typeof sentMessageId !== "number" || !Number.isFinite(sentMessageId)) {
        stopped = true;
        params.warn?.("telegram stream preview stopped (missing message id from sendMessage)");
        return false;
      }
      streamMessageId = Math.trunc(sentMessageId);
      return true;
    } catch (err) {
      stopped = true;
      params.warn?.(
        `telegram stream preview failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  };
  const loop = createDraftStreamLoop({
    throttleMs,
    isStopped: () => stopped,
    sendOrEditStreamMessage,
  });
  const update = (text) => {
    if (stopped || isFinal) {
      return;
    }
    loop.update(text);
  };
  const stop = async () => {
    isFinal = true;
    await loop.flush();
  };
  const clear = async () => {
    stopped = true;
    loop.stop();
    await loop.waitForInFlight();
    const messageId = streamMessageId;
    streamMessageId = undefined;
    if (typeof messageId !== "number") {
      return;
    }
    try {
      await params.api.deleteMessage(chatId, messageId);
    } catch (err) {
      params.warn?.(
        `telegram stream preview cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const forceNewMessage = () => {
    streamMessageId = undefined;
    lastSentText = "";
    loop.resetPending();
  };
  params.log?.(`telegram stream preview ready (maxChars=${maxChars}, throttleMs=${throttleMs})`);
  return {
    update,
    flush: loop.flush,
    messageId: () => streamMessageId,
    clear,
    stop,
    forceNewMessage,
  };
}
