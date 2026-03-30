let buildModel = function () {
    return {
      id: "gpt-5.2",
      name: "gpt-5.2",
      api: "openai-responses",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
  },
  extractInput = function (payload) {
    return Array.isArray(payload?.input) ? payload.input : [];
  },
  extractInputTypes = function (input) {
    return input
      .map((item) => (item && typeof item === "object" ? item.type : undefined))
      .filter((t) => typeof t === "string");
  },
  buildReasoningPart = function (id = "rs_test") {
    return {
      type: "thinking",
      thinking: "internal",
      thinkingSignature: JSON.stringify({
        type: "reasoning",
        id,
        summary: [],
      }),
    };
  },
  buildAssistantMessage = function (params) {
    return {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.2",
      usage: ZERO_USAGE,
      stopReason: params.stopReason,
      timestamp: Date.now(),
      content: params.content,
    };
  };
import { streamOpenAIResponses } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
async function runAbortedOpenAIResponsesStream(params) {
  const controller = new AbortController();
  controller.abort();
  let payload;
  const stream = streamOpenAIResponses(
    buildModel(),
    {
      systemPrompt: "system",
      messages: params.messages,
      ...(params.tools ? { tools: params.tools } : {}),
    },
    {
      apiKey: "test",
      signal: controller.signal,
      onPayload: (nextPayload) => {
        payload = nextPayload;
      },
    },
  );
  await stream.result();
  const input = extractInput(payload);
  return {
    input,
    types: extractInputTypes(input),
  };
}
describe("openai-responses reasoning replay", () => {
  it("replays reasoning for tool-call-only turns (OpenAI requires it)", async () => {
    const assistantToolOnly = buildAssistantMessage({
      stopReason: "toolUse",
      content: [
        buildReasoningPart(),
        {
          type: "toolCall",
          id: "call_123|fc_123",
          name: "noop",
          arguments: {},
        },
      ],
    });
    const toolResult = {
      role: "toolResult",
      toolCallId: "call_123|fc_123",
      toolName: "noop",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: Date.now(),
    };
    const { input, types } = await runAbortedOpenAIResponsesStream({
      messages: [
        {
          role: "user",
          content: "Call noop.",
          timestamp: Date.now(),
        },
        assistantToolOnly,
        toolResult,
        {
          role: "user",
          content: "Now reply with ok.",
          timestamp: Date.now(),
        },
      ],
      tools: [
        {
          name: "noop",
          description: "no-op",
          parameters: Type.Object({}, { additionalProperties: false }),
        },
      ],
    });
    expect(types).toContain("reasoning");
    expect(types).toContain("function_call");
    expect(types.indexOf("reasoning")).toBeLessThan(types.indexOf("function_call"));
    const functionCall = input.find(
      (item) => item && typeof item === "object" && item.type === "function_call",
    );
    expect(functionCall?.call_id).toBe("call_123");
    expect(functionCall?.id).toBe("fc_123");
  });
  it("still replays reasoning when paired with an assistant message", async () => {
    const assistantWithText = buildAssistantMessage({
      stopReason: "stop",
      content: [buildReasoningPart(), { type: "text", text: "hello", textSignature: "msg_test" }],
    });
    const { types } = await runAbortedOpenAIResponsesStream({
      messages: [
        { role: "user", content: "Hi", timestamp: Date.now() },
        assistantWithText,
        { role: "user", content: "Ok", timestamp: Date.now() },
      ],
    });
    expect(types).toContain("reasoning");
    expect(types).toContain("message");
  });
});
