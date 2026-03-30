export const VENICE_BASE_URL = "https://api.venice.ai/api/v1";
export const VENICE_DEFAULT_MODEL_ID = "llama-3.3-70b";
export const VENICE_DEFAULT_MODEL_REF = `venice/${VENICE_DEFAULT_MODEL_ID}`;
export const VENICE_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
export const VENICE_MODEL_CATALOG = [
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "hermes-3-llama-3.1-405b",
    name: "Hermes 3 Llama 3.1 405B",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "qwen3-235b-a22b-thinking-2507",
    name: "Qwen3 235B Thinking",
    reasoning: true,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "qwen3-235b-a22b-instruct-2507",
    name: "Qwen3 235B Instruct",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "qwen3-coder-480b-a35b-instruct",
    name: "Qwen3 Coder 480B",
    reasoning: false,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "qwen3-next-80b",
    name: "Qwen3 Next 80B",
    reasoning: false,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "qwen3-vl-235b-a22b",
    name: "Qwen3 VL 235B (Vision)",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "qwen3-4b",
    name: "Venice Small (Qwen3 4B)",
    reasoning: true,
    input: ["text"],
    contextWindow: 32768,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "deepseek-v3.2",
    name: "DeepSeek V3.2",
    reasoning: true,
    input: ["text"],
    contextWindow: 163840,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "venice-uncensored",
    name: "Venice Uncensored (Dolphin-Mistral)",
    reasoning: false,
    input: ["text"],
    contextWindow: 32768,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "mistral-31-24b",
    name: "Venice Medium (Mistral)",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 131072,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "google-gemma-3-27b-it",
    name: "Google Gemma 3 27B Instruct",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 202752,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "openai-gpt-oss-120b",
    name: "OpenAI GPT OSS 120B",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "zai-org-glm-4.7",
    name: "GLM 4.7",
    reasoning: true,
    input: ["text"],
    contextWindow: 202752,
    maxTokens: 8192,
    privacy: "private",
  },
  {
    id: "claude-opus-45",
    name: "Claude Opus 4.5 (via Venice)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 202752,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "claude-sonnet-45",
    name: "Claude Sonnet 4.5 (via Venice)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 202752,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "openai-gpt-52",
    name: "GPT-5.2 (via Venice)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "openai-gpt-52-codex",
    name: "GPT-5.2 Codex (via Venice)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro (via Venice)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 202752,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash (via Venice)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "grok-41-fast",
    name: "Grok 4.1 Fast (via Venice)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "grok-code-fast-1",
    name: "Grok Code Fast 1 (via Venice)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "kimi-k2-thinking",
    name: "Kimi K2 Thinking (via Venice)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 8192,
    privacy: "anonymized",
  },
  {
    id: "minimax-m21",
    name: "MiniMax M2.1 (via Venice)",
    reasoning: true,
    input: ["text"],
    contextWindow: 202752,
    maxTokens: 8192,
    privacy: "anonymized",
  },
];
export function buildVeniceModelDefinition(entry) {
  return {
    id: entry.id,
    name: entry.name,
    reasoning: entry.reasoning,
    input: [...entry.input],
    cost: VENICE_DEFAULT_COST,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    compat: {
      supportsUsageInStreaming: false,
    },
  };
}
export async function discoverVeniceModels() {
  if (process.env.VITEST) {
    return VENICE_MODEL_CATALOG.map(buildVeniceModelDefinition);
  }
  try {
    const response = await fetch(`${VENICE_BASE_URL}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.warn(
        `[venice-models] Failed to discover models: HTTP ${response.status}, using static catalog`,
      );
      return VENICE_MODEL_CATALOG.map(buildVeniceModelDefinition);
    }
    const data = await response.json();
    if (!Array.isArray(data.data) || data.data.length === 0) {
      console.warn("[venice-models] No models found from API, using static catalog");
      return VENICE_MODEL_CATALOG.map(buildVeniceModelDefinition);
    }
    const catalogById = new Map(VENICE_MODEL_CATALOG.map((m) => [m.id, m]));
    const models = [];
    for (const apiModel of data.data) {
      const catalogEntry = catalogById.get(apiModel.id);
      if (catalogEntry) {
        models.push(buildVeniceModelDefinition(catalogEntry));
      } else {
        const isReasoning =
          apiModel.model_spec.capabilities.supportsReasoning ||
          apiModel.id.toLowerCase().includes("thinking") ||
          apiModel.id.toLowerCase().includes("reason") ||
          apiModel.id.toLowerCase().includes("r1");
        const hasVision = apiModel.model_spec.capabilities.supportsVision;
        models.push({
          id: apiModel.id,
          name: apiModel.model_spec.name || apiModel.id,
          reasoning: isReasoning,
          input: hasVision ? ["text", "image"] : ["text"],
          cost: VENICE_DEFAULT_COST,
          contextWindow: apiModel.model_spec.availableContextTokens || 128000,
          maxTokens: 8192,
          compat: {
            supportsUsageInStreaming: false,
          },
        });
      }
    }
    return models.length > 0 ? models : VENICE_MODEL_CATALOG.map(buildVeniceModelDefinition);
  } catch (error) {
    console.warn(`[venice-models] Discovery failed: ${String(error)}, using static catalog`);
    return VENICE_MODEL_CATALOG.map(buildVeniceModelDefinition);
  }
}
