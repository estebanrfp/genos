import { listAgentIds } from "../../agents/agent-scope.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import {
  buildModelAliasIndex,
  modelKey,
  parseModelRef,
  resolveModelRefFromString,
} from "../../agents/model-selection.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { readConfigFileSnapshot, writeConfigFile } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
export const ensureFlagCompatibility = (opts) => {
  if (opts.json && opts.plain) {
    throw new Error("Choose either --json or --plain, not both.");
  }
};
export const formatTokenK = (value) => {
  if (!value || !Number.isFinite(value)) {
    return "-";
  }
  if (value < 1024) {
    return `${Math.round(value)}`;
  }
  return `${Math.round(value / 1024)}k`;
};
export const formatMs = (value) => {
  if (value === null || value === undefined) {
    return "-";
  }
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${Math.round(value / 100) / 10}s`;
};
export const isLocalBaseUrl = (baseUrl) => {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
};
export async function loadValidConfigOrThrow() {
  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    const issues = snapshot.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Invalid config at ${snapshot.path}\n${issues}`);
  }
  return snapshot.config;
}
export async function updateConfig(mutator) {
  const config = await loadValidConfigOrThrow();
  const next = mutator(config);
  await writeConfigFile(next);
  return next;
}
export function resolveModelTarget(params) {
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
  });
  const resolved = resolveModelRefFromString({
    raw: params.raw,
    defaultProvider: DEFAULT_PROVIDER,
    aliasIndex,
  });
  if (!resolved) {
    throw new Error(`Invalid model reference: ${params.raw}`);
  }
  return resolved.ref;
}
export function resolveModelKeysFromEntries(params) {
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
  });
  return params.entries
    .map((entry) =>
      resolveModelRefFromString({
        raw: entry,
        defaultProvider: DEFAULT_PROVIDER,
        aliasIndex,
      }),
    )
    .filter((entry) => Boolean(entry))
    .map((entry) => modelKey(entry.ref.provider, entry.ref.model));
}
export function buildAllowlistSet(cfg) {
  const allowed = new Set();
  const models = cfg.agents?.defaults?.models ?? {};
  for (const raw of Object.keys(models)) {
    const parsed = parseModelRef(String(raw ?? ""), DEFAULT_PROVIDER);
    if (!parsed) {
      continue;
    }
    allowed.add(modelKey(parsed.provider, parsed.model));
  }
  return allowed;
}
export function normalizeAlias(alias) {
  const trimmed = alias.trim();
  if (!trimmed) {
    throw new Error("Alias cannot be empty.");
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    throw new Error("Alias must use letters, numbers, dots, underscores, colons, or dashes.");
  }
  return trimmed;
}
export function resolveKnownAgentId(params) {
  const raw = params.rawAgentId?.trim();
  if (!raw) {
    return;
  }
  const agentId = normalizeAgentId(raw);
  const knownAgents = listAgentIds(params.cfg);
  if (!knownAgents.includes(agentId)) {
    throw new Error(
      `Unknown agent id "${raw}". Use "${formatCliCommand("genosos agents list")}" to see configured agents.`,
    );
  }
  return agentId;
}
export function mergePrimaryFallbackConfig(existing, patch) {
  const next = { ...existing };
  if (patch.primary !== undefined) {
    next.primary = patch.primary;
  }
  if (patch.fallbacks !== undefined) {
    next.fallbacks = patch.fallbacks;
  }
  return next;
}
export function applyDefaultModelPrimaryUpdate(params) {
  const resolved = resolveModelTarget({ raw: params.modelRaw, cfg: params.cfg });
  const key = `${resolved.provider}/${resolved.model}`;
  const nextModels = { ...params.cfg.agents?.defaults?.models };
  if (!nextModels[key]) {
    nextModels[key] = {};
  }
  const defaults = params.cfg.agents?.defaults ?? {};
  const existing = defaults[params.field];
  return {
    ...params.cfg,
    agents: {
      ...params.cfg.agents,
      defaults: {
        ...defaults,
        [params.field]: mergePrimaryFallbackConfig(existing, { primary: key }),
        models: nextModels,
      },
    },
  };
}

export { modelKey };
export { DEFAULT_MODEL, DEFAULT_PROVIDER };
