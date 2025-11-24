let resolveCacheRetention = function (extraParams, provider) {
    if (provider !== "anthropic") {
      return;
    }
    const newVal = extraParams?.cacheRetention;
    if (newVal === "none" || newVal === "short" || newVal === "long") {
      return newVal;
    }
    const legacy = extraParams?.cacheControlTtl;
    if (legacy === "5m") {
      return "short";
    }
    if (legacy === "1h") {
      return "long";
    }
    return;
  },
  createStreamFnWithExtraParams = function (baseStreamFn, extraParams, provider) {
    if (!extraParams || Object.keys(extraParams).length === 0) {
      return;
    }
    const streamParams = {};
    if (typeof extraParams.temperature === "number") {
      streamParams.temperature = extraParams.temperature;
    }
    if (typeof extraParams.maxTokens === "number") {
      streamParams.maxTokens = extraParams.maxTokens;
    }
    const cacheRetention = resolveCacheRetention(extraParams, provider);
    if (cacheRetention) {
      streamParams.cacheRetention = cacheRetention;
    }
    if (Object.keys(streamParams).length === 0) {
      return;
    }
    log.debug(`creating streamFn wrapper with params: ${JSON.stringify(streamParams)}`);
    const underlying = baseStreamFn ?? streamSimple;
    const wrappedStreamFn = (model, context, options) =>
      underlying(model, context, {
        ...streamParams,
        ...options,
      });
    return wrappedStreamFn;
  },
  isDirectOpenAIBaseUrl = function (baseUrl) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
      return true;
    }
    try {
      const host = new URL(baseUrl).hostname.toLowerCase();
      return host === "api.openai.com" || host === "chatgpt.com";
    } catch {
      const normalized = baseUrl.toLowerCase();
      return normalized.includes("api.openai.com") || normalized.includes("chatgpt.com");
    }
  },
  shouldForceResponsesStore = function (model) {
    if (typeof model.api !== "string" || typeof model.provider !== "string") {
      return false;
    }
    if (!OPENAI_RESPONSES_APIS.has(model.api)) {
      return false;
    }
    if (!OPENAI_RESPONSES_PROVIDERS.has(model.provider)) {
      return false;
    }
    return isDirectOpenAIBaseUrl(model.baseUrl);
  },
  createOpenAIResponsesStoreWrapper = function (baseStreamFn) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
      if (!shouldForceResponsesStore(model)) {
        return underlying(model, context, options);
      }
      const originalOnPayload = options?.onPayload;
      return underlying(model, context, {
        ...options,
        onPayload: (payload) => {
          if (payload && typeof payload === "object") {
            payload.store = true;
          }
          originalOnPayload?.(payload);
        },
      });
    };
  },
  isAnthropic1MModel = function (modelId) {
    const normalized = modelId.trim().toLowerCase();
    return ANTHROPIC_1M_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  },
  parseHeaderList = function (value) {
    if (typeof value !== "string") {
      return [];
    }
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  },
  resolveAnthropicBetas = function (extraParams, provider, modelId) {
    if (provider !== "anthropic") {
      return;
    }
    const betas = new Set();
    const configured = extraParams?.anthropicBeta;
    if (typeof configured === "string" && configured.trim()) {
      betas.add(configured.trim());
    } else if (Array.isArray(configured)) {
      for (const beta of configured) {
        if (typeof beta === "string" && beta.trim()) {
          betas.add(beta.trim());
        }
      }
    }
    if (extraParams?.context1m === true) {
      if (isAnthropic1MModel(modelId)) {
        betas.add(ANTHROPIC_CONTEXT_1M_BETA);
      } else {
        log.warn(`ignoring context1m for non-opus/sonnet model: ${provider}/${modelId}`);
      }
    }
    return betas.size > 0 ? [...betas] : undefined;
  },
  mergeAnthropicBetaHeader = function (headers, betas) {
    const merged = { ...headers };
    const existingKey = Object.keys(merged).find((key) => key.toLowerCase() === "anthropic-beta");
    const existing = existingKey ? parseHeaderList(merged[existingKey]) : [];
    const values = Array.from(new Set([...existing, ...betas]));
    const key = existingKey ?? "anthropic-beta";
    merged[key] = values.join(",");
    return merged;
  },
  createAnthropicBetaHeadersWrapper = function (baseStreamFn, betas) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) =>
      underlying(model, context, {
        ...options,
        headers: mergeAnthropicBetaHeader(options?.headers, betas),
      });
  },
  createOpenRouterHeadersWrapper = function (baseStreamFn) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) =>
      underlying(model, context, {
        ...options,
        headers: {
          ...OPENROUTER_APP_HEADERS,
          ...options?.headers,
        },
      });
  },
  createZaiToolStreamWrapper = function (baseStreamFn, enabled) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
      if (!enabled) {
        return underlying(model, context, options);
      }
      const originalOnPayload = options?.onPayload;
      return underlying(model, context, {
        ...options,
        onPayload: (payload) => {
          if (payload && typeof payload === "object") {
            payload.tool_stream = true;
          }
          originalOnPayload?.(payload);
        },
      });
    };
  };
