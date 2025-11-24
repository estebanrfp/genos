import { loadConfig } from "../config/config.js";
import { resolveGenosOSAgentDir } from "./agent-paths.js";
import { ensureGenosOSModelsJson } from "./models-config.js";
export function applyDiscoveredContextWindows(params) {
  for (const model of params.models) {
    if (!model?.id) {
      continue;
    }
    const contextWindow =
      typeof model.contextWindow === "number" ? Math.trunc(model.contextWindow) : undefined;
    if (!contextWindow || contextWindow <= 0) {
      continue;
    }
    const existing = params.cache.get(model.id);
    if (existing === undefined || contextWindow < existing) {
      params.cache.set(model.id, contextWindow);
    }
  }
}
export function applyConfiguredContextWindows(params) {
  const providers = params.modelsConfig?.providers;
  if (!providers || typeof providers !== "object") {
    return;
  }
  for (const provider of Object.values(providers)) {
    if (!Array.isArray(provider?.models)) {
      continue;
    }
    for (const model of provider.models) {
      const modelId = typeof model?.id === "string" ? model.id : undefined;
      const contextWindow =
        typeof model?.contextWindow === "number" ? model.contextWindow : undefined;
      if (!modelId || !contextWindow || contextWindow <= 0) {
        continue;
      }
      params.cache.set(modelId, contextWindow);
    }
  }
}
const MODEL_CACHE = new Map();
const _loadPromise = (async () => {
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    return;
  }
  try {
    await ensureGenosOSModelsJson(cfg);
  } catch {}
  try {
    const { discoverAuthStorage, discoverModels } = await import("./pi-model-discovery.js");
    const agentDir = resolveGenosOSAgentDir();
    const authStorage = discoverAuthStorage(agentDir);
    const modelRegistry = discoverModels(authStorage, agentDir);
    const models =
      typeof modelRegistry.getAvailable === "function"
        ? modelRegistry.getAvailable()
        : modelRegistry.getAll();
    applyDiscoveredContextWindows({
      cache: MODEL_CACHE,
      models,
    });
  } catch {}
  applyConfiguredContextWindows({
    cache: MODEL_CACHE,
    modelsConfig: cfg.models,
  });
})().catch(() => {});
export function lookupContextTokens(modelId) {
  if (!modelId) {
    return;
  }
  return MODEL_CACHE.get(modelId);
}
