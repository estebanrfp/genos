let makeMessage = function (id, size) {
    return {
      role: "user",
      content: "x".repeat(size),
      timestamp: id,
    };
  },
  makeMessages = function (count, size) {
    return Array.from({ length: count }, (_, index) => makeMessage(index + 1, size));
  },
  pruneLargeSimpleHistory = function () {
    const messages = makeMessages(4, 4000);
    const maxContextTokens = 2000;
    const pruned = pruneHistoryForContextShare({
      messages,
      maxContextTokens,
      maxHistoryShare: 0.5,
      parts: 2,
    });
    return { messages, pruned, maxContextTokens };
  };
import { describe, expect, it } from "vitest";
import {
  estimateMessagesTokens,
  pruneHistoryForContextShare,
  splitMessagesByTokenShare,
} from "./compaction.js";
describe("splitMessagesByTokenShare", () => {
  it("splits messages into two non-empty parts", () => {
    const messages = makeMessages(4, 4000);
    const parts = splitMessagesByTokenShare(messages, 2);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]?.length).toBeGreaterThan(0);
    expect(parts[1]?.length).toBeGreaterThan(0);
    expect(parts.flat().length).toBe(messages.length);
  });
  it("preserves message order across parts", () => {
    const messages = makeMessages(6, 4000);
    const parts = splitMessagesByTokenShare(messages, 3);
    expect(parts.flat().map((msg) => msg.timestamp)).toEqual(messages.map((msg) => msg.timestamp));
  });
});
describe("pruneHistoryForContextShare", () => {
  it("drops older chunks until the history budget is met", () => {
    const { pruned, maxContextTokens } = pruneLargeSimpleHistory();
    expect(pruned.droppedChunks).toBeGreaterThan(0);
    expect(pruned.keptTokens).toBeLessThanOrEqual(Math.floor(maxContextTokens * 0.5));
    expect(pruned.messages.length).toBeGreaterThan(0);
  });
  it("keeps the newest messages when pruning", () => {
    const messages = makeMessages(6, 4000);
    const totalTokens = estimateMessagesTokens(messages);
    const maxContextTokens = Math.max(1, Math.floor(totalTokens * 0.5));
    const pruned = pruneHistoryForContextShare({
      messages,
      maxContextTokens,
      maxHistoryShare: 0.5,
      parts: 2,
    });
    const keptIds = pruned.messages.map((msg) => msg.timestamp);
    const expectedSuffix = messages.slice(-keptIds.length).map((msg) => msg.timestamp);
    expect(keptIds).toEqual(expectedSuffix);
  });
  it("keeps history when already within budget", () => {
    const messages = [makeMessage(1, 1000)];
    const maxContextTokens = 2000;
    const pruned = pruneHistoryForContextShare({
      messages,
      maxContextTokens,
      maxHistoryShare: 0.5,
      parts: 2,
    });
    expect(pruned.droppedChunks).toBe(0);
    expect(pruned.messages.length).toBe(messages.length);
    expect(pruned.keptTokens).toBe(estimateMessagesTokens(messages));
    expect(pruned.droppedMessagesList).toEqual([]);
  });
  it("returns droppedMessagesList containing dropped messages", () => {
    const { messages, pruned } = pruneLargeSimpleHistory();
    expect(pruned.droppedChunks).toBeGreaterThan(0);
    expect(pruned.droppedMessagesList.length).toBe(pruned.droppedMessages);
    const allIds = [
      ...pruned.droppedMessagesList.map((m) => m.timestamp),
      ...pruned.messages.map((m) => m.timestamp),
    ].toSorted((a, b) => a - b);
    const originalIds = messages.map((m) => m.timestamp).toSorted((a, b) => a - b);
    expect(allIds).toEqual(originalIds);
  });
  it("returns empty droppedMessagesList when no pruning needed", () => {
    const messages = [makeMessage(1, 100)];
    const pruned = pruneHistoryForContextShare({
      messages,
      maxContextTokens: 1e5,
      maxHistoryShare: 0.5,
      parts: 2,
    });
    expect(pruned.droppedChunks).toBe(0);
    expect(pruned.droppedMessagesList).toEqual([]);
    expect(pruned.messages.length).toBe(1);
  });
  it("removes orphaned tool_result messages when tool_use is dropped", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "x".repeat(4000) },
          { type: "toolCall", id: "call_123", name: "test_tool", arguments: {} },
        ],
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "call_123",
        toolName: "test_tool",
        content: [{ type: "text", text: "result".repeat(500) }],
        timestamp: 2,
      },
      {
        role: "user",
        content: "x".repeat(500),
        timestamp: 3,
      },
    ];
    const pruned = pruneHistoryForContextShare({
      messages,
      maxContextTokens: 2000,
      maxHistoryShare: 0.5,
      parts: 2,
    });
    const keptRoles = pruned.messages.map((m) => m.role);
    expect(keptRoles).not.toContain("toolResult");
    expect(pruned.droppedMessages).toBeGreaterThan(pruned.droppedMessagesList.length);
  });
  it("keeps tool_result when its tool_use is also kept", () => {
    const messages = [
      {
        role: "user",
        content: "x".repeat(4000),
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "y".repeat(500) },
          { type: "toolCall", id: "call_456", name: "kept_tool", arguments: {} },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call_456",
        toolName: "kept_tool",
        content: [{ type: "text", text: "result" }],
        timestamp: 3,
      },
    ];
    const pruned = pruneHistoryForContextShare({
      messages,
      maxContextTokens: 2000,
      maxHistoryShare: 0.5,
      parts: 2,
    });
    const keptRoles = pruned.messages.map((m) => m.role);
    expect(keptRoles).toContain("assistant");
    expect(keptRoles).toContain("toolResult");
  });
  it("removes multiple orphaned tool_results from the same dropped tool_use", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "x".repeat(4000) },
          { type: "toolCall", id: "call_a", name: "tool_a", arguments: {} },
          { type: "toolCall", id: "call_b", name: "tool_b", arguments: {} },
        ],
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "call_a",
        toolName: "tool_a",
        content: [{ type: "text", text: "result_a" }],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call_b",
        toolName: "tool_b",
        content: [{ type: "text", text: "result_b" }],
        timestamp: 3,
      },
      {
        role: "user",
        content: "x".repeat(500),
        timestamp: 4,
      },
    ];
    const pruned = pruneHistoryForContextShare({
      messages,
      maxContextTokens: 2000,
      maxHistoryShare: 0.5,
      parts: 2,
    });
    const keptToolResults = pruned.messages.filter((m) => m.role === "toolResult");
    expect(keptToolResults).toHaveLength(0);
    expect(pruned.droppedMessages).toBe(pruned.droppedMessagesList.length + 2);
  });
});
