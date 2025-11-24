export const MAX_PAYLOAD_BYTES = 26214400;
export const MAX_BUFFERED_BYTES = 52428800;
const DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES = 6291456;
let maxChatHistoryMessagesBytes = DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES;
export const getMaxChatHistoryMessagesBytes = () => maxChatHistoryMessagesBytes;
export const __setMaxChatHistoryMessagesBytesForTest = (value) => {
  if (!process.env.VITEST && true) {
    return;
  }
  if (value === undefined) {
    maxChatHistoryMessagesBytes = DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES;
    return;
  }
  if (Number.isFinite(value) && value > 0) {
    maxChatHistoryMessagesBytes = value;
  }
};
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 1e4;
export const getHandshakeTimeoutMs = () => {
  if (process.env.VITEST && process.env.GENOS_TEST_HANDSHAKE_TIMEOUT_MS) {
    const parsed = Number(process.env.GENOS_TEST_HANDSHAKE_TIMEOUT_MS);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_HANDSHAKE_TIMEOUT_MS;
};
export const TICK_INTERVAL_MS = 30000;
export const HEALTH_REFRESH_INTERVAL_MS = 60000;
export const DEDUPE_TTL_MS = 300000;
export const DEDUPE_MAX = 1000;
