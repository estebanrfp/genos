let toolText = function (msg) {
    if (msg.role !== "toolResult") {
      throw new Error("expected toolResult");
    }
    const first = msg.content.find((b) => b.type === "text");
    if (!first || first.type !== "text") {
      return "";
    }
    return first.text;
  },
  findToolResult = function (messages, toolCallId) {
    const msg = messages.find((m) => m.role === "toolResult" && m.toolCallId === toolCallId);
    if (!msg) {
      throw new Error(`missing toolResult: ${toolCallId}`);
    }
    return msg;
  },
  makeToolResult = function (params) {
    return {
      role: "toolResult",
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      content: [{ type: "text", text: params.text }],
      isError: false,
      timestamp: Date.now(),
    };
  },
  makeImageToolResult = function (params) {
    return {
      role: "toolResult",
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      content: [
        { type: "image", data: "AA==", mimeType: "image/png" },
        { type: "text", text: params.text },
      ],
      isError: false,
      timestamp: Date.now(),
    };
  },
  makeAssistant = function (text) {
    return {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-responses",
      provider: "openai",
      model: "fake",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  },
  makeUser = function (text) {
    return { role: "user", content: text, timestamp: Date.now() };
  },
  makeAggressiveSettings = function (overrides = {}) {
    return {
      ...DEFAULT_CONTEXT_PRUNING_SETTINGS,
      keepLastAssistants: 0,
      softTrimRatio: 0,
      hardClearRatio: 0,
      minPrunableToolChars: 0,
      hardClear: { enabled: true, placeholder: "[cleared]" },
      softTrim: { maxChars: 10, headChars: 3, tailChars: 3 },
      ...overrides,
    };
  },
  pruneWithAggressiveDefaults = function (messages, settingsOverrides = {}, extra = {}) {
    return pruneContextMessages({
      messages,
      settings: makeAggressiveSettings(settingsOverrides),
      ctx: CONTEXT_WINDOW_1000,
      ...extra,
    });
  },
  createContextHandler = function () {
    let handler;
    const api = {
      on: (name, fn) => {
        if (name === "context") {
          handler = fn;
        }
      },
      appendEntry: (_type, _data) => {},
    };
    contextPruningExtension(api);
    if (!handler) {
      throw new Error("missing context handler");
    }
    return handler;
  },
  runContextHandler = function (handler, messages, sessionManager) {
    return handler(
      { messages },
      {
        model: undefined,
        sessionManager,
      },
    );
  };
import { describe, expect, it } from "vitest";
import {
  computeEffectiveSettings,
  default as contextPruningExtension,
  DEFAULT_CONTEXT_PRUNING_SETTINGS,
  pruneContextMessages,
} from "./context-pruning.js";
import { getContextPruningRuntime, setContextPruningRuntime } from "./context-pruning/runtime.js";
const CONTEXT_WINDOW_1000 = {
  model: { contextWindow: 1000 },
};
describe("context-pruning", () => {
  it("mode off disables pruning", () => {
    expect(computeEffectiveSettings({ mode: "off" })).toBeNull();
    expect(computeEffectiveSettings({})).toBeNull();
  });
  it("does not touch tool results after the last N assistants", () => {
    const messages = [
      makeUser("u1"),
      makeAssistant("a1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "x".repeat(20000),
      }),
      makeUser("u2"),
      makeAssistant("a2"),
      makeToolResult({
        toolCallId: "t2",
        toolName: "exec",
        text: "y".repeat(20000),
      }),
      makeUser("u3"),
      makeAssistant("a3"),
      makeToolResult({
        toolCallId: "t3",
        toolName: "exec",
        text: "z".repeat(20000),
      }),
      makeUser("u4"),
      makeAssistant("a4"),
      makeToolResult({
        toolCallId: "t4",
        toolName: "exec",
        text: "w".repeat(20000),
      }),
    ];
    const next = pruneWithAggressiveDefaults(messages, { keepLastAssistants: 3 });
    expect(toolText(findToolResult(next, "t2"))).toContain("y".repeat(20000));
    expect(toolText(findToolResult(next, "t3"))).toContain("z".repeat(20000));
    expect(toolText(findToolResult(next, "t4"))).toContain("w".repeat(20000));
    expect(toolText(findToolResult(next, "t1"))).toBe("[cleared]");
  });
  it("never prunes tool results before the first user message", () => {
    const messages = [
      makeAssistant("bootstrap tool calls"),
      makeToolResult({
        toolCallId: "t0",
        toolName: "read",
        text: "x".repeat(20000),
      }),
      makeAssistant("greeting"),
      makeUser("u1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "y".repeat(20000),
      }),
    ];
    const next = pruneWithAggressiveDefaults(
      messages,
      {},
      {
        isToolPrunable: () => true,
        contextWindowTokensOverride: 1000,
      },
    );
    expect(toolText(findToolResult(next, "t0"))).toBe("x".repeat(20000));
    expect(toolText(findToolResult(next, "t1"))).toBe("[cleared]");
  });
  it("hard-clear removes eligible tool results before cutoff", () => {
    const messages = [
      makeUser("u1"),
      makeAssistant("a1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "x".repeat(20000),
      }),
      makeToolResult({
        toolCallId: "t2",
        toolName: "exec",
        text: "y".repeat(20000),
      }),
      makeUser("u2"),
      makeAssistant("a2"),
      makeToolResult({
        toolCallId: "t3",
        toolName: "exec",
        text: "z".repeat(20000),
      }),
    ];
    const next = pruneWithAggressiveDefaults(messages, {
      keepLastAssistants: 1,
      softTrimRatio: 10,
      softTrim: DEFAULT_CONTEXT_PRUNING_SETTINGS.softTrim,
    });
    expect(toolText(findToolResult(next, "t1"))).toBe("[cleared]");
    expect(toolText(findToolResult(next, "t2"))).toBe("[cleared]");
    expect(toolText(findToolResult(next, "t3"))).toContain("z".repeat(20000));
  });
  it("uses contextWindow override when ctx.model is missing", () => {
    const messages = [
      makeUser("u1"),
      makeAssistant("a1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "x".repeat(20000),
      }),
      makeAssistant("a2"),
    ];
    const next = pruneContextMessages({
      messages,
      settings: makeAggressiveSettings(),
      ctx: { model: undefined },
      contextWindowTokensOverride: 1000,
    });
    expect(toolText(findToolResult(next, "t1"))).toBe("[cleared]");
  });
  it("reads per-session settings from registry", async () => {
    const sessionManager = {};
    setContextPruningRuntime(sessionManager, {
      settings: makeAggressiveSettings(),
      contextWindowTokens: 1000,
      isToolPrunable: () => true,
      lastCacheTouchAt: Date.now() - DEFAULT_CONTEXT_PRUNING_SETTINGS.ttlMs - 1000,
    });
    const messages = [
      makeUser("u1"),
      makeAssistant("a1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "x".repeat(20000),
      }),
      makeAssistant("a2"),
    ];
    const handler = createContextHandler();
    const result = runContextHandler(handler, messages, sessionManager);
    if (!result) {
      throw new Error("expected handler to return messages");
    }
    expect(toolText(findToolResult(result.messages, "t1"))).toBe("[cleared]");
  });
  it("cache-ttl prunes once and resets the ttl window", () => {
    const sessionManager = {};
    const lastTouch = Date.now() - DEFAULT_CONTEXT_PRUNING_SETTINGS.ttlMs - 1000;
    setContextPruningRuntime(sessionManager, {
      settings: makeAggressiveSettings(),
      contextWindowTokens: 1000,
      isToolPrunable: () => true,
      lastCacheTouchAt: lastTouch,
    });
    const messages = [
      makeUser("u1"),
      makeAssistant("a1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "x".repeat(20000),
      }),
    ];
    const handler = createContextHandler();
    const first = runContextHandler(handler, messages, sessionManager);
    if (!first) {
      throw new Error("expected first prune");
    }
    expect(toolText(findToolResult(first.messages, "t1"))).toBe("[cleared]");
    const runtime = getContextPruningRuntime(sessionManager);
    if (!runtime?.lastCacheTouchAt) {
      throw new Error("expected lastCacheTouchAt");
    }
    expect(runtime.lastCacheTouchAt).toBeGreaterThan(lastTouch);
    const second = runContextHandler(handler, messages, sessionManager);
    expect(second).toBeUndefined();
  });
  it("respects tools allow/deny (deny wins; wildcards supported)", () => {
    const messages = [
      makeUser("u1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "Exec",
        text: "x".repeat(20000),
      }),
      makeToolResult({
        toolCallId: "t2",
        toolName: "Browser",
        text: "y".repeat(20000),
      }),
    ];
    const next = pruneWithAggressiveDefaults(messages, {
      tools: { allow: ["ex*"], deny: ["exec"] },
    });
    expect(toolText(findToolResult(next, "t1"))).toContain("x".repeat(20000));
    expect(toolText(findToolResult(next, "t2"))).toContain("y".repeat(20000));
  });
  it("skips tool results that contain images (no soft trim, no hard clear)", () => {
    const messages = [
      makeUser("u1"),
      makeImageToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "x".repeat(20000),
      }),
    ];
    const next = pruneWithAggressiveDefaults(messages);
    const tool = findToolResult(next, "t1");
    if (!tool || tool.role !== "toolResult") {
      throw new Error("unexpected pruned message list shape");
    }
    expect(tool.content.some((b) => b.type === "image")).toBe(true);
    expect(toolText(tool)).toContain("x".repeat(20000));
  });
  it("soft-trims across block boundaries", () => {
    const messages = [
      makeUser("u1"),
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "exec",
        content: [
          { type: "text", text: "AAAAA" },
          { type: "text", text: "BBBBB" },
        ],
        isError: false,
        timestamp: Date.now(),
      },
    ];
    const next = pruneWithAggressiveDefaults(messages, {
      hardClearRatio: 10,
      softTrim: { maxChars: 5, headChars: 7, tailChars: 3 },
    });
    const text = toolText(findToolResult(next, "t1"));
    expect(text).toContain("AAAAA\nB");
    expect(text).toContain("BBB");
    expect(text).toContain("[Tool result trimmed:");
  });
  it("soft-trims oversized tool results and preserves head/tail with a note", () => {
    const messages = [
      makeUser("u1"),
      makeToolResult({
        toolCallId: "t1",
        toolName: "exec",
        text: "abcdefghij".repeat(1000),
      }),
    ];
    const next = pruneWithAggressiveDefaults(messages, {
      hardClearRatio: 10,
      softTrim: { maxChars: 10, headChars: 6, tailChars: 6 },
    });
    const tool = findToolResult(next, "t1");
    const text = toolText(tool);
    expect(text).toContain("abcdef");
    expect(text).toContain("efghij");
    expect(text).toContain("[Tool result trimmed:");
  });
});
