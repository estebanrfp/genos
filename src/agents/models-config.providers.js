let buildMinimaxModel = function (params) {
    return {
      id: params.id,
      name: params.name,
      reasoning: params.reasoning,
      input: params.input,
      cost: MINIMAX_API_COST,
      contextWindow: MINIMAX_DEFAULT_CONTEXT_WINDOW,
      maxTokens: MINIMAX_DEFAULT_MAX_TOKENS,
    };
  },
  buildMinimaxTextModel = function (params) {
    return buildMinimaxModel({ ...params, input: ["text"] });
  },
  normalizeApiKeyConfig = function (value) {
    const trimmed = value.trim();
    const match = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
    return match?.[1] ?? trimmed;
  },
  resolveEnvApiKeyVarName = function (provider) {
    const resolved = resolveEnvApiKey(provider);
    if (!resolved) {
      return;
    }
    const match = /^(?:env: |shell env: )([A-Z0-9_]+)$/.exec(resolved.source);
    return match ? match[1] : undefined;
  },
  resolveAwsSdkApiKeyVarName = function () {
    return resolveAwsSdkEnvVarName() ?? "AWS_PROFILE";
  },
  resolveApiKeyFromProfiles = function (params) {
    const ids = listProfilesForProvider(params.store, params.provider);
    for (const id of ids) {
      const cred = params.store.profiles[id];
      if (!cred) {
        continue;
      }
      if (cred.type === "api_key") {
        return cred.key;
      }
      if (cred.type === "token") {
        return cred.token;
      }
    }
    return;
  },
  normalizeGoogleProvider = function (provider) {
    let mutated = false;
    const models = provider.models.map((model) => {
      const nextId = normalizeGoogleModelId(model.id);
      if (nextId === model.id) {
        return model;
      }
      mutated = true;
      return { ...model, id: nextId };
    });
    return mutated ? { ...provider, models } : provider;
  },
  buildMinimaxProvider = function () {
    return {
      baseUrl: MINIMAX_PORTAL_BASE_URL,
      api: "anthropic-messages",
      models: [
        buildMinimaxTextModel({
          id: MINIMAX_DEFAULT_MODEL_ID,
          name: "MiniMax M2.1",
          reasoning: false,
        }),
        buildMinimaxTextModel({
          id: "MiniMax-M2.1-lightning",
          name: "MiniMax M2.1 Lightning",
          reasoning: false,
        }),
        buildMinimaxModel({
          id: MINIMAX_DEFAULT_VISION_MODEL_ID,
          name: "MiniMax VL 01",
          reasoning: false,
          input: ["text", "image"],
        }),
        buildMinimaxTextModel({
          id: "MiniMax-M2.5",
          name: "MiniMax M2.5",
          reasoning: true,
        }),
        buildMinimaxTextModel({
          id: "MiniMax-M2.5-Lightning",
          name: "MiniMax M2.5 Lightning",
          reasoning: true,
        }),
      ],
    };
  },
  buildMinimaxPortalProvider = function () {
    return {
      baseUrl: MINIMAX_PORTAL_BASE_URL,
      api: "anthropic-messages",
      models: [
        buildMinimaxTextModel({
          id: MINIMAX_DEFAULT_MODEL_ID,
          name: "MiniMax M2.1",
          reasoning: false,
        }),
        buildMinimaxTextModel({
          id: "MiniMax-M2.5",
          name: "MiniMax M2.5",
          reasoning: true,
        }),
      ],
    };
  },
  buildMoonshotProvider = function () {
    return {
      baseUrl: MOONSHOT_BASE_URL,
      api: "openai-completions",
      models: [
        {
          id: MOONSHOT_DEFAULT_MODEL_ID,
          name: "Kimi K2.5",
          reasoning: false,
          input: ["text"],
          cost: MOONSHOT_DEFAULT_COST,
          contextWindow: MOONSHOT_DEFAULT_CONTEXT_WINDOW,
          maxTokens: MOONSHOT_DEFAULT_MAX_TOKENS,
        },
      ],
    };
  },
  buildQwenPortalProvider = function () {
    return {
      baseUrl: QWEN_PORTAL_BASE_URL,
      api: "openai-completions",
      models: [
        {
          id: "coder-model",
          name: "Qwen Coder",
          reasoning: false,
          input: ["text"],
          cost: QWEN_PORTAL_DEFAULT_COST,
          contextWindow: QWEN_PORTAL_DEFAULT_CONTEXT_WINDOW,
          maxTokens: QWEN_PORTAL_DEFAULT_MAX_TOKENS,
        },
        {
          id: "vision-model",
          name: "Qwen Vision",
          reasoning: false,
          input: ["text", "image"],
          cost: QWEN_PORTAL_DEFAULT_COST,
          contextWindow: QWEN_PORTAL_DEFAULT_CONTEXT_WINDOW,
          maxTokens: QWEN_PORTAL_DEFAULT_MAX_TOKENS,
        },
      ],
    };
  },
  buildSyntheticProvider = function () {
    return {
      baseUrl: SYNTHETIC_BASE_URL,
      api: "anthropic-messages",
      models: SYNTHETIC_MODEL_CATALOG.map(buildSyntheticModelDefinition),
    };
  },
  buildTogetherProvider = function () {
    return {
      baseUrl: TOGETHER_BASE_URL,
      api: "openai-completions",
      models: TOGETHER_MODEL_CATALOG.map(buildTogetherModelDefinition),
    };
  };
