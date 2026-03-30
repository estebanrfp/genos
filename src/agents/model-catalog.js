import { loadConfig } from "../config/config.js";
import { secureReadFile } from "../infra/secure-io.js";
import { resolveGenosOSAgentDir } from "./agent-paths.js";
import { ensureGenosOSModelsJson } from "./models-config.js";
let modelCatalogPromise = null;
let hasLoggedModelCatalogError = false;
export function resetModelCatalogCacheForTest() {
  modelCatalogPromise = null;
  hasLoggedModelCatalogError = false;
}
export function __setModelCatalogImportForTest() {}
/**
 * Load the model catalog from the static models.json file.
 * No SDK, no API discovery — pure static catalogs only.
 * @returns {Promise<object[]>}
 */
export async function loadModelCatalog(params) {
  if (params?.useCache === false) {
    modelCatalogPromise = null;
  }
  if (modelCatalogPromise) {
    return modelCatalogPromise;
  }
  modelCatalogPromise = (async () => {
    const models = [];
    const sortModels = (entries) =>
      entries.sort((a, b) => {
        const p = a.provider.localeCompare(b.provider);
        return p !== 0 ? p : a.name.localeCompare(b.name);
      });
    try {
      const cfg = params?.config ?? loadConfig();
      await ensureGenosOSModelsJson(cfg);
      const agentDir = resolveGenosOSAgentDir();
      const { join } = await import("node:path");
      const raw = await secureReadFile(join(agentDir, "models.json"));
      const config = JSON.parse(raw);
      for (const [providerName, provider] of Object.entries(config?.providers ?? {})) {
        for (const m of Array.isArray(provider?.models) ? provider.models : []) {
          const id = String(m?.id ?? "").trim();
          if (!id) {
            continue;
          }
          models.push({
            id,
            name: String(m?.name ?? id).trim() || id,
            provider: providerName,
            contextWindow:
              typeof m?.contextWindow === "number" && m.contextWindow > 0
                ? m.contextWindow
                : undefined,
            reasoning: typeof m?.reasoning === "boolean" ? m.reasoning : undefined,
            input: Array.isArray(m?.input) ? m.input : undefined,
          });
        }
      }
      if (models.length === 0) {
        modelCatalogPromise = null;
      }
      return sortModels(models);
    } catch (error) {
      if (!hasLoggedModelCatalogError) {
        hasLoggedModelCatalogError = true;
        console.warn(`[model-catalog] Failed to load model catalog: ${String(error)}`);
      }
      modelCatalogPromise = null;
      return models.length > 0 ? sortModels(models) : [];
    }
  })();
  return modelCatalogPromise;
}
export function modelSupportsVision(entry) {
  return entry?.input?.includes("image") ?? false;
}
export function findModelInCatalog(catalog, provider, modelId) {
  const normalizedProvider = provider.toLowerCase().trim();
  const normalizedModelId = modelId.toLowerCase().trim();
  return catalog.find(
    (entry) =>
      entry.provider.toLowerCase() === normalizedProvider &&
      entry.id.toLowerCase() === normalizedModelId,
  );
}
