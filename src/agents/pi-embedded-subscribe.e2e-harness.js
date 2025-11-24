import { expect } from "vitest";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";
export function createStubSessionHarness() {
  let handler;
  const session = {
    subscribe: (fn) => {
      handler = fn;
      return () => {};
    },
  };
  return { session, emit: (evt) => handler?.(evt) };
}
export function createSubscribedSessionHarness(params) {
  const { sessionExtras, ...subscribeParams } = params;
  const { session, emit } = createStubSessionHarness();
  const mergedSession = Object.assign(session, sessionExtras ?? {});
  const subscription = subscribeEmbeddedPiSession({
    ...subscribeParams,
    session: mergedSession,
  });
  return { emit, session: mergedSession, subscription };
}
export function createParagraphChunkedBlockReplyHarness(params) {
  const onBlockReply = params.onBlockReply ?? (() => {});
  const { emit, subscription } = createSubscribedSessionHarness({
    runId: params.runId ?? "run",
    onBlockReply,
    blockReplyBreak: "message_end",
    blockReplyChunking: {
      ...params.chunking,
      breakPreference: "paragraph",
    },
  });
  return { emit, onBlockReply, subscription };
}
export function extractAgentEventPayloads(calls) {
  return calls
    .map((call) => {
      const first = call?.[0];
      const data = first?.data;
      return data && typeof data === "object" ? data : undefined;
    })
    .filter((value) => Boolean(value));
}
export function extractTextPayloads(calls) {
  return calls
    .map((call) => {
      const payload = call?.[0];
      return typeof payload?.text === "string" ? payload.text : undefined;
    })
    .filter((text) => Boolean(text));
}
export function emitMessageStartAndEndForAssistantText(params) {
  const assistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: params.text }],
  };
  params.emit({ type: "message_start", message: assistantMessage });
  params.emit({ type: "message_end", message: assistantMessage });
}
export function emitAssistantTextDeltaAndEnd(params) {
  params.emit({
    type: "message_update",
    message: { role: "assistant" },
    assistantMessageEvent: {
      type: "text_delta",
      delta: params.text,
    },
  });
  const assistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: params.text }],
  };
  params.emit({ type: "message_end", message: assistantMessage });
}
export function expectFencedChunks(calls, expectedPrefix) {
  expect(calls.length).toBeGreaterThan(1);
  for (const call of calls) {
    const chunk = call[0]?.text;
    expect(typeof chunk === "string" && chunk.startsWith(expectedPrefix)).toBe(true);
    const fenceCount = typeof chunk === "string" ? (chunk.match(/```/g)?.length ?? 0) : 0;
    expect(fenceCount).toBeGreaterThanOrEqual(2);
  }
}
export function expectSingleAgentEventText(calls, text) {
  const payloads = extractAgentEventPayloads(calls);
  expect(payloads).toHaveLength(1);
  expect(payloads[0]?.text).toBe(text);
  expect(payloads[0]?.delta).toBe(text);
}
