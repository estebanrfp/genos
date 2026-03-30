let appendToolResultText = function (sm, text) {
    sm.appendMessage(toolCallMessage);
    sm.appendMessage(
      asAppendMessage({
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text }],
        isError: false,
        timestamp: Date.now(),
      }),
    );
  },
  getPersistedMessages = function (sm) {
    return sm
      .getEntries()
      .filter((e) => e.type === "message")
      .map((e) => e.message);
  },
  expectPersistedRoles = function (sm, expectedRoles) {
    const messages = getPersistedMessages(sm);
    expect(messages.map((message) => message.role)).toEqual(expectedRoles);
    return messages;
  },
  getToolResultText = function (messages) {
    const toolResult = messages.find((m) => m.role === "toolResult");
    expect(toolResult).toBeDefined();
    const textBlock = toolResult.content.find((b) => b.type === "text");
    return textBlock.text;
  };
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { installSessionToolResultGuard } from "./session-tool-result-guard.js";
const asAppendMessage = (message) => message;
const toolCallMessage = asAppendMessage({
  role: "assistant",
  content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
});
describe("installSessionToolResultGuard", () => {
  it("inserts synthetic toolResult before non-tool message when pending", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm);
    sm.appendMessage(toolCallMessage);
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [{ type: "text", text: "error" }],
        stopReason: "error",
      }),
    );
    const messages = expectPersistedRoles(sm, ["assistant", "toolResult", "assistant"]);
    const synthetic = messages[1];
    expect(synthetic.toolCallId).toBe("call_1");
    expect(synthetic.isError).toBe(true);
    expect(synthetic.content?.[0]?.text).toContain("missing tool result");
  });
  it("flushes pending tool calls when asked explicitly", () => {
    const sm = SessionManager.inMemory();
    const guard = installSessionToolResultGuard(sm);
    sm.appendMessage(toolCallMessage);
    guard.flushPendingToolResults();
    expectPersistedRoles(sm, ["assistant", "toolResult"]);
  });
  it("does not add synthetic toolResult when a matching one exists", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm);
    sm.appendMessage(toolCallMessage);
    sm.appendMessage(
      asAppendMessage({
        role: "toolResult",
        toolCallId: "call_1",
        content: [{ type: "text", text: "ok" }],
        isError: false,
      }),
    );
    expectPersistedRoles(sm, ["assistant", "toolResult"]);
  });
  it("preserves ordering with multiple tool calls and partial results", () => {
    const sm = SessionManager.inMemory();
    const guard = installSessionToolResultGuard(sm);
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_a", name: "one", arguments: {} },
          { type: "toolUse", id: "call_b", name: "two", arguments: {} },
        ],
      }),
    );
    sm.appendMessage(
      asAppendMessage({
        role: "toolResult",
        toolUseId: "call_a",
        content: [{ type: "text", text: "a" }],
        isError: false,
      }),
    );
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [{ type: "text", text: "after tools" }],
      }),
    );
    const messages = expectPersistedRoles(sm, [
      "assistant",
      "toolResult",
      "toolResult",
      "assistant",
    ]);
    expect(messages[2].toolCallId).toBe("call_b");
    expect(guard.getPendingIds()).toEqual([]);
  });
  it("flushes pending on guard when no toolResult arrived", () => {
    const sm = SessionManager.inMemory();
    const guard = installSessionToolResultGuard(sm);
    sm.appendMessage(toolCallMessage);
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [{ type: "text", text: "hard error" }],
        stopReason: "error",
      }),
    );
    expect(guard.getPendingIds()).toEqual([]);
  });
  it("handles toolUseId on toolResult", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm);
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [{ type: "toolUse", id: "use_1", name: "f", arguments: {} }],
      }),
    );
    sm.appendMessage(
      asAppendMessage({
        role: "toolResult",
        toolUseId: "use_1",
        content: [{ type: "text", text: "ok" }],
      }),
    );
    expectPersistedRoles(sm, ["assistant", "toolResult"]);
  });
  it("drops malformed tool calls missing input before persistence", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm);
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read" }],
      }),
    );
    const messages = getPersistedMessages(sm);
    expect(messages).toHaveLength(0);
  });
  it("flushes pending tool results when a sanitized assistant message is dropped", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm);
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      }),
    );
    sm.appendMessage(
      asAppendMessage({
        role: "assistant",
        content: [{ type: "toolCall", id: "call_2", name: "read" }],
      }),
    );
    expectPersistedRoles(sm, ["assistant", "toolResult"]);
  });
  it("caps oversized tool result text during persistence", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm);
    appendToolResultText(sm, "x".repeat(500000));
    const text = getToolResultText(getPersistedMessages(sm));
    expect(text.length).toBeLessThan(500000);
    expect(text).toContain("truncated");
  });
  it("does not truncate tool results under the limit", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm);
    const originalText = "small tool result";
    appendToolResultText(sm, originalText);
    const text = getToolResultText(getPersistedMessages(sm));
    expect(text).toBe(originalText);
  });
  it("blocks persistence when before_message_write returns block=true", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm, {
      beforeMessageWriteHook: () => ({ block: true }),
    });
    sm.appendMessage(
      asAppendMessage({
        role: "user",
        content: "hidden",
        timestamp: Date.now(),
      }),
    );
    expect(getPersistedMessages(sm)).toHaveLength(0);
  });
  it("applies before_message_write message mutations before persistence", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm, {
      beforeMessageWriteHook: ({ message }) => {
        if (message.role !== "toolResult") {
          return;
        }
        return {
          message: {
            ...message,
            content: [{ type: "text", text: "rewritten by hook" }],
          },
        };
      },
    });
    appendToolResultText(sm, "original");
    const text = getToolResultText(getPersistedMessages(sm));
    expect(text).toBe("rewritten by hook");
  });
  it("applies before_message_write to synthetic tool-result flushes", () => {
    const sm = SessionManager.inMemory();
    const guard = installSessionToolResultGuard(sm, {
      beforeMessageWriteHook: ({ message }) => {
        if (message.role !== "toolResult") {
          return;
        }
        return { block: true };
      },
    });
    sm.appendMessage(toolCallMessage);
    guard.flushPendingToolResults();
    const messages = getPersistedMessages(sm);
    expect(messages.map((m) => m.role)).toEqual(["assistant"]);
  });
  it("applies message persistence transform to user messages", () => {
    const sm = SessionManager.inMemory();
    installSessionToolResultGuard(sm, {
      transformMessageForPersistence: (message) =>
        message.role === "user"
          ? {
              ...message,
              provenance: { kind: "inter_session", sourceTool: "sessions_send" },
            }
          : message,
    });
    sm.appendMessage(
      asAppendMessage({
        role: "user",
        content: "forwarded",
        timestamp: Date.now(),
      }),
    );
    const persisted = sm.getEntries().find((e) => e.type === "message");
    expect(persisted?.message?.role).toBe("user");
    expect(persisted?.message?.provenance).toEqual({
      kind: "inter_session",
      sourceTool: "sessions_send",
    });
  });
});
