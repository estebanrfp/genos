import { expect, vi } from "vitest";
import * as helpers from "./pi-embedded-helpers.js";
export const TEST_SESSION_ID = "test-session";
export function makeModelSnapshotEntry(data) {
  return {
    type: "custom",
    customType: "model-snapshot",
    data: {
      timestamp: data.timestamp ?? Date.now(),
      provider: data.provider,
      modelApi: data.modelApi,
      modelId: data.modelId,
    },
  };
}
export function makeInMemorySessionManager(entries) {
  return {
    getEntries: vi.fn(() => entries),
    appendCustomEntry: vi.fn((customType, data) => {
      entries.push({ type: "custom", customType, data });
    }),
  };
}
export function makeMockSessionManager() {
  return {
    getEntries: vi.fn().mockReturnValue([]),
    appendCustomEntry: vi.fn(),
  };
}
export function makeSimpleUserMessages() {
  const messages = [{ role: "user", content: "hello" }];
  return messages;
}
export async function loadSanitizeSessionHistoryWithCleanMocks() {
  vi.resetAllMocks();
  vi.mocked(helpers.sanitizeSessionMessagesImages).mockImplementation(async (msgs) => msgs);
  const mod = await import("./pi-embedded-runner/google.js");
  return mod.sanitizeSessionHistory;
}
export function makeReasoningAssistantMessages(opts) {
  const thinkingSignature =
    opts?.thinkingSignature === "json"
      ? JSON.stringify({ id: "rs_test", type: "reasoning" })
      : { id: "rs_test", type: "reasoning" };
  const messages = [
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "reasoning",
          thinkingSignature,
        },
      ],
    },
  ];
  return messages;
}
export async function sanitizeWithOpenAIResponses(params) {
  return await params.sanitizeSessionHistory({
    messages: params.messages,
    modelApi: "openai-responses",
    provider: "openai",
    sessionManager: params.sessionManager,
    modelId: params.modelId,
    sessionId: TEST_SESSION_ID,
  });
}
export function expectOpenAIResponsesStrictSanitizeCall(
  sanitizeSessionMessagesImagesMock,
  messages,
) {
  expect(sanitizeSessionMessagesImagesMock).toHaveBeenCalledWith(
    messages,
    "session:history",
    expect.objectContaining({
      sanitizeMode: "images-only",
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
    }),
  );
}
export async function expectGoogleModelApiFullSanitizeCall(params) {
  vi.mocked(helpers.isGoogleModelApi).mockReturnValue(true);
  await params.sanitizeSessionHistory({
    messages: params.messages,
    modelApi: "google-generative-ai",
    provider: "google-vertex",
    sessionManager: params.sessionManager,
    sessionId: TEST_SESSION_ID,
  });
  expect(helpers.sanitizeSessionMessagesImages).toHaveBeenCalledWith(
    params.messages,
    "session:history",
    expect.objectContaining({ sanitizeMode: "full", sanitizeToolCallIds: true }),
  );
}
export function makeSnapshotChangedOpenAIReasoningScenario() {
  const sessionEntries = [
    makeModelSnapshotEntry({
      provider: "anthropic",
      modelApi: "anthropic-messages",
      modelId: "claude-3-7",
    }),
  ];
  return {
    sessionManager: makeInMemorySessionManager(sessionEntries),
    messages: makeReasoningAssistantMessages({ thinkingSignature: "object" }),
    modelId: "gpt-5.2-codex",
  };
}
