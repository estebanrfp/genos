let getHumanDelay = function (config) {
    const mode = config?.mode ?? "off";
    if (mode === "off") {
      return 0;
    }
    const min =
      mode === "custom"
        ? (config?.minMs ?? DEFAULT_HUMAN_DELAY_MIN_MS)
        : DEFAULT_HUMAN_DELAY_MIN_MS;
    const max =
      mode === "custom"
        ? (config?.maxMs ?? DEFAULT_HUMAN_DELAY_MAX_MS)
        : DEFAULT_HUMAN_DELAY_MAX_MS;
    if (max <= min) {
      return min;
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  normalizeReplyPayloadInternal = function (payload, opts) {
    const prefixContext = opts.responsePrefixContextProvider?.() ?? opts.responsePrefixContext;
    return normalizeReplyPayload(payload, {
      responsePrefix: opts.responsePrefix,
      responsePrefixContext: prefixContext,
      onHeartbeatStrip: opts.onHeartbeatStrip,
      onSkip: opts.onSkip,
    });
  };
import { sleep } from "../../utils.js";
import { registerDispatcher } from "./dispatcher-registry.js";
import { normalizeReplyPayload } from "./normalize-reply.js";
const DEFAULT_HUMAN_DELAY_MIN_MS = 800;
const DEFAULT_HUMAN_DELAY_MAX_MS = 2500;
export function createReplyDispatcher(options) {
  let sendChain = Promise.resolve();
  let pending = 1;
  let completeCalled = false;
  let sentFirstBlock = false;
  const queuedCounts = {
    tool: 0,
    block: 0,
    final: 0,
  };
  const { unregister } = registerDispatcher({
    pending: () => pending,
    waitForIdle: () => sendChain,
  });
  const enqueue = (kind, payload) => {
    const normalized = normalizeReplyPayloadInternal(payload, {
      responsePrefix: options.responsePrefix,
      responsePrefixContext: options.responsePrefixContext,
      responsePrefixContextProvider: options.responsePrefixContextProvider,
      onHeartbeatStrip: options.onHeartbeatStrip,
      onSkip: (reason) => options.onSkip?.(payload, { kind, reason }),
    });
    if (!normalized) {
      return false;
    }
    queuedCounts[kind] += 1;
    pending += 1;
    const shouldDelay = kind === "block" && sentFirstBlock;
    if (kind === "block") {
      sentFirstBlock = true;
    }
    sendChain = sendChain
      .then(async () => {
        if (shouldDelay) {
          const delayMs = getHumanDelay(options.humanDelay);
          if (delayMs > 0) {
            await sleep(delayMs);
          }
        }
        await options.deliver(normalized, { kind });
      })
      .catch((err) => {
        options.onError?.(err, { kind });
      })
      .finally(() => {
        pending -= 1;
        if (pending === 1 && completeCalled) {
          pending -= 1;
        }
        if (pending === 0) {
          unregister();
          options.onIdle?.();
        }
      });
    return true;
  };
  const markComplete = () => {
    if (completeCalled) {
      return;
    }
    completeCalled = true;
    Promise.resolve().then(() => {
      if (pending === 1 && completeCalled) {
        pending -= 1;
        if (pending === 0) {
          unregister();
          options.onIdle?.();
        }
      }
    });
  };
  return {
    sendToolResult: (payload) => enqueue("tool", payload),
    sendBlockReply: (payload) => enqueue("block", payload),
    sendFinalReply: (payload) => enqueue("final", payload),
    waitForIdle: () => sendChain,
    getQueuedCounts: () => ({ ...queuedCounts }),
    markComplete,
  };
}
export function createReplyDispatcherWithTyping(options) {
  const { onReplyStart, onIdle, onCleanup, ...dispatcherOptions } = options;
  let typingController;
  const dispatcher = createReplyDispatcher({
    ...dispatcherOptions,
    onIdle: () => {
      typingController?.markDispatchIdle();
      onIdle?.();
    },
  });
  return {
    dispatcher,
    replyOptions: {
      onReplyStart,
      onTypingCleanup: onCleanup,
      onTypingController: (typing) => {
        typingController = typing;
      },
    },
    markDispatchIdle: () => {
      typingController?.markDispatchIdle();
      onIdle?.();
    },
  };
}
