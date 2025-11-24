import { buildDispatchInboundCaptureMock } from "./dispatch-inbound-capture.js";
export function createInboundContextCapture() {
  return { ctx: undefined };
}
export async function buildDispatchInboundContextCapture(importOriginal, capture) {
  const actual = await importOriginal();
  return buildDispatchInboundCaptureMock(actual, (ctx) => {
    capture.ctx = ctx;
  });
}
