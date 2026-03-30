import { vi } from "vitest";
import "./test-runtime-mocks.js";
const hoisted = vi.hoisted(() => ({
  embedBatch: vi.fn(async (texts) => texts.map(() => [0, 1, 0])),
  embedQuery: vi.fn(async () => [0, 1, 0]),
}));
export function getEmbedBatchMock() {
  return hoisted.embedBatch;
}
export function getEmbedQueryMock() {
  return hoisted.embedQuery;
}
export function resetEmbeddingMocks() {
  hoisted.embedBatch.mockReset();
  hoisted.embedQuery.mockReset();
  hoisted.embedBatch.mockImplementation(async (texts) => texts.map(() => [0, 1, 0]));
  hoisted.embedQuery.mockImplementation(async () => [0, 1, 0]);
}
vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "openai",
    provider: {
      id: "mock",
      model: "mock-embed",
      maxInputTokens: 8192,
      embedQuery: hoisted.embedQuery,
      embedBatch: hoisted.embedBatch,
    },
  }),
}));
