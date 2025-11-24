export function createBlockReplyCoalescer(params) {
  const { config, shouldAbort, onFlush } = params;
  const minChars = Math.max(1, Math.floor(config.minChars));
  const maxChars = Math.max(minChars, Math.floor(config.maxChars));
  const idleMs = Math.max(0, Math.floor(config.idleMs));
  const joiner = config.joiner ?? "";
  const flushOnEnqueue = config.flushOnEnqueue === true;
  let bufferText = "";
  let bufferReplyToId;
  let bufferAudioAsVoice;
  let idleTimer;
  const clearIdleTimer = () => {
    if (!idleTimer) {
      return;
    }
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const resetBuffer = () => {
    bufferText = "";
    bufferReplyToId = undefined;
    bufferAudioAsVoice = undefined;
  };
  const scheduleIdleFlush = () => {
    if (idleMs <= 0) {
      return;
    }
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      flush({ force: false });
    }, idleMs);
  };
  const flush = async (options) => {
    clearIdleTimer();
    if (shouldAbort()) {
      resetBuffer();
      return;
    }
    if (!bufferText) {
      return;
    }
    if (!options?.force && !flushOnEnqueue && bufferText.length < minChars) {
      scheduleIdleFlush();
      return;
    }
    const payload = {
      text: bufferText,
      replyToId: bufferReplyToId,
      audioAsVoice: bufferAudioAsVoice,
    };
    resetBuffer();
    await onFlush(payload);
  };
  const enqueue = (payload) => {
    if (shouldAbort()) {
      return;
    }
    const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
    const text = payload.text ?? "";
    const hasText = text.trim().length > 0;
    if (hasMedia) {
      flush({ force: true });
      onFlush(payload);
      return;
    }
    if (!hasText) {
      return;
    }
    if (flushOnEnqueue) {
      if (bufferText) {
        flush({ force: true });
      }
      bufferReplyToId = payload.replyToId;
      bufferAudioAsVoice = payload.audioAsVoice;
      bufferText = text;
      flush({ force: true });
      return;
    }
    const replyToConflict = Boolean(
      bufferText &&
      payload.replyToId &&
      (!bufferReplyToId || bufferReplyToId !== payload.replyToId),
    );
    if (bufferText && (replyToConflict || bufferAudioAsVoice !== payload.audioAsVoice)) {
      flush({ force: true });
    }
    if (!bufferText) {
      bufferReplyToId = payload.replyToId;
      bufferAudioAsVoice = payload.audioAsVoice;
    }
    const nextText = bufferText ? `${bufferText}${joiner}${text}` : text;
    if (nextText.length > maxChars) {
      if (bufferText) {
        flush({ force: true });
        bufferReplyToId = payload.replyToId;
        bufferAudioAsVoice = payload.audioAsVoice;
        if (text.length >= maxChars) {
          onFlush(payload);
          return;
        }
        bufferText = text;
        scheduleIdleFlush();
        return;
      }
      onFlush(payload);
      return;
    }
    bufferText = nextText;
    if (bufferText.length >= maxChars) {
      flush({ force: true });
      return;
    }
    scheduleIdleFlush();
  };
  return {
    enqueue,
    flush,
    hasBuffered: () => Boolean(bufferText),
    stop: () => clearIdleTimer(),
  };
}
