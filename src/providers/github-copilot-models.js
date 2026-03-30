import catalog from "../agents/static-model-catalog.json" with { type: "json" };

const copilotCatalog = catalog["github-copilot"];

/** @returns {string[]} Default Copilot model IDs from static catalog. */
export function getDefaultCopilotModelIds() {
  return Object.values(copilotCatalog.models).map((m) => m.id);
}

/**
 * Build a Copilot model definition from the static catalog.
 * Falls back to heuristic for user-added IDs not in catalog.
 * @param {string} modelId
 */
export function buildCopilotModelDefinition(modelId) {
  const id = modelId.trim();
  if (!id) {
    throw new Error("Model id required");
  }
  const found = Object.values(copilotCatalog.models).find((m) => m.id === id);
  if (found) {
    return { ...found, api: copilotCatalog.api };
  }
  // Fallback for user-added model IDs not in catalog
  const lower = id.toLowerCase();
  const reasoning =
    lower.includes("opus") ||
    lower.includes("sonnet") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4");
  return {
    id,
    name: id,
    api: copilotCatalog.api,
    reasoning,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}
