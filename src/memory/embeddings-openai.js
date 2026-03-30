import { resolveRemoteEmbeddingBearerClient } from "./embeddings-remote-client.js";
import { fetchRemoteEmbeddingVectors } from "./embeddings-remote-fetch.js";
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_MAX_INPUT_TOKENS = {
  "text-embedding-3-small": 8192,
  "text-embedding-3-large": 8192,
  "text-embedding-ada-002": 8191,
};
export function normalizeOpenAiModel(model) {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("openai/")) {
    return trimmed.slice("openai/".length);
  }
  return trimmed;
}
export async function createOpenAiEmbeddingProvider(options) {
  const client = await resolveOpenAiEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;
  const embed = async (input) => {
    if (input.length === 0) {
      return [];
    }
    return await fetchRemoteEmbeddingVectors({
      url,
      headers: client.headers,
      body: { model: client.model, input },
      errorPrefix: "openai embeddings failed",
    });
  };
  return {
    provider: {
      id: "openai",
      model: client.model,
      maxInputTokens: OPENAI_MAX_INPUT_TOKENS[client.model],
      embedQuery: async (text) => {
        const [vec] = await embed([text]);
        return vec ?? [];
      },
      embedBatch: embed,
    },
    client,
  };
}
export async function resolveOpenAiEmbeddingClient(options) {
  const { baseUrl, headers } = await resolveRemoteEmbeddingBearerClient({
    provider: "openai",
    options,
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
  });
  const model = normalizeOpenAiModel(options.model);
  return { baseUrl, headers, model };
}
