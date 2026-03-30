import { loadAuthProfileStore } from "../../agents/auth-profiles/store.js";
import { resolveEnvApiKey } from "../../agents/model-auth.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";

/**
 * Extract unique provider names from auth profile store.
 * @param {object} store
 * @returns {Set<string>}
 */
const extractProviders = (store) => {
  const providers = new Set();
  const profiles = store?.profiles;
  if (!profiles || typeof profiles !== "object") {
    return providers;
  }
  for (const entry of Object.values(profiles)) {
    const provider = entry?.provider?.trim()?.toLowerCase();
    if (provider) {
      providers.add(provider);
    }
  }
  return providers;
};

export const modelsHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();

      if (!params?.onlyAvailable) {
        respond(true, { models: catalog }, undefined);
        return;
      }

      // Filter by configured auth profiles
      const store = loadAuthProfileStore();
      const providers = extractProviders(store);

      // Also allow providers that have a valid env-var API key configured
      // (e.g. GEMINI_API_KEY → google) even without an auth profile entry
      const catalogProviders = new Set(
        catalog.map((m) => m.provider?.toLowerCase()).filter(Boolean),
      );
      for (const provider of catalogProviders) {
        if (!providers.has(provider) && resolveEnvApiKey(provider)) {
          providers.add(provider);
        }
      }

      // Only include models from providers with configured auth
      const filtered = catalog.filter((m) => providers.has(m.provider?.toLowerCase()));
      respond(true, { models: filtered }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
