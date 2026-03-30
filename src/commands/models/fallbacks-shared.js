let getFallbacks = function (cfg, key) {
    const entry = cfg.agents?.defaults?.[key];
    return entry?.fallbacks ?? [];
  },
  patchDefaultsFallbacks = function (cfg, params) {
    const existing = cfg.agents?.defaults?.[params.key];
    return {
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: {
          ...cfg.agents?.defaults,
          [params.key]: mergePrimaryFallbackConfig(existing, { fallbacks: params.fallbacks }),
          ...(params.models ? { models: params.models } : undefined),
        },
      },
    };
  };
import { buildModelAliasIndex, resolveModelRefFromString } from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import {
  DEFAULT_PROVIDER,
  ensureFlagCompatibility,
  mergePrimaryFallbackConfig,
  modelKey,
  resolveModelTarget,
  resolveModelKeysFromEntries,
  updateConfig,
} from "./shared.js";
export async function listFallbacksCommand(params, opts, runtime) {
  ensureFlagCompatibility(opts);
  const cfg = loadConfig();
  const fallbacks = getFallbacks(cfg, params.key);
  if (opts.json) {
    runtime.log(JSON.stringify({ fallbacks }, null, 2));
    return;
  }
  if (opts.plain) {
    for (const entry of fallbacks) {
      runtime.log(entry);
    }
    return;
  }
  runtime.log(`${params.label} (${fallbacks.length}):`);
  if (fallbacks.length === 0) {
    runtime.log("- none");
    return;
  }
  for (const entry of fallbacks) {
    runtime.log(`- ${entry}`);
  }
}
export async function addFallbackCommand(params, modelRaw, runtime) {
  const updated = await updateConfig((cfg) => {
    const resolved = resolveModelTarget({ raw: modelRaw, cfg });
    const targetKey = modelKey(resolved.provider, resolved.model);
    const nextModels = { ...cfg.agents?.defaults?.models };
    if (!nextModels[targetKey]) {
      nextModels[targetKey] = {};
    }
    const existing = getFallbacks(cfg, params.key);
    const existingKeys = resolveModelKeysFromEntries({ cfg, entries: existing });
    if (existingKeys.includes(targetKey)) {
      return cfg;
    }
    return patchDefaultsFallbacks(cfg, {
      key: params.key,
      fallbacks: [...existing, targetKey],
      models: nextModels,
    });
  });
  logConfigUpdated(runtime);
  runtime.log(`${params.logPrefix}: ${getFallbacks(updated, params.key).join(", ")}`);
}
export async function removeFallbackCommand(params, modelRaw, runtime) {
  const updated = await updateConfig((cfg) => {
    const resolved = resolveModelTarget({ raw: modelRaw, cfg });
    const targetKey = modelKey(resolved.provider, resolved.model);
    const aliasIndex = buildModelAliasIndex({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
    });
    const existing = getFallbacks(cfg, params.key);
    const filtered = existing.filter((entry) => {
      const resolvedEntry = resolveModelRefFromString({
        raw: String(entry ?? ""),
        defaultProvider: DEFAULT_PROVIDER,
        aliasIndex,
      });
      if (!resolvedEntry) {
        return true;
      }
      return modelKey(resolvedEntry.ref.provider, resolvedEntry.ref.model) !== targetKey;
    });
    if (filtered.length === existing.length) {
      throw new Error(`${params.notFoundLabel} not found: ${targetKey}`);
    }
    return patchDefaultsFallbacks(cfg, { key: params.key, fallbacks: filtered });
  });
  logConfigUpdated(runtime);
  runtime.log(`${params.logPrefix}: ${getFallbacks(updated, params.key).join(", ")}`);
}
export async function clearFallbacksCommand(params, runtime) {
  await updateConfig((cfg) => {
    return patchDefaultsFallbacks(cfg, { key: params.key, fallbacks: [] });
  });
  logConfigUpdated(runtime);
  runtime.log(params.clearedMessage);
}
