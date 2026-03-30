let resolveCurrentVerboseLevel = function (params) {
    if (!params.sessionKey || !params.storePath) {
      return;
    }
    try {
      const store = loadSessionStore(params.storePath);
      const entry = store[params.sessionKey];
      return normalizeVerboseLevel(String(entry?.verboseLevel ?? ""));
    } catch {
      return;
    }
  },
  createVerboseGate = function (params, shouldEmit) {
    const fallbackVerbose =
      normalizeVerboseLevel(String(params.resolvedVerboseLevel ?? "")) ?? "off";
    return () => {
      return shouldEmit(resolveCurrentVerboseLevel(params) ?? fallbackVerbose);
    };
  };
import { loadSessionStore } from "../../config/sessions.js";
import { isAudioFileName } from "../../media/mime.js";
import { normalizeVerboseLevel } from "../thinking.js";
import { scheduleFollowupDrain } from "./queue.js";
const hasAudioMedia = (urls) => Boolean(urls?.some((url) => isAudioFileName(url)));
export const isAudioPayload = (payload) =>
  hasAudioMedia(payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : undefined));
export const createShouldEmitToolResult = (params) => {
  return createVerboseGate(params, (level) => level !== "off");
};
export const createShouldEmitToolOutput = (params) => {
  return createVerboseGate(params, (level) => level === "full");
};
export const finalizeWithFollowup = (value, queueKey, runFollowupTurn) => {
  scheduleFollowupDrain(queueKey, runFollowupTurn);
  return value;
};
export const signalTypingIfNeeded = async (payloads, typingSignals) => {
  const shouldSignalTyping = payloads.some((payload) => {
    const trimmed = payload.text?.trim();
    if (trimmed) {
      return true;
    }
    if (payload.mediaUrl) {
      return true;
    }
    if (payload.mediaUrls && payload.mediaUrls.length > 0) {
      return true;
    }
    return false;
  });
  if (shouldSignalTyping) {
    await typingSignals.signalRunStart();
  }
};
