let resolveAgentEntry = function (cfg, agentId) {
  const id = normalizeAgentId(agentId);
  return listAgentEntries(cfg).find((entry) => normalizeAgentId(entry.id) === id);
};
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { normalizeSkillFilter } from "./skills/filter.js";
export { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
let defaultAgentWarned = false;
export function listAgentEntries(cfg) {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry) => Boolean(entry && typeof entry === "object"));
}
export function listAgentIds(cfg) {
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) {
    return [DEFAULT_AGENT_ID];
  }
  const seen = new Set();
  const ids = [];
  for (const entry of agents) {
    const id = normalizeAgentId(entry?.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [DEFAULT_AGENT_ID];
}
export function resolveDefaultAgentId(cfg) {
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) {
    return DEFAULT_AGENT_ID;
  }
  const defaults = agents.filter((agent) => agent?.default);
  if (defaults.length > 1 && !defaultAgentWarned) {
    defaultAgentWarned = true;
    console.warn("Multiple agents marked default=true; using the first entry as default.");
  }
  const chosen = (defaults[0] ?? agents[0])?.id?.trim();
  return normalizeAgentId(chosen || DEFAULT_AGENT_ID);
}
export function resolveSessionAgentIds(params) {
  const defaultAgentId = resolveDefaultAgentId(params.config ?? {});
  const sessionKey = params.sessionKey?.trim();
  const normalizedSessionKey = sessionKey ? sessionKey.toLowerCase() : undefined;
  const parsed = normalizedSessionKey ? parseAgentSessionKey(normalizedSessionKey) : null;
  const sessionAgentId = parsed?.agentId ? normalizeAgentId(parsed.agentId) : defaultAgentId;
  return { defaultAgentId, sessionAgentId };
}
export function resolveSessionAgentId(params) {
  return resolveSessionAgentIds(params).sessionAgentId;
}
export function resolveAgentConfig(cfg, agentId) {
  const id = normalizeAgentId(agentId);
  const entry = resolveAgentEntry(cfg, id);
  if (!entry) {
    return;
  }
  return {
    name: typeof entry.name === "string" ? entry.name : undefined,
    workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
    agentDir: typeof entry.agentDir === "string" ? entry.agentDir : undefined,
    model:
      typeof entry.model === "string" || (entry.model && typeof entry.model === "object")
        ? entry.model
        : undefined,
    skills: Array.isArray(entry.skills) ? entry.skills : undefined,
    memorySearch: entry.memorySearch,
    humanDelay: entry.humanDelay,
    heartbeat: entry.heartbeat,
    identity: entry.identity,
    groupChat: entry.groupChat,
    subagents: typeof entry.subagents === "object" && entry.subagents ? entry.subagents : undefined,
    sandbox: entry.sandbox,
    tools: entry.tools,
  };
}
export function resolveAgentSkillsFilter(cfg, agentId) {
  return normalizeSkillFilter(resolveAgentConfig(cfg, agentId)?.skills);
}
export function resolveAgentModelPrimary(cfg, agentId) {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw) {
    return;
  }
  if (typeof raw === "string") {
    return raw.trim() || undefined;
  }
  const primary = raw.primary?.trim();
  return primary || undefined;
}
export function resolveAgentModelFallbacksOverride(cfg, agentId) {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw || typeof raw === "string") {
    return;
  }
  if (!Object.hasOwn(raw, "fallbacks")) {
    return;
  }
  return Array.isArray(raw.fallbacks) ? raw.fallbacks : undefined;
}
export function resolveEffectiveModelFallbacks(params) {
  const agentFallbacksOverride = resolveAgentModelFallbacksOverride(params.cfg, params.agentId);
  if (!params.hasSessionModelOverride) {
    return agentFallbacksOverride;
  }
  const defaultFallbacks =
    typeof params.cfg.agents?.defaults?.model === "object"
      ? (params.cfg.agents.defaults.model.fallbacks ?? [])
      : [];
  return agentFallbacksOverride ?? defaultFallbacks;
}
/** Convert a display name to kebab-case for filesystem usage (like GenosOS Pro) */
export function toKebabCase(name) {
  return (
    (name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "agent"
  );
}

export function resolveAgentWorkspaceDir(cfg, agentId) {
  const id = normalizeAgentId(agentId);
  const entry = resolveAgentEntry(cfg, id);
  // Explicit workspace override — respect it
  const configured = entry?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  // Derive from agent name: workspace/{kebab-case-name}/ (like GenosOS Pro)
  const stateDir = resolveStateDir(process.env);
  const name = entry?.name ?? id;
  return path.join(stateDir, "workspace", toKebabCase(name));
}
export function resolveAgentDir(cfg, agentId) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.agentDir?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const root = resolveStateDir(process.env);
  return path.join(root, "agents", id, "agent");
}
