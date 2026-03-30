let isAzureUrl = function (baseUrl) {
    try {
      const url = new URL(baseUrl);
      const host = url.hostname.toLowerCase();
      return host.endsWith(".services.ai.azure.com") || host.endsWith(".openai.azure.com");
    } catch {
      return false;
    }
  },
  transformAzureUrl = function (baseUrl, modelId) {
    const normalizedUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    if (normalizedUrl.includes("/openai/deployments/")) {
      return normalizedUrl;
    }
    return `${normalizedUrl}/openai/deployments/${modelId}`;
  },
  normalizeEndpointId = function (raw) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      return "";
    }
    return trimmed.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  },
  buildEndpointIdFromUrl = function (baseUrl) {
    try {
      const url = new URL(baseUrl);
      const host = url.hostname.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const port = url.port ? `-${url.port}` : "";
      const candidate = `custom-${host}${port}`;
      return normalizeEndpointId(candidate) || "custom";
    } catch {
      return "custom";
    }
  },
  resolveUniqueEndpointId = function (params) {
    const normalized = normalizeEndpointId(params.requestedId) || "custom";
    const existing = params.providers[normalized];
    if (!existing?.baseUrl || existing.baseUrl === params.baseUrl) {
      return { providerId: normalized, renamed: false };
    }
    let suffix = 2;
    let candidate = `${normalized}-${suffix}`;
    while (params.providers[candidate]) {
      suffix += 1;
      candidate = `${normalized}-${suffix}`;
    }
    return { providerId: candidate, renamed: true };
  },
  resolveAliasError = function (params) {
    const trimmed = params.raw.trim();
    if (!trimmed) {
      return;
    }
    let normalized;
    try {
      normalized = normalizeAlias(trimmed);
    } catch (err) {
      return err instanceof Error ? err.message : "Alias is invalid.";
    }
    const aliasIndex = buildModelAliasIndex({
      cfg: params.cfg,
      defaultProvider: DEFAULT_PROVIDER,
    });
    const aliasKey = normalized.toLowerCase();
    const existing = aliasIndex.byAlias.get(aliasKey);
    if (!existing) {
      return;
    }
    const existingKey = modelKey(existing.ref.provider, existing.ref.model);
    if (existingKey === params.modelRef) {
      return;
    }
    return `Alias ${normalized} already points to ${existingKey}.`;
  },
  buildOpenAiHeaders = function (apiKey) {
    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  },
  buildAnthropicHeaders = function (apiKey) {
    const headers = {
      "anthropic-version": "2023-06-01",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    return headers;
  },
  formatVerificationError = function (error) {
    if (!error) {
      return "unknown error";
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "unknown error";
    }
  },
  resolveVerificationEndpoint = function (params) {
    const resolvedUrl = isAzureUrl(params.baseUrl)
      ? transformAzureUrl(params.baseUrl, params.modelId)
      : params.baseUrl;
    const endpointUrl = new URL(
      params.endpointPath,
      resolvedUrl.endsWith("/") ? resolvedUrl : `${resolvedUrl}/`,
    );
    if (isAzureUrl(params.baseUrl)) {
      endpointUrl.searchParams.set("api-version", "2024-10-21");
    }
    return endpointUrl.href;
  },
  resolveProviderApi = function (compatibility) {
    return compatibility === "anthropic" ? "anthropic-messages" : "openai-completions";
  },
  parseCustomApiCompatibility = function (raw) {
    const compatibilityRaw = raw?.trim().toLowerCase();
    if (!compatibilityRaw) {
      return "openai";
    }
    if (compatibilityRaw !== "openai" && compatibilityRaw !== "anthropic") {
      throw new CustomApiError(
        "invalid_compatibility",
        'Invalid --custom-compatibility (use "openai" or "anthropic").',
      );
    }
    return compatibilityRaw;
  };
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { buildModelAliasIndex, modelKey } from "../agents/model-selection.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { applyPrimaryModel } from "./model-picker.js";
import { normalizeAlias } from "./models/shared.js";
const DEFAULT_CONTEXT_WINDOW = 4096;
const DEFAULT_MAX_TOKENS = 4096;
const VERIFY_TIMEOUT_MS = 1e4;

export class CustomApiError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "CustomApiError";
    this.code = code;
  }
}
const COMPATIBILITY_OPTIONS = [
  {
    value: "openai",
    label: "OpenAI-compatible",
    hint: "Uses /chat/completions",
  },
  {
    value: "anthropic",
    label: "Anthropic-compatible",
    hint: "Uses /messages",
  },
  {
    value: "unknown",
    label: "Unknown (detect automatically)",
    hint: "Probes OpenAI then Anthropic endpoints",
  },
];
async function requestVerification(params) {
  try {
    const res = await fetchWithTimeout(
      params.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...params.headers,
        },
        body: JSON.stringify(params.body),
      },
      VERIFY_TIMEOUT_MS,
    );
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error };
  }
}
async function requestOpenAiVerification(params) {
  const endpoint = resolveVerificationEndpoint({
    baseUrl: params.baseUrl,
    modelId: params.modelId,
    endpointPath: "chat/completions",
  });
  return await requestVerification({
    endpoint,
    headers: buildOpenAiHeaders(params.apiKey),
    body: {
      model: params.modelId,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
    },
  });
}
async function requestAnthropicVerification(params) {
  const endpoint = resolveVerificationEndpoint({
    baseUrl: params.baseUrl,
    modelId: params.modelId,
    endpointPath: "messages",
  });
  return await requestVerification({
    endpoint,
    headers: buildAnthropicHeaders(params.apiKey),
    body: {
      model: params.modelId,
      max_tokens: 16,
      messages: [{ role: "user", content: "Hi" }],
    },
  });
}
async function promptBaseUrlAndKey(params) {
  const baseUrlInput = await params.prompter.text({
    message: "API Base URL",
    initialValue: params.initialBaseUrl ?? "https://api.example.com/v1",
    placeholder: "https://api.example.com/v1",
    validate: (val) => {
      try {
        new URL(val);
        return;
      } catch {
        return "Please enter a valid URL (e.g. http://...)";
      }
    },
  });
  const apiKeyInput = await params.prompter.text({
    message: "API Key (leave blank if not required)",
    placeholder: "sk-...",
    initialValue: "",
  });
  return { baseUrl: baseUrlInput.trim(), apiKey: apiKeyInput.trim() };
}
async function promptCustomApiRetryChoice(prompter) {
  return await prompter.select({
    message: "What would you like to change?",
    options: [
      { value: "baseUrl", label: "Change base URL" },
      { value: "model", label: "Change model" },
      { value: "both", label: "Change base URL and model" },
    ],
  });
}
async function promptCustomApiModelId(prompter) {
  return (
    await prompter.text({
      message: "Model ID",
      placeholder: "e.g. llama3, claude-3-7-sonnet",
      validate: (val) => (val.trim() ? undefined : "Model ID is required"),
    })
  ).trim();
}
export function resolveCustomProviderId(params) {
  const providers = params.config.models?.providers ?? {};
  const baseUrl = params.baseUrl.trim();
  const explicitProviderId = params.providerId?.trim();
  if (explicitProviderId && !normalizeEndpointId(explicitProviderId)) {
    throw new CustomApiError(
      "invalid_provider_id",
      "Custom provider ID must include letters, numbers, or hyphens.",
    );
  }
  const requestedProviderId = explicitProviderId || buildEndpointIdFromUrl(baseUrl);
  const providerIdResult = resolveUniqueEndpointId({
    requestedId: requestedProviderId,
    baseUrl,
    providers,
  });
  return {
    providerId: providerIdResult.providerId,
    ...(providerIdResult.renamed
      ? {
          providerIdRenamedFrom: normalizeEndpointId(requestedProviderId) || "custom",
        }
      : {}),
  };
}
export function parseNonInteractiveCustomApiFlags(params) {
  const baseUrl = params.baseUrl?.trim() ?? "";
  const modelId = params.modelId?.trim() ?? "";
  if (!baseUrl || !modelId) {
    throw new CustomApiError(
      "missing_required",
      [
        'Auth choice "custom-api-key" requires a base URL and model ID.',
        "Use --custom-base-url and --custom-model-id.",
      ].join("\n"),
    );
  }
  const apiKey = params.apiKey?.trim();
  const providerId = params.providerId?.trim();
  if (providerId && !normalizeEndpointId(providerId)) {
    throw new CustomApiError(
      "invalid_provider_id",
      "Custom provider ID must include letters, numbers, or hyphens.",
    );
  }
  return {
    baseUrl,
    modelId,
    compatibility: parseCustomApiCompatibility(params.compatibility),
    ...(apiKey ? { apiKey } : {}),
    ...(providerId ? { providerId } : {}),
  };
}
export function applyCustomApiConfig(params) {
  const baseUrl = params.baseUrl.trim();
  try {
    new URL(baseUrl);
  } catch {
    throw new CustomApiError("invalid_base_url", "Custom provider base URL must be a valid URL.");
  }
  if (params.compatibility !== "openai" && params.compatibility !== "anthropic") {
    throw new CustomApiError(
      "invalid_compatibility",
      'Custom provider compatibility must be "openai" or "anthropic".',
    );
  }
  const modelId = params.modelId.trim();
  if (!modelId) {
    throw new CustomApiError("invalid_model_id", "Custom provider model ID is required.");
  }
  const resolvedBaseUrl = isAzureUrl(baseUrl) ? transformAzureUrl(baseUrl, modelId) : baseUrl;
  const providerIdResult = resolveCustomProviderId({
    config: params.config,
    baseUrl: resolvedBaseUrl,
    providerId: params.providerId,
  });
  const providerId = providerIdResult.providerId;
  const providers = params.config.models?.providers ?? {};
  const modelRef = modelKey(providerId, modelId);
  const alias = params.alias?.trim() ?? "";
  const aliasError = resolveAliasError({
    raw: alias,
    cfg: params.config,
    modelRef,
  });
  if (aliasError) {
    throw new CustomApiError("invalid_alias", aliasError);
  }
  const existingProvider = providers[providerId];
  const existingModels = Array.isArray(existingProvider?.models) ? existingProvider.models : [];
  const hasModel = existingModels.some((model) => model.id === modelId);
  const nextModel = {
    id: modelId,
    name: `${modelId} (Custom Provider)`,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
  };
  const mergedModels = hasModel ? existingModels : [...existingModels, nextModel];
  const { apiKey: existingApiKey, ...existingProviderRest } = existingProvider ?? {};
  const normalizedApiKey =
    params.apiKey?.trim() || (existingApiKey ? existingApiKey.trim() : undefined);
  let config = {
    ...params.config,
    models: {
      ...params.config.models,
      mode: params.config.models?.mode ?? "merge",
      providers: {
        ...providers,
        [providerId]: {
          ...existingProviderRest,
          baseUrl: resolvedBaseUrl,
          api: resolveProviderApi(params.compatibility),
          ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
          models: mergedModels.length > 0 ? mergedModels : [nextModel],
        },
      },
    },
  };
  config = applyPrimaryModel(config, modelRef);
  if (alias) {
    config = {
      ...config,
      agents: {
        ...config.agents,
        defaults: {
          ...config.agents?.defaults,
          models: {
            ...config.agents?.defaults?.models,
            [modelRef]: {
              ...config.agents?.defaults?.models?.[modelRef],
              alias,
            },
          },
        },
      },
    };
  }
  return {
    config,
    providerId,
    modelId,
    ...(providerIdResult.providerIdRenamedFrom
      ? { providerIdRenamedFrom: providerIdResult.providerIdRenamedFrom }
      : {}),
  };
}
export async function promptCustomApiConfig(params) {
  const { prompter, runtime, config } = params;
  const baseInput = await promptBaseUrlAndKey({ prompter });
  let baseUrl = baseInput.baseUrl;
  let apiKey = baseInput.apiKey;
  const compatibilityChoice = await prompter.select({
    message: "Endpoint compatibility",
    options: COMPATIBILITY_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.hint,
    })),
  });
  let modelId = await promptCustomApiModelId(prompter);
  let compatibility = compatibilityChoice === "unknown" ? null : compatibilityChoice;
  while (true) {
    let verifiedFromProbe = false;
    if (!compatibility) {
      const probeSpinner = prompter.progress("Detecting endpoint type...");
      const openaiProbe = await requestOpenAiVerification({ baseUrl, apiKey, modelId });
      if (openaiProbe.ok) {
        probeSpinner.stop("Detected OpenAI-compatible endpoint.");
        compatibility = "openai";
        verifiedFromProbe = true;
      } else {
        const anthropicProbe = await requestAnthropicVerification({ baseUrl, apiKey, modelId });
        if (anthropicProbe.ok) {
          probeSpinner.stop("Detected Anthropic-compatible endpoint.");
          compatibility = "anthropic";
          verifiedFromProbe = true;
        } else {
          probeSpinner.stop("Could not detect endpoint type.");
          await prompter.note(
            "This endpoint did not respond to OpenAI or Anthropic style requests.",
            "Endpoint detection",
          );
          const retryChoice = await promptCustomApiRetryChoice(prompter);
          if (retryChoice === "baseUrl" || retryChoice === "both") {
            const retryInput = await promptBaseUrlAndKey({
              prompter,
              initialBaseUrl: baseUrl,
            });
            baseUrl = retryInput.baseUrl;
            apiKey = retryInput.apiKey;
          }
          if (retryChoice === "model" || retryChoice === "both") {
            modelId = await promptCustomApiModelId(prompter);
          }
          continue;
        }
      }
    }
    if (verifiedFromProbe) {
      break;
    }
    const verifySpinner = prompter.progress("Verifying...");
    const result =
      compatibility === "anthropic"
        ? await requestAnthropicVerification({ baseUrl, apiKey, modelId })
        : await requestOpenAiVerification({ baseUrl, apiKey, modelId });
    if (result.ok) {
      verifySpinner.stop("Verification successful.");
      break;
    }
    if (result.status !== undefined) {
      verifySpinner.stop(`Verification failed: status ${result.status}`);
    } else {
      verifySpinner.stop(`Verification failed: ${formatVerificationError(result.error)}`);
    }
    const retryChoice = await promptCustomApiRetryChoice(prompter);
    if (retryChoice === "baseUrl" || retryChoice === "both") {
      const retryInput = await promptBaseUrlAndKey({
        prompter,
        initialBaseUrl: baseUrl,
      });
      baseUrl = retryInput.baseUrl;
      apiKey = retryInput.apiKey;
    }
    if (retryChoice === "model" || retryChoice === "both") {
      modelId = await promptCustomApiModelId(prompter);
    }
    if (compatibilityChoice === "unknown") {
      compatibility = null;
    }
  }
  const providers = config.models?.providers ?? {};
  const suggestedId = buildEndpointIdFromUrl(baseUrl);
  const providerIdInput = await prompter.text({
    message: "Endpoint ID",
    initialValue: suggestedId,
    placeholder: "custom",
    validate: (value) => {
      const normalized = normalizeEndpointId(value);
      if (!normalized) {
        return "Endpoint ID is required.";
      }
      return;
    },
  });
  const aliasInput = await prompter.text({
    message: "Model alias (optional)",
    placeholder: "e.g. local, custom",
    initialValue: "",
    validate: (value) => {
      const requestedId = normalizeEndpointId(providerIdInput) || "custom";
      const providerIdResult = resolveUniqueEndpointId({
        requestedId,
        baseUrl,
        providers,
      });
      const modelRef = modelKey(providerIdResult.providerId, modelId);
      return resolveAliasError({ raw: value, cfg: config, modelRef });
    },
  });
  const resolvedCompatibility = compatibility ?? "openai";
  const result = applyCustomApiConfig({
    config,
    baseUrl,
    modelId,
    compatibility: resolvedCompatibility,
    apiKey,
    providerId: providerIdInput,
    alias: aliasInput,
  });
  if (result.providerIdRenamedFrom && result.providerId) {
    await prompter.note(
      `Endpoint ID "${result.providerIdRenamedFrom}" already exists for a different base URL. Using "${result.providerId}".`,
      "Endpoint ID",
    );
  }
  runtime.log(`Configured custom provider: ${result.providerId}/${result.modelId}`);
  return result;
}
