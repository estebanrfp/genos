let makeZeroUsage = function () {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
};
import { expect } from "vitest";
export const asRecord = (value) => {
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value;
};
export const getFirstToolParameters = (converted) => {
  const functionDeclaration = asRecord(converted?.[0]?.functionDeclarations?.[0]);
  return asRecord(functionDeclaration.parametersJsonSchema ?? functionDeclaration.parameters);
};
export const makeModel = (id) => ({
  id,
  name: id,
  api: "google-generative-ai",
  provider: "google",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
});
export const makeGeminiCliModel = (id) => ({
  id,
  name: id,
  api: "google-gemini-cli",
  provider: "google-gemini-cli",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
});
export function makeGoogleAssistantMessage(model, content) {
  return {
    role: "assistant",
    content,
    api: "google-generative-ai",
    provider: "google",
    model,
    usage: makeZeroUsage(),
    stopReason: "stop",
    timestamp: 0,
  };
}
export function makeGeminiCliAssistantMessage(model, content) {
  return {
    role: "assistant",
    content,
    api: "google-gemini-cli",
    provider: "google-gemini-cli",
    model,
    usage: makeZeroUsage(),
    stopReason: "stop",
    timestamp: 0,
  };
}
