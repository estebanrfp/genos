let makeUser = function (text) {
    return {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
  },
  makeToolResult = function (id, text) {
    return {
      role: "toolResult",
      toolCallId: id,
      toolName: "read",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: Date.now(),
    };
  },
  makeLegacyToolResult = function (id, text) {
    return {
      role: "tool",
      tool_call_id: id,
      tool_name: "read",
      content: text,
    };
  },
  makeToolResultWithDetails = function (id, text, detailText) {
    return {
      role: "toolResult",
      toolCallId: id,
      toolName: "read",
      content: [{ type: "text", text }],
      details: {
        truncation: {
          truncated: true,
          outputLines: 100,
          content: detailText,
        },
      },
      isError: false,
      timestamp: Date.now(),
    };
  },
  getToolResultText = function (msg) {
    const content = msg.content;
    if (!Array.isArray(content)) {
      return "";
    }
    const block = content.find(
      (entry) => entry && typeof entry === "object" && entry.type === "text",
    );
    return typeof block?.text === "string" ? block.text : "";
  },
  makeGuardableAgent = function (transformContext) {
    return { transformContext };
  },
  makeTwoToolResultOverflowContext = function () {
    return [
      makeUser("u".repeat(2000)),
      makeToolResult("call_old", "x".repeat(1000)),
      makeToolResult("call_new", "y".repeat(1000)),
    ];
  };
import { describe, expect, it } from "vitest";
import {
  CONTEXT_LIMIT_TRUNCATION_NOTICE,
  PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER,
  installToolResultContextGuard,
} from "./tool-result-context-guard.js";
async function applyGuardToContext(agent, contextForNextCall) {
  installToolResultContextGuard({
    agent,
    contextWindowTokens: 1000,
  });
  return await agent.transformContext?.(contextForNextCall, new AbortController().signal);
}
describe("installToolResultContextGuard", () => {
  it("compacts oldest-first when total context overflows, even if each result fits individually", async () => {
    const agent = makeGuardableAgent();
    const contextForNextCall = makeTwoToolResultOverflowContext();
    const transformed = await applyGuardToContext(agent, contextForNextCall);
    expect(transformed).toBe(contextForNextCall);
    const oldResultText = getToolResultText(contextForNextCall[1]);
    const newResultText = getToolResultText(contextForNextCall[2]);
    expect(oldResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(newResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(newResultText).not.toContain(CONTEXT_LIMIT_TRUNCATION_NOTICE);
  });
  it("keeps compacting oldest-first until context is back under budget", async () => {
    const agent = makeGuardableAgent();
    installToolResultContextGuard({
      agent,
      contextWindowTokens: 1000,
    });
    const contextForNextCall = [
      makeUser("u".repeat(2200)),
      makeToolResult("call_1", "a".repeat(800)),
      makeToolResult("call_2", "b".repeat(800)),
      makeToolResult("call_3", "c".repeat(800)),
    ];
    await agent.transformContext?.(contextForNextCall, new AbortController().signal);
    const first = getToolResultText(contextForNextCall[1]);
    const second = getToolResultText(contextForNextCall[2]);
    const third = getToolResultText(contextForNextCall[3]);
    expect(first).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(second).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(third).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
  });
  it("survives repeated large tool results by compacting older outputs before later turns", async () => {
    const agent = makeGuardableAgent();
    installToolResultContextGuard({
      agent,
      contextWindowTokens: 1e5,
    });
    const contextForNextCall = [makeUser("stress")];
    for (let i = 1; i <= 4; i++) {
      contextForNextCall.push(makeToolResult(`call_${i}`, String(i).repeat(95000)));
      await agent.transformContext?.(contextForNextCall, new AbortController().signal);
    }
    const toolResultTexts = contextForNextCall
      .filter((msg) => msg.role === "toolResult")
      .map((msg) => getToolResultText(msg));
    expect(toolResultTexts[0]).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(toolResultTexts[3]?.length).toBe(95000);
    expect(toolResultTexts.join("\n")).not.toContain(CONTEXT_LIMIT_TRUNCATION_NOTICE);
  });
  it("truncates an individually oversized tool result with a context-limit notice", async () => {
    const agent = makeGuardableAgent();
    installToolResultContextGuard({
      agent,
      contextWindowTokens: 1000,
    });
    const contextForNextCall = [makeToolResult("call_big", "z".repeat(5000))];
    await agent.transformContext?.(contextForNextCall, new AbortController().signal);
    const newResultText = getToolResultText(contextForNextCall[0]);
    expect(newResultText.length).toBeLessThan(5000);
    expect(newResultText).toContain(CONTEXT_LIMIT_TRUNCATION_NOTICE);
  });
  it("keeps compacting oldest-first until overflow clears, including the newest tool result when needed", async () => {
    const agent = makeGuardableAgent();
    installToolResultContextGuard({
      agent,
      contextWindowTokens: 1000,
    });
    const contextForNextCall = [
      makeUser("u".repeat(2600)),
      makeToolResult("call_old", "x".repeat(700)),
      makeToolResult("call_new", "y".repeat(1000)),
    ];
    await agent.transformContext?.(contextForNextCall, new AbortController().signal);
    const oldResultText = getToolResultText(contextForNextCall[1]);
    const newResultText = getToolResultText(contextForNextCall[2]);
    expect(oldResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(newResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(newResultText).not.toContain(CONTEXT_LIMIT_TRUNCATION_NOTICE);
  });
  it("wraps an existing transformContext and guards the transformed output", async () => {
    const agent = makeGuardableAgent((messages) => {
      return messages.map((msg) => ({
        ...msg,
      }));
    });
    const contextForNextCall = makeTwoToolResultOverflowContext();
    const transformed = await applyGuardToContext(agent, contextForNextCall);
    expect(transformed).not.toBe(contextForNextCall);
    const transformedMessages = transformed;
    const oldResultText = getToolResultText(transformedMessages[1]);
    expect(oldResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
  });
  it("handles legacy role=tool string outputs when enforcing context budget", async () => {
    const agent = makeGuardableAgent();
    installToolResultContextGuard({
      agent,
      contextWindowTokens: 1000,
    });
    const contextForNextCall = [
      makeUser("u".repeat(2000)),
      makeLegacyToolResult("call_old", "x".repeat(1000)),
      makeLegacyToolResult("call_new", "y".repeat(1000)),
    ];
    await agent.transformContext?.(contextForNextCall, new AbortController().signal);
    const oldResultText = contextForNextCall[1].content;
    const newResultText = contextForNextCall[2].content;
    expect(oldResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(newResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
  });
  it("drops oversized read-tool details payloads when compacting tool results", async () => {
    const agent = makeGuardableAgent();
    installToolResultContextGuard({
      agent,
      contextWindowTokens: 1000,
    });
    const contextForNextCall = [
      makeUser("u".repeat(1600)),
      makeToolResultWithDetails("call_old", "x".repeat(900), "d".repeat(8000)),
      makeToolResultWithDetails("call_new", "y".repeat(900), "d".repeat(8000)),
    ];
    await agent.transformContext?.(contextForNextCall, new AbortController().signal);
    const oldResult = contextForNextCall[1];
    const newResult = contextForNextCall[2];
    const oldResultText = getToolResultText(contextForNextCall[1]);
    const newResultText = getToolResultText(contextForNextCall[2]);
    expect(oldResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(newResultText).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(oldResult.details).toBeUndefined();
    expect(newResult.details).toBeUndefined();
  });
});
