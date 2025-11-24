let createToolHandlerCtx = function (params) {
  return {
    params: {
      runId: params.runId,
      session: { messages: [] },
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      onBlockReplyFlush: params.onBlockReplyFlush,
    },
    state: {
      toolMetaById: new Map(),
      toolMetas: [],
      toolSummaryById: new Set(),
      lastToolError: undefined,
      pendingMessagingTexts: new Map(),
      pendingMessagingTargets: new Map(),
      pendingMessagingMediaUrls: new Map(),
      messagingToolSentTexts: [],
      messagingToolSentTextsNormalized: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      blockBuffer: "",
    },
    log: { debug: vi.fn(), warn: vi.fn() },
    flushBlockReplyBuffer: vi.fn(),
    shouldEmitToolResult: () => false,
    shouldEmitToolOutput: () => false,
    emitToolSummary: vi.fn(),
    emitToolOutput: vi.fn(),
    trimMessagingToolSent: vi.fn(),
  };
};
import { beforeEach, describe, expect, it, vi } from "vitest";
const hookMocks = vi.hoisted(() => ({
  runner: {
    hasHooks: vi.fn(() => false),
    runBeforeToolCall: vi.fn(async () => {}),
    runAfterToolCall: vi.fn(async () => {}),
  },
}));
vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => hookMocks.runner,
}));
vi.mock("../infra/agent-events.js", () => ({
  emitAgentEvent: vi.fn(),
}));
describe("after_tool_call hook wiring", () => {
  beforeEach(() => {
    hookMocks.runner.hasHooks.mockReset();
    hookMocks.runner.hasHooks.mockReturnValue(false);
    hookMocks.runner.runBeforeToolCall.mockReset();
    hookMocks.runner.runBeforeToolCall.mockResolvedValue(undefined);
    hookMocks.runner.runAfterToolCall.mockReset();
    hookMocks.runner.runAfterToolCall.mockResolvedValue(undefined);
  });
  it("calls runAfterToolCall in handleToolExecutionEnd when hook is registered", async () => {
    hookMocks.runner.hasHooks.mockReturnValue(true);
    const { handleToolExecutionEnd, handleToolExecutionStart } =
      await import("../agents/pi-embedded-subscribe.handlers.tools.js");
    const ctx = createToolHandlerCtx({
      runId: "test-run-1",
      agentId: "main",
      sessionKey: "test-session",
    });
    await handleToolExecutionStart(ctx, {
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: "call-1",
      args: { path: "/tmp/file.txt" },
    });
    await handleToolExecutionEnd(ctx, {
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "call-1",
      isError: false,
      result: { content: [{ type: "text", text: "file contents" }] },
    });
    expect(hookMocks.runner.runAfterToolCall).toHaveBeenCalledTimes(1);
    expect(hookMocks.runner.runBeforeToolCall).not.toHaveBeenCalled();
    const firstCall = hookMocks.runner.runAfterToolCall.mock.calls[0];
    expect(firstCall).toBeDefined();
    const event = firstCall?.[0];
    const context = firstCall?.[1];
    expect(event).toBeDefined();
    expect(context).toBeDefined();
    if (!event || !context) {
      throw new Error("missing hook call payload");
    }
    expect(event.toolName).toBe("read");
    expect(event.params).toEqual({ path: "/tmp/file.txt" });
    expect(event.error).toBeUndefined();
    expect(typeof event.durationMs).toBe("number");
    expect(context.toolName).toBe("read");
  });
  it("includes error in after_tool_call event on tool failure", async () => {
    hookMocks.runner.hasHooks.mockReturnValue(true);
    const { handleToolExecutionEnd, handleToolExecutionStart } =
      await import("../agents/pi-embedded-subscribe.handlers.tools.js");
    const ctx = createToolHandlerCtx({ runId: "test-run-2" });
    await handleToolExecutionStart(ctx, {
      type: "tool_execution_start",
      toolName: "exec",
      toolCallId: "call-err",
      args: { command: "fail" },
    });
    await handleToolExecutionEnd(ctx, {
      type: "tool_execution_end",
      toolName: "exec",
      toolCallId: "call-err",
      isError: true,
      result: { status: "error", error: "command failed" },
    });
    expect(hookMocks.runner.runAfterToolCall).toHaveBeenCalledTimes(1);
    const firstCall = hookMocks.runner.runAfterToolCall.mock.calls[0];
    expect(firstCall).toBeDefined();
    const event = firstCall?.[0];
    expect(event).toBeDefined();
    if (!event) {
      throw new Error("missing hook call payload");
    }
    expect(event.error).toBeDefined();
  });
  it("does not call runAfterToolCall when no hooks registered", async () => {
    hookMocks.runner.hasHooks.mockReturnValue(false);
    const { handleToolExecutionEnd } =
      await import("../agents/pi-embedded-subscribe.handlers.tools.js");
    const ctx = createToolHandlerCtx({ runId: "r" });
    await handleToolExecutionEnd(ctx, {
      type: "tool_execution_end",
      toolName: "exec",
      toolCallId: "call-2",
      isError: false,
      result: {},
    });
    expect(hookMocks.runner.runAfterToolCall).not.toHaveBeenCalled();
  });
});
