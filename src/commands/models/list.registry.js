let createAvailabilityUnavailableError = function (message) {
    const err = new Error(message);
    err.code = MODEL_AVAILABILITY_UNAVAILABLE_CODE;
    return err;
  },
  normalizeAvailabilityError = function (err) {
    if (shouldFallbackToAuthHeuristics(err) && err instanceof Error) {
      return err;
    }
    return createAvailabilityUnavailableError(
      `Model availability unavailable: getAvailable() failed.\n${formatErrorWithStack(err)}`,
    );
  },
  validateAvailableModels = function (availableModels) {
    if (!Array.isArray(availableModels)) {
      throw createAvailabilityUnavailableError(
        "Model availability unavailable: getAvailable() returned a non-array value.",
      );
    }
    for (const model of availableModels) {
      if (
        !model ||
        typeof model !== "object" ||
        typeof model.provider !== "string" ||
        typeof model.id !== "string"
      ) {
        throw createAvailabilityUnavailableError(
          "Model availability unavailable: getAvailable() returned invalid model entries.",
        );
      }
    }
    return availableModels;
  },
  loadAvailableModels = function (registry) {
    let availableModels;
    try {
      availableModels = registry.getAvailable();
    } catch (err) {
      throw normalizeAvailabilityError(err);
    }
    try {
      return validateAvailableModels(availableModels);
    } catch (err) {
      throw normalizeAvailabilityError(err);
    }
  },
  appendAntigravityForwardCompatModels = function (models, modelRegistry) {
    const nextModels = [...models];
    const synthesizedForwardCompat = [];
    for (const candidate of ANTIGRAVITY_OPUS_46_FORWARD_COMPAT_CANDIDATES) {
      const key = modelKey("google-antigravity", candidate.id);
      const hasForwardCompat = nextModels.some(
        (model) => modelKey(model.provider, model.id) === key,
      );
      if (hasForwardCompat) {
        continue;
      }
      const fallback = resolveForwardCompatModel("google-antigravity", candidate.id, modelRegistry);
      if (!fallback) {
        continue;
      }
      nextModels.push(fallback);
      synthesizedForwardCompat.push({
        key,
        templatePrefixes: candidate.templatePrefixes,
      });
    }
    return { models: nextModels, synthesizedForwardCompat };
  },
  hasAvailableTemplate = function (availableKeys, templatePrefixes) {
    for (const key of availableKeys) {
      if (templatePrefixes.some((prefix) => key.startsWith(prefix))) {
        return true;
      }
    }
    return false;
  };
import { resolveGenosOSAgentDir } from "../../agents/agent-paths.js";
import { listProfilesForProvider } from "../../agents/auth-profiles.js";
import {
  getCustomProviderApiKey,
  resolveAwsSdkEnvVarName,
  resolveEnvApiKey,
} from "../../agents/model-auth.js";
import {
  ANTIGRAVITY_OPUS_46_FORWARD_COMPAT_CANDIDATES,
  resolveForwardCompatModel,
} from "../../agents/model-forward-compat.js";
import { ensureGenosOSModelsJson } from "../../agents/models-config.js";
import { ensurePiAuthJsonFromAuthProfiles } from "../../agents/pi-auth-json.js";
import { discoverAuthStorage, discoverModels } from "../../agents/pi-model-discovery.js";
import {
  formatErrorWithStack,
  MODEL_AVAILABILITY_UNAVAILABLE_CODE,
  shouldFallbackToAuthHeuristics,
} from "./list.errors.js";
import { isLocalBaseUrl, modelKey } from "./shared.js";
const hasAuthForProvider = (provider, cfg, authStore) => {
  if (!cfg || !authStore) {
    return false;
  }
  if (listProfilesForProvider(authStore, provider).length > 0) {
    return true;
  }
  if (provider === "amazon-bedrock" && resolveAwsSdkEnvVarName()) {
    return true;
  }
  if (resolveEnvApiKey(provider)) {
    return true;
  }
  if (getCustomProviderApiKey(cfg, provider)) {
    return true;
  }
  return false;
};
export async function loadModelRegistry(cfg) {
  await ensureGenosOSModelsJson(cfg);
  const agentDir = resolveGenosOSAgentDir();
  await ensurePiAuthJsonFromAuthProfiles(agentDir);
  const authStorage = discoverAuthStorage(agentDir);
  const registry = discoverModels(authStorage, agentDir);
  const appended = appendAntigravityForwardCompatModels(registry.getAll(), registry);
  const models = appended.models;
  const synthesizedForwardCompat = appended.synthesizedForwardCompat;
  let availableKeys;
  let availabilityErrorMessage;
  try {
    const availableModels = loadAvailableModels(registry);
    availableKeys = new Set(availableModels.map((model) => modelKey(model.provider, model.id)));
    for (const synthesized of synthesizedForwardCompat) {
      if (hasAvailableTemplate(availableKeys, synthesized.templatePrefixes)) {
        availableKeys.add(synthesized.key);
      }
    }
  } catch (err) {
    if (!shouldFallbackToAuthHeuristics(err)) {
      throw err;
    }
    availableKeys = undefined;
    if (!availabilityErrorMessage) {
      availabilityErrorMessage = formatErrorWithStack(err);
    }
  }
  return { registry, models, availableKeys, availabilityErrorMessage };
}
export function toModelRow(params) {
  const { model, key, tags, aliases = [], availableKeys, cfg, authStore } = params;
  if (!model) {
    return {
      key,
      name: key,
      input: "-",
      contextWindow: null,
      local: null,
      available: null,
      tags: [...tags, "missing"],
      missing: true,
    };
  }
  const input = model.input.join("+") || "text";
  const local = isLocalBaseUrl(model.baseUrl);
  const available =
    availableKeys !== undefined
      ? availableKeys.has(modelKey(model.provider, model.id))
      : cfg && authStore
        ? hasAuthForProvider(model.provider, cfg, authStore)
        : false;
  const aliasTags = aliases.length > 0 ? [`alias:${aliases.join(",")}`] : [];
  const mergedTags = new Set(tags);
  if (aliasTags.length > 0) {
    for (const tag of mergedTags) {
      if (tag === "alias" || tag.startsWith("alias:")) {
        mergedTags.delete(tag);
      }
    }
    for (const tag of aliasTags) {
      mergedTags.add(tag);
    }
  }
  return {
    key,
    name: model.name || model.id,
    input,
    contextWindow: model.contextWindow ?? null,
    local,
    available,
    tags: Array.from(mergedTags),
    missing: false,
  };
}
