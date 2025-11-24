let assistantToolCall = function (id) {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "n", arguments: {} }],
  };
};
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { guardSessionManager } from "./session-tool-result-guard-wrapper.js";
import { sanitizeToolUseResultPairing } from "./session-transcript-repair.js";
describe("guardSessionManager integration", () => {
  it("persists synthetic toolResult before subsequent assistant message", () => {
    const sm = guardSessionManager(SessionManager.inMemory());
    const appendMessage = sm.appendMessage.bind(sm);
    appendMessage(assistantToolCall("call_1"));
    appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "followup" }],
    });
    const messages = sm
      .getEntries()
      .filter((e) => e.type === "message")
      .map((e) => e.message);
    expect(messages.map((m) => m.role)).toEqual(["assistant", "toolResult", "assistant"]);
    expect(messages[1].toolCallId).toBe("call_1");
    expect(sanitizeToolUseResultPairing(messages).map((m) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });
});
