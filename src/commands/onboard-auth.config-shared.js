let extractAgentDefaultModelFallbacks = function (model) {
    if (!model || typeof model !== "object") {
      return;
    }
    if (!("fallbacks" in model)) {
      return;
    }
    const fallbacks = model.fallbacks;
    return Array.isArray(fallbacks) ? fallbacks.map((v) => String(v)) : undefined;
  },
  buildProviderConfig = function (params) {
    const { apiKey: existingApiKey, ...existingProviderRest } = params.existingProvider ?? {};
    const normalizedApiKey = typeof existingApiKey === "string" ? existingApiKey.trim() : undefined;
    return {
      ...existingProviderRest,
      baseUrl: params.baseUrl,
      api: params.api,
      ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
      models: params.mergedModels.length > 0 ? params.mergedModels : params.fallbackModels,
    };
  };
export function applyOnboardAuthAgentModelsAndProviders(cfg, params) {
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models: params.agentModels,
      },
    },
    models: {
      mode: cfg.models?.mode ?? "merge",
      providers: params.providers,
    },
  };
}
export function applyAgentDefaultModelPrimary(cfg, primary) {
  const existingFallbacks = extractAgentDefaultModelFallbacks(cfg.agents?.defaults?.model);
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        model: {
          ...(existingFallbacks ? { fallbacks: existingFallbacks } : undefined),
          primary,
        },
      },
    },
  };
}
export function applyProviderConfigWithDefaultModels(cfg, params) {
  const providers = { ...cfg.models?.providers };
  const existingProvider = providers[params.providerId];
  const existingModels = Array.isArray(existingProvider?.models) ? existingProvider.models : [];
  const defaultModels = params.defaultModels;
  const defaultModelId = params.defaultModelId ?? defaultModels[0]?.id;
  const hasDefaultModel = defaultModelId
    ? existingModels.some((model) => model.id === defaultModelId)
    : true;
  const mergedModels =
    existingModels.length > 0
      ? hasDefaultModel || defaultModels.length === 0
        ? existingModels
        : [...existingModels, ...defaultModels]
      : defaultModels;
  providers[params.providerId] = buildProviderConfig({
    existingProvider,
    api: params.api,
    baseUrl: params.baseUrl,
    mergedModels,
    fallbackModels: defaultModels,
  });
  return applyOnboardAuthAgentModelsAndProviders(cfg, {
    agentModels: params.agentModels,
    providers,
  });
}
export function applyProviderConfigWithDefaultModel(cfg, params) {
  return applyProviderConfigWithDefaultModels(cfg, {
    agentModels: params.agentModels,
    providerId: params.providerId,
    api: params.api,
    baseUrl: params.baseUrl,
    defaultModels: [params.defaultModel],
    defaultModelId: params.defaultModelId ?? params.defaultModel.id,
  });
}
export function applyProviderConfigWithModelCatalog(cfg, params) {
  const providers = { ...cfg.models?.providers };
  const existingProvider = providers[params.providerId];
  const existingModels = Array.isArray(existingProvider?.models) ? existingProvider.models : [];
  const catalogModels = params.catalogModels;
  const mergedModels =
    existingModels.length > 0
      ? [
          ...existingModels,
          ...catalogModels.filter(
            (model) => !existingModels.some((existing) => existing.id === model.id),
          ),
        ]
      : catalogModels;
  providers[params.providerId] = buildProviderConfig({
    existingProvider,
    api: params.api,
    baseUrl: params.baseUrl,
    mergedModels,
    fallbackModels: catalogModels,
  });
  return applyOnboardAuthAgentModelsAndProviders(cfg, {
    agentModels: params.agentModels,
    providers,
  });
}
