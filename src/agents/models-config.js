let mergeProviderModels = function (implicit, explicit) {
    const implicitModels = Array.isArray(implicit.models) ? implicit.models : [];
    const explicitModels = Array.isArray(explicit.models) ? explicit.models : [];
    if (implicitModels.length === 0) {
      return { ...implicit, ...explicit };
    }
    const getId = (model) => {
      if (!model || typeof model !== "object") {
        return "";
      }
      const id = model.id;
      return typeof id === "string" ? id.trim() : "";
    };
    const seen = new Set(explicitModels.map(getId).filter(Boolean));
    const mergedModels = [
      ...explicitModels,
      ...implicitModels.filter((model) => {
        const id = getId(model);
        if (!id) {
          return false;
        }
        if (seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      }),
    ];
    return {
      ...implicit,
      ...explicit,
      models: mergedModels,
    };
  },
  mergeProviders = function (params) {
    const out = params.implicit ? { ...params.implicit } : {};
    for (const [key, explicit] of Object.entries(params.explicit ?? {})) {
      const providerKey = key.trim();
      if (!providerKey) {
        continue;
      }
      const implicit = out[providerKey];
      out[providerKey] = implicit ? mergeProviderModels(implicit, explicit) : explicit;
    }
    return out;
  };
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/config.js";
import { secureReadFile, secureWriteFile } from "../infra/secure-io.js";
import { isRecord } from "../utils.js";
import { resolveGenosOSAgentDir } from "./agent-paths.js";
import {
  normalizeProviders,
  resolveImplicitBedrockProvider,
  resolveImplicitCopilotProvider,
  resolveImplicitProviders,
} from "./models-config.providers.js";
import catalog from "./static-model-catalog.json" with { type: "json" };
const DEFAULT_MODE = "merge";
async function readJson(pathname) {
  try {
    const raw = await secureReadFile(pathname);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export async function ensureGenosOSModelsJson(config, agentDirOverride) {
  const cfg = config ?? loadConfig();
  const agentDir = agentDirOverride?.trim() ? agentDirOverride.trim() : resolveGenosOSAgentDir();
  // Source 1: cfg.providers (new unified format, post-migration)
  // Source 2: cfg.models.providers (legacy fallback, pre-migration)
  // cfg.providers wins on conflict (more specific endpoint/model config)
  const legacyModelProviders = cfg.models?.providers ?? {};
  const topProviders = cfg.providers ?? {};
  // Strip credential-only entries (those without baseUrl or models) from topProviders
  // since models-config only needs endpoint/model info, not credentials
  const topEndpointProviders = {};
  for (const [key, entry] of Object.entries(topProviders)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (entry.baseUrl || Array.isArray(entry.models)) {
      // Convert ProviderEntry → ModelProvider shape (strip credentials/failover/cooldowns/disabled)
      const {
        credentials: _c,
        failover: _f,
        cooldowns: _cd,
        disabled: _d,
        ...modelProviderFields
      } = entry;
      topEndpointProviders[key] = modelProviderFields;
    }
  }
  const explicitProviders = { ...legacyModelProviders, ...topEndpointProviders };
  const implicitProviders = await resolveImplicitProviders({ agentDir, explicitProviders });
  const providers = mergeProviders({
    implicit: implicitProviders,
    explicit: explicitProviders,
  });
  const implicitBedrock = await resolveImplicitBedrockProvider({ agentDir, config: cfg });
  if (implicitBedrock) {
    const existing = providers["amazon-bedrock"];
    providers["amazon-bedrock"] = existing
      ? mergeProviderModels(implicitBedrock, existing)
      : implicitBedrock;
  }
  const implicitCopilot = await resolveImplicitCopilotProvider({ agentDir });
  if (implicitCopilot && !providers["github-copilot"]) {
    providers["github-copilot"] = implicitCopilot;
  }
  if (Object.keys(providers).length === 0) {
    return { agentDir, wrote: false };
  }
  const mode = cfg.models?.mode ?? DEFAULT_MODE;
  const targetPath = path.join(agentDir, "models.json");
  let mergedProviders = providers;
  let existingRaw = "";
  if (mode === "merge") {
    const existing = await readJson(targetPath);
    if (isRecord(existing) && isRecord(existing.providers)) {
      const existingProviders = existing.providers;
      mergedProviders = { ...existingProviders, ...providers };
    }
  }
  // Force curated static catalogs — override any stale discovered/cached models
  for (const key of ["openai", "anthropic", "google"]) {
    if (mergedProviders[key] && catalog[key]) {
      mergedProviders[key] = {
        ...mergedProviders[key],
        models: Object.values(catalog[key].models),
      };
    }
  }
  const normalizedProviders = normalizeProviders({
    providers: mergedProviders,
    agentDir,
    cfg,
  });
  const next = `${JSON.stringify({ providers: normalizedProviders }, null, 2)}\n`;
  try {
    existingRaw = await secureReadFile(targetPath);
  } catch {
    existingRaw = "";
  }
  if (existingRaw === next) {
    return { agentDir, wrote: false };
  }
  await fs.mkdir(agentDir, { recursive: true, mode: 448 });
  await secureWriteFile(targetPath, next);
  return { agentDir, wrote: true };
}
