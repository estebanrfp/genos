import { vi } from "vitest";
import { discoverModels } from "../pi-model-discovery.js";
export const makeModel = (id) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
});
export const OPENAI_CODEX_TEMPLATE_MODEL = {
  id: "gpt-5.2-codex",
  name: "GPT-5.2 Codex",
  provider: "openai-codex",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  contextWindow: 272000,
  maxTokens: 128000,
};
export function resetMockDiscoverModels() {
  vi.mocked(discoverModels).mockReturnValue({
    find: vi.fn(() => null),
  });
}
export function mockDiscoveredModel(params) {
  vi.mocked(discoverModels).mockReturnValue({
    find: vi.fn((provider, modelId) => {
      if (provider === params.provider && modelId === params.modelId) {
        return params.templateModel;
      }
      return null;
    }),
  });
}
