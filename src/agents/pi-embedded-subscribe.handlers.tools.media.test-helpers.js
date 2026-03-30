let asFullContext = function (ctx) {
  return ctx;
};
import {
  handleToolExecutionEnd,
  handleToolExecutionStart,
} from "./pi-embedded-subscribe.handlers.tools.js";
export function callToolExecutionStart(ctx, evt) {
  return handleToolExecutionStart(asFullContext(ctx), evt);
}
export function callToolExecutionEnd(ctx, evt) {
  return handleToolExecutionEnd(asFullContext(ctx), evt);
}
export function isDirectMediaCall(call) {
  const arg = call[0];
  if (!arg || typeof arg !== "object") {
    return false;
  }
  return "mediaUrls" in arg && !("text" in arg);
}
export function filterDirectMediaCalls(mock) {
  return mock.mock.calls.filter(isDirectMediaCall);
}
