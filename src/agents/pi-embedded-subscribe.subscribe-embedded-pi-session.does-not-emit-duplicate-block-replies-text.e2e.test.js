import { describe, expect, it, vi } from "vitest";
import { createStubSessionHarness } from "./pi-embedded-subscribe.e2e-harness.js";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";
describe("subscribeEmbeddedPiSession", () => {
  it("does not emit duplicate block replies when text_end repeats", () => {
    const { session, emit } = createStubSessionHarness();
    const onBlockReply = vi.fn();
    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
      onBlockReply,
      blockReplyBreak: "text_end",
    });
    emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello block",
      },
    });
    emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_end",
      },
    });
    emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_end",
      },
    });
    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(subscription.assistantTexts).toEqual(["Hello block"]);
  });
  it("does not duplicate assistantTexts when message_end repeats", () => {
    const { session, emit } = createStubSessionHarness();
    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
    });
    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
    };
    emit({ type: "message_end", message: assistantMessage });
    emit({ type: "message_end", message: assistantMessage });
    expect(subscription.assistantTexts).toEqual(["Hello world"]);
  });
  it("does not duplicate assistantTexts when message_end repeats with trailing whitespace changes", () => {
    const { session, emit } = createStubSessionHarness();
    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
    });
    const assistantMessageWithNewline = {
      role: "assistant",
      content: [{ type: "text", text: "Hello world\n" }],
    };
    const assistantMessageTrimmed = {
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
    };
    emit({ type: "message_end", message: assistantMessageWithNewline });
    emit({ type: "message_end", message: assistantMessageTrimmed });
    expect(subscription.assistantTexts).toEqual(["Hello world"]);
  });
  it("does not duplicate assistantTexts when message_end repeats with reasoning blocks", () => {
    const { session, emit } = createStubSessionHarness();
    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
      reasoningMode: "on",
    });
    const assistantMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Because" },
        { type: "text", text: "Hello world" },
      ],
    };
    emit({ type: "message_end", message: assistantMessage });
    emit({ type: "message_end", message: assistantMessage });
    expect(subscription.assistantTexts).toEqual(["Hello world"]);
  });
  it("populates assistantTexts for non-streaming models with chunking enabled", () => {
    const { session, emit } = createStubSessionHarness();
    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
      blockReplyChunking: { minChars: 50, maxChars: 200 },
    });
    emit({ type: "message_start", message: { role: "assistant" } });
    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Response from non-streaming model" }],
    };
    emit({ type: "message_end", message: assistantMessage });
    expect(subscription.assistantTexts).toEqual(["Response from non-streaming model"]);
  });
});