import { streamSimple } from "@mariozechner/pi-ai";
import { log } from "./logger.js";
const OPENROUTER_APP_HEADERS = {
  "HTTP-Referer": "https://genosos.ai",
  "X-Title": "GenosOS",
};
const ANTHROPIC_CONTEXT_1M_BETA = "context-1m-2025-08-07";
const ANTHROPIC_1M_MODEL_PREFIXES = ["claude-opus-4", "claude-sonnet-4"];
const OPENAI_RESPONSES_APIS = new Set(["openai-responses"]);
const OPENAI_RESPONSES_PROVIDERS = new Set(["openai"]);
export function resolveExtraParams(params) {
  const modelKey = `${params.provider}/${params.modelId}`;
  const modelConfig = params.cfg?.agents?.defaults?.models?.[modelKey];
  return modelConfig?.params ? { ...modelConfig.params } : undefined;
}
export function applyExtraParamsToAgent(agent, cfg, provider, modelId, extraParamsOverride) {
  const extraParams = resolveExtraParams({
    cfg,
    provider,
    modelId,
  });
  const override =
    extraParamsOverride && Object.keys(extraParamsOverride).length > 0
      ? Object.fromEntries(
          Object.entries(extraParamsOverride).filter(([, value]) => value !== undefined),
        )
      : undefined;
  const merged = Object.assign({}, extraParams, override);
  const wrappedStreamFn = createStreamFnWithExtraParams(agent.streamFn, merged, provider);
  if (wrappedStreamFn) {
    log.debug(`applying extraParams to agent streamFn for ${provider}/${modelId}`);
    agent.streamFn = wrappedStreamFn;
  }
  const anthropicBetas = resolveAnthropicBetas(merged, provider, modelId);
  if (anthropicBetas?.length) {
    log.debug(
      `applying Anthropic beta header for ${provider}/${modelId}: ${anthropicBetas.join(",")}`,
    );
    agent.streamFn = createAnthropicBetaHeadersWrapper(agent.streamFn, anthropicBetas);
  }
  if (provider === "openrouter") {
    log.debug(`applying OpenRouter app attribution headers for ${provider}/${modelId}`);
    agent.streamFn = createOpenRouterHeadersWrapper(agent.streamFn);
  }
  if (provider === "zai" || provider === "z-ai") {
    const toolStreamEnabled = merged?.tool_stream !== false;
    if (toolStreamEnabled) {
      log.debug(`enabling Z.AI tool_stream for ${provider}/${modelId}`);
      agent.streamFn = createZaiToolStreamWrapper(agent.streamFn, true);
    }
  }
  agent.streamFn = createOpenAIResponsesStoreWrapper(agent.streamFn);
}
