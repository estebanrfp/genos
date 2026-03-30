let isPlainRecord = function (value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
};
import { normalizeProviderId } from "../agents/model-selection.js";
export function resolveProviderMatch(providers, rawProvider) {
  const raw = rawProvider?.trim();
  if (!raw) {
    return null;
  }
  const normalized = normalizeProviderId(raw);
  return (
    providers.find((provider) => normalizeProviderId(provider.id) === normalized) ??
    providers.find(
      (provider) =>
        provider.aliases?.some((alias) => normalizeProviderId(alias) === normalized) ?? false,
    ) ??
    null
  );
}
export function pickAuthMethod(provider, rawMethod) {
  const raw = rawMethod?.trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  return (
    provider.auth.find((method) => method.id.toLowerCase() === normalized) ??
    provider.auth.find((method) => method.label.toLowerCase() === normalized) ??
    null
  );
}
export function mergeConfigPatch(base, patch) {
  if (!isPlainRecord(base) || !isPlainRecord(patch)) {
    return patch;
  }
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = next[key];
    if (isPlainRecord(existing) && isPlainRecord(value)) {
      next[key] = mergeConfigPatch(existing, value);
    } else {
      next[key] = value;
    }
  }
  return next;
}
export function applyDefaultModel(cfg, model) {
  const models = { ...cfg.agents?.defaults?.models };
  models[model] = models[model] ?? {};
  const existingModel = cfg.agents?.defaults?.model;
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
        model: {
          ...(existingModel && typeof existingModel === "object" && "fallbacks" in existingModel
            ? { fallbacks: existingModel.fallbacks }
            : undefined),
          primary: model,
        },
      },
    },
  };
}
