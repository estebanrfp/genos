import { describe, expect, it } from "vitest";
import {
  sanitizeToolCallInputs,
  sanitizeToolUseResultPairing,
  repairToolUseResultPairing,
} from "./session-transcript-repair.js";
describe("sanitizeToolUseResultPairing", () => {
  const buildDuplicateToolResultInput = (opts) => [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
    },
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: "first" }],
      isError: false,
    },
    ...(opts?.middleMessage ? [opts.middleMessage] : []),
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: opts?.secondText ?? "second" }],
      isError: false,
    },
  ];
  it("moves tool results directly after tool calls and inserts missing results", () => {
    const input = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_1", name: "read", arguments: {} },
          { type: "toolCall", id: "call_2", name: "exec", arguments: {} },
        ],
      },
      { role: "user", content: "user message that should come after tool use" },
      {
        role: "toolResult",
        toolCallId: "call_2",
        toolName: "exec",
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
    ];
    const out = sanitizeToolUseResultPairing(input);
    expect(out[0]?.role).toBe("assistant");
    expect(out[1]?.role).toBe("toolResult");
    expect(out[1].toolCallId).toBe("call_1");
    expect(out[2]?.role).toBe("toolResult");
    expect(out[2].toolCallId).toBe("call_2");
    expect(out[3]?.role).toBe("user");
  });
  it("drops duplicate tool results for the same id within a span", () => {
    const input = [...buildDuplicateToolResultInput(), { role: "user", content: "ok" }];
    const out = sanitizeToolUseResultPairing(input);
    expect(out.filter((m) => m.role === "toolResult")).toHaveLength(1);
  });
  it("drops duplicate tool results for the same id across the transcript", () => {
    const input = buildDuplicateToolResultInput({
      middleMessage: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      secondText: "second (duplicate)",
    });
    const out = sanitizeToolUseResultPairing(input);
    const results = out.filter((m) => m.role === "toolResult");
    expect(results).toHaveLength(1);
    expect(results[0]?.toolCallId).toBe("call_1");
  });
  it("drops orphan tool results that do not match any tool call", () => {
    const input = [
      { role: "user", content: "hello" },
      {
        role: "toolResult",
        toolCallId: "call_orphan",
        toolName: "read",
        content: [{ type: "text", text: "orphan" }],
        isError: false,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
      },
    ];
    const out = sanitizeToolUseResultPairing(input);
    expect(out.some((m) => m.role === "toolResult")).toBe(false);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
  it("skips tool call extraction for assistant messages with stopReason 'error'", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_error", name: "exec", arguments: {} }],
        stopReason: "error",
      },
      { role: "user", content: "something went wrong" },
    ];
    const result = repairToolUseResultPairing(input);
    expect(result.added).toHaveLength(0);
    expect(result.messages[0]?.role).toBe("assistant");
    expect(result.messages[1]?.role).toBe("user");
    expect(result.messages).toHaveLength(2);
  });
  it("skips tool call extraction for assistant messages with stopReason 'aborted'", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_aborted", name: "Bash", arguments: {} }],
        stopReason: "aborted",
      },
      { role: "user", content: "retrying after abort" },
    ];
    const result = repairToolUseResultPairing(input);
    expect(result.added).toHaveLength(0);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.role).toBe("assistant");
    expect(result.messages[1]?.role).toBe("user");
  });
  it("still repairs tool results for normal assistant messages with stopReason 'toolUse'", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_normal", name: "read", arguments: {} }],
        stopReason: "toolUse",
      },
      { role: "user", content: "user message" },
    ];
    const result = repairToolUseResultPairing(input);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.toolCallId).toBe("call_normal");
  });
  it("drops orphan tool results that follow an aborted assistant message", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_aborted", name: "exec", arguments: {} }],
        stopReason: "aborted",
      },
      {
        role: "toolResult",
        toolCallId: "call_aborted",
        toolName: "exec",
        content: [{ type: "text", text: "partial result" }],
        isError: false,
      },
      { role: "user", content: "retrying" },
    ];
    const result = repairToolUseResultPairing(input);
    expect(result.droppedOrphanCount).toBe(1);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.role).toBe("assistant");
    expect(result.messages[1]?.role).toBe("user");
    expect(result.added).toHaveLength(0);
  });
});
describe("sanitizeToolCallInputs", () => {
  it("drops tool calls missing input or arguments", () => {
    const input = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read" }],
      },
      { role: "user", content: "hello" },
    ];
    const out = sanitizeToolCallInputs(input);
    expect(out.map((m) => m.role)).toEqual(["user"]);
  });
  it("drops tool calls with missing or blank name/id", () => {
    const input = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_ok", name: "read", arguments: {} },
          { type: "toolCall", id: "call_empty_name", name: "", arguments: {} },
          { type: "toolUse", id: "call_blank_name", name: "   ", input: {} },
          { type: "functionCall", id: "", name: "exec", arguments: {} },
        ],
      },
    ];
    const out = sanitizeToolCallInputs(input);
    const assistant = out[0];
    const toolCalls = Array.isArray(assistant.content)
      ? assistant.content.filter((block) => {
          const type = block.type;
          return typeof type === "string" && ["toolCall", "toolUse", "functionCall"].includes(type);
        })
      : [];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].id).toBe("call_ok");
  });
  it("keeps valid tool calls and preserves text blocks", () => {
    const input = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "before" },
          { type: "toolUse", id: "call_ok", name: "read", input: { path: "a" } },
          { type: "toolCall", id: "call_drop", name: "read" },
        ],
      },
    ];
    const out = sanitizeToolCallInputs(input);
    const assistant = out[0];
    const types = Array.isArray(assistant.content)
      ? assistant.content.map((block) => block.type)
      : [];
    expect(types).toEqual(["text", "toolUse"]);
  });
});