import {
  buildCopilotModelDefinition,
  getDefaultCopilotModelIds,
} from "../providers/github-copilot-models.js";
import {
  DEFAULT_COPILOT_API_BASE_URL,
  resolveCopilotApiToken,
} from "../providers/github-copilot-token.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "./auth-profiles.js";
import { discoverBedrockModels } from "./bedrock-discovery.js";
import {
  buildCloudflareAiGatewayModelDefinition,
  resolveCloudflareAiGatewayBaseUrl,
} from "./cloudflare-ai-gateway.js";
import {
  discoverHuggingfaceModels,
  HUGGINGFACE_BASE_URL,
  HUGGINGFACE_MODEL_CATALOG,
  buildHuggingfaceModelDefinition,
} from "./huggingface-models.js";
import { resolveAwsSdkEnvVarName, resolveEnvApiKey } from "./model-auth.js";
import catalog from "./static-model-catalog.json" with { type: "json" };
import {
  buildSyntheticModelDefinition,
  SYNTHETIC_BASE_URL,
  SYNTHETIC_MODEL_CATALOG,
} from "./synthetic-models.js";
import {
  TOGETHER_BASE_URL,
  TOGETHER_MODEL_CATALOG,
  buildTogetherModelDefinition,
} from "./together-models.js";
import { discoverVeniceModels, VENICE_BASE_URL } from "./venice-models.js";
const MINIMAX_PORTAL_BASE_URL = "https://api.minimax.io/anthropic";
const MINIMAX_DEFAULT_MODEL_ID = "MiniMax-M2.1";
const MINIMAX_DEFAULT_VISION_MODEL_ID = "MiniMax-VL-01";
const MINIMAX_DEFAULT_CONTEXT_WINDOW = 200000;
const MINIMAX_DEFAULT_MAX_TOKENS = 8192;
const MINIMAX_OAUTH_PLACEHOLDER = "minimax-oauth";
const MINIMAX_API_COST = {
  input: 15,
  output: 60,
  cacheRead: 2,
  cacheWrite: 10,
};
const XIAOMI_BASE_URL = "https://api.xiaomimimo.com/anthropic";
export const XIAOMI_DEFAULT_MODEL_ID = "mimo-v2-flash";
const XIAOMI_DEFAULT_CONTEXT_WINDOW = 262144;
const XIAOMI_DEFAULT_MAX_TOKENS = 8192;
const XIAOMI_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
const MOONSHOT_DEFAULT_MODEL_ID = "kimi-k2.5";
const MOONSHOT_DEFAULT_CONTEXT_WINDOW = 256000;
const MOONSHOT_DEFAULT_MAX_TOKENS = 8192;
const MOONSHOT_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
const QWEN_PORTAL_BASE_URL = "https://portal.qwen.ai/v1";
const QWEN_PORTAL_OAUTH_PLACEHOLDER = "qwen-oauth";
const QWEN_PORTAL_DEFAULT_CONTEXT_WINDOW = 128000;
const QWEN_PORTAL_DEFAULT_MAX_TOKENS = 8192;
const QWEN_PORTAL_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
const VLLM_BASE_URL = "http://127.0.0.1:8000/v1";
const VLLM_DEFAULT_CONTEXT_WINDOW = 128000;
const VLLM_DEFAULT_MAX_TOKENS = 8192;
const VLLM_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
export const QIANFAN_BASE_URL = "https://qianfan.baidubce.com/v2";
export const QIANFAN_DEFAULT_MODEL_ID = "deepseek-v3.2";
const QIANFAN_DEFAULT_CONTEXT_WINDOW = 98304;
const QIANFAN_DEFAULT_MAX_TOKENS = 32768;
const QIANFAN_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_DEFAULT_MODEL_ID = "nvidia/llama-3.1-nemotron-70b-instruct";
const NVIDIA_DEFAULT_CONTEXT_WINDOW = 131072;
const NVIDIA_DEFAULT_MAX_TOKENS = 4096;
const NVIDIA_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
/** Convert catalog tier map {complex, normal, simple} to flat model array. */
const catalogToModels = (providerKey) => Object.values(catalog[providerKey].models);
async function discoverVllmModels(baseUrl, apiKey) {
  if (process.env.VITEST || false) {
    return [];
  }
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const url = `${trimmedBaseUrl}/models`;
  try {
    const trimmedApiKey = apiKey?.trim();
    const response = await fetch(url, {
      headers: trimmedApiKey ? { Authorization: `Bearer ${trimmedApiKey}` } : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.warn(`Failed to discover vLLM models: ${response.status}`);
      return [];
    }
    const data = await response.json();
    const models = data.data ?? [];
    if (models.length === 0) {
      console.warn("No vLLM models found on local instance");
      return [];
    }
    return models
      .map((m) => ({ id: typeof m.id === "string" ? m.id.trim() : "" }))
      .filter((m) => Boolean(m.id))
      .map((m) => {
        const modelId = m.id;
        const lower = modelId.toLowerCase();
        const isReasoning =
          lower.includes("r1") || lower.includes("reasoning") || lower.includes("think");
        return {
          id: modelId,
          name: modelId,
          reasoning: isReasoning,
          input: ["text"],
          cost: VLLM_DEFAULT_COST,
          contextWindow: VLLM_DEFAULT_CONTEXT_WINDOW,
          maxTokens: VLLM_DEFAULT_MAX_TOKENS,
        };
      });
  } catch (error) {
    console.warn(`Failed to discover vLLM models: ${String(error)}`);
    return [];
  }
}
export function normalizeGoogleModelId(id) {
  if (id === "gemini-3-pro") {
    return "gemini-3-pro-preview";
  }
  if (id === "gemini-3-flash") {
    return "gemini-3-flash-preview";
  }
  return id;
}
export function normalizeProviders(params) {
  const { providers, cfg } = params;
  if (!providers) {
    return providers;
  }
  const authStore = ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false }, cfg);
  let mutated = false;
  const next = {};
  for (const [key, provider] of Object.entries(providers)) {
    const normalizedKey = key.trim();
    let normalizedProvider = provider;
    if (
      normalizedProvider.apiKey &&
      normalizeApiKeyConfig(normalizedProvider.apiKey) !== normalizedProvider.apiKey
    ) {
      mutated = true;
      normalizedProvider = {
        ...normalizedProvider,
        apiKey: normalizeApiKeyConfig(normalizedProvider.apiKey),
      };
    }
    const hasModels =
      Array.isArray(normalizedProvider.models) && normalizedProvider.models.length > 0;
    if (hasModels && !normalizedProvider.apiKey?.trim()) {
      const authMode =
        normalizedProvider.auth ?? (normalizedKey === "amazon-bedrock" ? "aws-sdk" : undefined);
      if (authMode === "aws-sdk") {
        const apiKey = resolveAwsSdkApiKeyVarName();
        mutated = true;
        normalizedProvider = { ...normalizedProvider, apiKey };
      } else {
        const fromEnv = resolveEnvApiKeyVarName(normalizedKey);
        const fromProfiles = resolveApiKeyFromProfiles({
          provider: normalizedKey,
          store: authStore,
        });
        const apiKey = fromEnv ?? fromProfiles;
        if (apiKey?.trim()) {
          mutated = true;
          normalizedProvider = { ...normalizedProvider, apiKey };
        }
      }
    }
    if (normalizedKey === "google") {
      const googleNormalized = normalizeGoogleProvider(normalizedProvider);
      if (googleNormalized !== normalizedProvider) {
        mutated = true;
      }
      normalizedProvider = googleNormalized;
    }
    next[key] = normalizedProvider;
  }
  return mutated ? next : providers;
}
export function buildXiaomiProvider() {
  return {
    baseUrl: XIAOMI_BASE_URL,
    api: "anthropic-messages",
    models: [
      {
        id: XIAOMI_DEFAULT_MODEL_ID,
        name: "Xiaomi MiMo V2 Flash",
        reasoning: false,
        input: ["text"],
        cost: XIAOMI_DEFAULT_COST,
        contextWindow: XIAOMI_DEFAULT_CONTEXT_WINDOW,
        maxTokens: XIAOMI_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}
async function buildVeniceProvider() {
  const models = await discoverVeniceModels();
  return {
    baseUrl: VENICE_BASE_URL,
    api: "openai-completions",
    models,
  };
}
async function buildHuggingfaceProvider(apiKey) {
  const resolvedSecret =
    apiKey?.trim() !== ""
      ? /^[A-Z][A-Z0-9_]*$/.test(apiKey.trim())
        ? (process.env[apiKey.trim()] ?? "").trim()
        : apiKey.trim()
      : "";
  const models =
    resolvedSecret !== ""
      ? await discoverHuggingfaceModels(resolvedSecret)
      : HUGGINGFACE_MODEL_CATALOG.map(buildHuggingfaceModelDefinition);
  return {
    baseUrl: HUGGINGFACE_BASE_URL,
    api: "openai-completions",
    models,
  };
}
async function buildVllmProvider(params) {
  const baseUrl = (params?.baseUrl?.trim() || VLLM_BASE_URL).replace(/\/+$/, "");
  const models = await discoverVllmModels(baseUrl, params?.apiKey);
  return {
    baseUrl,
    api: "openai-completions",
    models,
  };
}
export function buildQianfanProvider() {
  return {
    baseUrl: QIANFAN_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: QIANFAN_DEFAULT_MODEL_ID,
        name: "DEEPSEEK V3.2",
        reasoning: true,
        input: ["text"],
        cost: QIANFAN_DEFAULT_COST,
        contextWindow: QIANFAN_DEFAULT_CONTEXT_WINDOW,
        maxTokens: QIANFAN_DEFAULT_MAX_TOKENS,
      },
      {
        id: "ernie-5.0-thinking-preview",
        name: "ERNIE-5.0-Thinking-Preview",
        reasoning: true,
        input: ["text", "image"],
        cost: QIANFAN_DEFAULT_COST,
        contextWindow: 119000,
        maxTokens: 64000,
      },
    ],
  };
}
/** Static catalog for OpenAI — reads from static-model-catalog.json. */
export function buildOpenAIProvider() {
  const { baseUrl, api } = catalog.openai;
  return { baseUrl, api, models: catalogToModels("openai") };
}

/** Static catalog for Anthropic — reads from static-model-catalog.json. */
export function buildAnthropicProvider() {
  const { baseUrl, api } = catalog.anthropic;
  return { baseUrl, api, models: catalogToModels("anthropic") };
}

/** Static catalog for Google — reads from static-model-catalog.json. */
export function buildGoogleProvider() {
  const { baseUrl, api } = catalog.google;
  return { baseUrl, api, models: catalogToModels("google") };
}
export function buildNvidiaProvider() {
  return {
    baseUrl: NVIDIA_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: NVIDIA_DEFAULT_MODEL_ID,
        name: "NVIDIA Llama 3.1 Nemotron 70B Instruct",
        reasoning: false,
        input: ["text"],
        cost: NVIDIA_DEFAULT_COST,
        contextWindow: NVIDIA_DEFAULT_CONTEXT_WINDOW,
        maxTokens: NVIDIA_DEFAULT_MAX_TOKENS,
      },
      {
        id: "meta/llama-3.3-70b-instruct",
        name: "Meta Llama 3.3 70B Instruct",
        reasoning: false,
        input: ["text"],
        cost: NVIDIA_DEFAULT_COST,
        contextWindow: 131072,
        maxTokens: 4096,
      },
      {
        id: "nvidia/mistral-nemo-minitron-8b-8k-instruct",
        name: "NVIDIA Mistral NeMo Minitron 8B Instruct",
        reasoning: false,
        input: ["text"],
        cost: NVIDIA_DEFAULT_COST,
        contextWindow: 8192,
        maxTokens: 2048,
      },
    ],
  };
}
export async function resolveImplicitProviders(params) {
  const providers = {};
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  if (!params.explicitProviders?.openai) {
    const openaiEnvVar = resolveEnvApiKeyVarName("openai");
    const openaiProfileKey = resolveApiKeyFromProfiles({ provider: "openai", store: authStore });
    const openaiKey = openaiEnvVar ?? openaiProfileKey;
    if (openaiKey) {
      providers.openai = { ...buildOpenAIProvider(), apiKey: openaiKey };
    }
  }
  if (!params.explicitProviders?.anthropic) {
    const anthropicEnvVar = resolveEnvApiKeyVarName("anthropic");
    const anthropicProfileKey = resolveApiKeyFromProfiles({
      provider: "anthropic",
      store: authStore,
    });
    const anthropicKey = anthropicEnvVar ?? anthropicProfileKey;
    if (anthropicKey) {
      providers.anthropic = { ...buildAnthropicProvider(), apiKey: anthropicKey };
    }
  }
  const minimaxKey =
    resolveEnvApiKeyVarName("minimax") ??
    resolveApiKeyFromProfiles({ provider: "minimax", store: authStore });
  if (minimaxKey) {
    providers.minimax = { ...buildMinimaxProvider(), apiKey: minimaxKey };
  }
  const minimaxOauthProfile = listProfilesForProvider(authStore, "minimax-portal");
  if (minimaxOauthProfile.length > 0) {
    providers["minimax-portal"] = {
      ...buildMinimaxPortalProvider(),
      apiKey: MINIMAX_OAUTH_PLACEHOLDER,
    };
  }
  const moonshotKey =
    resolveEnvApiKeyVarName("moonshot") ??
    resolveApiKeyFromProfiles({ provider: "moonshot", store: authStore });
  if (moonshotKey) {
    providers.moonshot = { ...buildMoonshotProvider(), apiKey: moonshotKey };
  }
  const syntheticKey =
    resolveEnvApiKeyVarName("synthetic") ??
    resolveApiKeyFromProfiles({ provider: "synthetic", store: authStore });
  if (syntheticKey) {
    providers.synthetic = { ...buildSyntheticProvider(), apiKey: syntheticKey };
  }
  const veniceKey =
    resolveEnvApiKeyVarName("venice") ??
    resolveApiKeyFromProfiles({ provider: "venice", store: authStore });
  if (veniceKey) {
    providers.venice = { ...(await buildVeniceProvider()), apiKey: veniceKey };
  }
  const qwenProfiles = listProfilesForProvider(authStore, "qwen-portal");
  if (qwenProfiles.length > 0) {
    providers["qwen-portal"] = {
      ...buildQwenPortalProvider(),
      apiKey: QWEN_PORTAL_OAUTH_PLACEHOLDER,
    };
  }
  const xiaomiKey =
    resolveEnvApiKeyVarName("xiaomi") ??
    resolveApiKeyFromProfiles({ provider: "xiaomi", store: authStore });
  if (xiaomiKey) {
    providers.xiaomi = { ...buildXiaomiProvider(), apiKey: xiaomiKey };
  }
  const cloudflareProfiles = listProfilesForProvider(authStore, "cloudflare-ai-gateway");
  for (const profileId of cloudflareProfiles) {
    const cred = authStore.profiles[profileId];
    if (cred?.type !== "api_key") {
      continue;
    }
    const accountId = cred.metadata?.accountId?.trim();
    const gatewayId = cred.metadata?.gatewayId?.trim();
    if (!accountId || !gatewayId) {
      continue;
    }
    const baseUrl = resolveCloudflareAiGatewayBaseUrl({ accountId, gatewayId });
    if (!baseUrl) {
      continue;
    }
    const apiKey = resolveEnvApiKeyVarName("cloudflare-ai-gateway") ?? cred.key?.trim() ?? "";
    if (!apiKey) {
      continue;
    }
    providers["cloudflare-ai-gateway"] = {
      baseUrl,
      api: "anthropic-messages",
      apiKey,
      models: [buildCloudflareAiGatewayModelDefinition()],
    };
    break;
  }
  if (!params.explicitProviders?.vllm) {
    const vllmEnvVar = resolveEnvApiKeyVarName("vllm");
    const vllmProfileKey = resolveApiKeyFromProfiles({ provider: "vllm", store: authStore });
    const vllmKey = vllmEnvVar ?? vllmProfileKey;
    if (vllmKey) {
      const discoveryApiKey = vllmEnvVar
        ? (process.env[vllmEnvVar]?.trim() ?? "")
        : (vllmProfileKey ?? "");
      providers.vllm = {
        ...(await buildVllmProvider({ apiKey: discoveryApiKey || undefined })),
        apiKey: vllmKey,
      };
    }
  }
  const togetherKey =
    resolveEnvApiKeyVarName("together") ??
    resolveApiKeyFromProfiles({ provider: "together", store: authStore });
  if (togetherKey) {
    providers.together = {
      ...buildTogetherProvider(),
      apiKey: togetherKey,
    };
  }
  const huggingfaceKey =
    resolveEnvApiKeyVarName("huggingface") ??
    resolveApiKeyFromProfiles({ provider: "huggingface", store: authStore });
  if (huggingfaceKey) {
    const hfProvider = await buildHuggingfaceProvider(huggingfaceKey);
    providers.huggingface = {
      ...hfProvider,
      apiKey: huggingfaceKey,
    };
  }
  const qianfanKey =
    resolveEnvApiKeyVarName("qianfan") ??
    resolveApiKeyFromProfiles({ provider: "qianfan", store: authStore });
  if (qianfanKey) {
    providers.qianfan = { ...buildQianfanProvider(), apiKey: qianfanKey };
  }
  const nvidiaKey =
    resolveEnvApiKeyVarName("nvidia") ??
    resolveApiKeyFromProfiles({ provider: "nvidia", store: authStore });
  if (nvidiaKey) {
    providers.nvidia = { ...buildNvidiaProvider(), apiKey: nvidiaKey };
  }
  if (!params.explicitProviders?.google) {
    const googleEnvVar = resolveEnvApiKeyVarName("google");
    const googleProfileKey = resolveApiKeyFromProfiles({ provider: "google", store: authStore });
    const googleKey = googleEnvVar ?? googleProfileKey;
    if (googleKey) {
      providers.google = { ...buildGoogleProvider(), apiKey: googleKey };
    }
  }
  return providers;
}
/** @returns {object[]} Static Copilot model catalog (no API call). */
function discoverCopilotModels() {
  return getDefaultCopilotModelIds().map((id) => ({
    ...buildCopilotModelDefinition(id),
    discovered: true,
  }));
}
export async function resolveImplicitCopilotProvider(params) {
  const env = params.env ?? process.env;
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  const hasProfile = listProfilesForProvider(authStore, "github-copilot").length > 0;
  const envToken = env.COPILOT_GITHUB_TOKEN ?? env.GH_TOKEN ?? env.GITHUB_TOKEN;
  const githubToken = (envToken ?? "").trim();
  if (!hasProfile && !githubToken) {
    return null;
  }
  let selectedGithubToken = githubToken;
  if (!selectedGithubToken && hasProfile) {
    const profileId = listProfilesForProvider(authStore, "github-copilot")[0];
    const profile = profileId ? authStore.profiles[profileId] : undefined;
    if (profile && profile.type === "token") {
      selectedGithubToken = profile.token;
    }
  }
  let baseUrl = DEFAULT_COPILOT_API_BASE_URL;
  if (selectedGithubToken) {
    try {
      const token = await resolveCopilotApiToken({
        githubToken: selectedGithubToken,
        env,
      });
      baseUrl = token.baseUrl;
    } catch {
      baseUrl = DEFAULT_COPILOT_API_BASE_URL;
    }
  }
  const models = discoverCopilotModels();
  return {
    baseUrl,
    api: "openai-responses",
    models,
  };
}
export async function resolveImplicitBedrockProvider(params) {
  const env = params.env ?? process.env;
  const discoveryConfig = params.config?.models?.bedrockDiscovery;
  const enabled = discoveryConfig?.enabled;
  const hasAwsCreds = resolveAwsSdkEnvVarName(env) !== undefined;
  if (enabled === false) {
    return null;
  }
  if (enabled !== true && !hasAwsCreds) {
    return null;
  }
  const region = discoveryConfig?.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1";
  const models = await discoverBedrockModels({
    region,
    config: discoveryConfig,
  });
  if (models.length === 0) {
    return null;
  }
  return {
    baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
    api: "bedrock-converse-stream",
    auth: "aws-sdk",
    models,
  };
}
