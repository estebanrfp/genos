let sanitizeAndNormalizeEmbedding = function (vec) {
    const sanitized = vec.map((value) => (Number.isFinite(value) ? value : 0));
    const magnitude = Math.sqrt(sanitized.reduce((sum, value) => sum + value * value, 0));
    if (magnitude < 0.0000000001) {
      return sanitized;
    }
    return sanitized.map((value) => value / magnitude);
  },
  isMissingApiKeyError = function (err) {
    const message = formatErrorMessage(err);
    return message.includes("No API key found for provider");
  };
import { formatErrorMessage } from "../infra/errors.js";
import { createGeminiEmbeddingProvider } from "./embeddings-gemini.js";
import { createOpenAiEmbeddingProvider } from "./embeddings-openai.js";
const REMOTE_EMBEDDING_PROVIDER_IDS = ["openai", "gemini"];
export { sanitizeAndNormalizeEmbedding };
export async function createEmbeddingProvider(options) {
  const requestedProvider = options.provider;
  const fallback = options.fallback;
  const createProvider = async (id) => {
    if (id === "gemini") {
      const { provider, client } = await createGeminiEmbeddingProvider(options);
      return { provider, gemini: client };
    }
    const { provider, client } = await createOpenAiEmbeddingProvider(options);
    return { provider, openAi: client };
  };
  if (requestedProvider === "auto" || requestedProvider === "local") {
    const missingKeyErrors = [];
    for (const provider of REMOTE_EMBEDDING_PROVIDER_IDS) {
      try {
        const result = await createProvider(provider);
        return { ...result, requestedProvider };
      } catch (err) {
        const message = formatErrorMessage(err);
        if (isMissingApiKeyError(err)) {
          missingKeyErrors.push(message);
          continue;
        }
        throw new Error(message, { cause: err });
      }
    }
    const reason =
      missingKeyErrors.length > 0
        ? missingKeyErrors.join("\n\n")
        : "No embeddings provider available.";
    return {
      provider: null,
      requestedProvider,
      providerUnavailableReason: reason,
    };
  }
  try {
    const primary = await createProvider(requestedProvider);
    return { ...primary, requestedProvider };
  } catch (primaryErr) {
    const reason = formatErrorMessage(primaryErr);
    if (fallback && fallback !== "none" && fallback !== requestedProvider) {
      try {
        const fallbackResult = await createProvider(fallback);
        return {
          ...fallbackResult,
          requestedProvider,
          fallbackFrom: requestedProvider,
          fallbackReason: reason,
        };
      } catch (fallbackErr) {
        const fallbackReason = formatErrorMessage(fallbackErr);
        const combinedReason = `${reason}\n\nFallback to ${fallback} failed: ${fallbackReason}`;
        if (isMissingApiKeyError(primaryErr) && isMissingApiKeyError(fallbackErr)) {
          return {
            provider: null,
            requestedProvider,
            fallbackFrom: requestedProvider,
            fallbackReason: reason,
            providerUnavailableReason: combinedReason,
          };
        }
        throw new Error(combinedReason, { cause: fallbackErr });
      }
    }
    if (isMissingApiKeyError(primaryErr)) {
      return {
        provider: null,
        requestedProvider,
        providerUnavailableReason: reason,
      };
    }
    throw new Error(reason, { cause: primaryErr });
  }
}
