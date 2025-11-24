import { vi } from "vitest";
export function buildDispatchInboundCaptureMock(actual, setCtx) {
  const dispatchInboundMessage = vi.fn(async (params) => {
    setCtx(params.ctx);
    return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
  });
  return {
    ...actual,
    dispatchInboundMessage,
    dispatchInboundMessageWithDispatcher: dispatchInboundMessage,
    dispatchInboundMessageWithBufferedDispatcher: dispatchInboundMessage,
  };
}
