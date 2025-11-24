let resolveAgentName = function (cfg, agentId) {
    const entry = listAgentEntries(cfg).find(
      (agent) => normalizeAgentId(agent.id) === normalizeAgentId(agentId),
    );
    return entry?.name?.trim() || undefined;
  },
  resolveAgentModel = function (cfg, agentId) {
    const entry = listAgentEntries(cfg).find(
      (agent) => normalizeAgentId(agent.id) === normalizeAgentId(agentId),
    );
    if (entry?.model) {
      if (typeof entry.model === "string" && entry.model.trim()) {
        return entry.model.trim();
      }
      if (typeof entry.model === "object") {
        const primary = entry.model.primary?.trim();
        if (primary) {
          return primary;
        }
      }
    }
    const raw = cfg.agents?.defaults?.model;
    if (typeof raw === "string") {
      return raw;
    }
    return raw?.primary?.trim() || undefined;
  };
import {
  listAgentEntries,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import {
  identityHasValues,
  loadAgentIdentityFromWorkspace,
  parseIdentityMarkdown as parseIdentityMarkdownFile,
} from "../agents/identity-file.js";
import { normalizeAgentId } from "../routing/session-key.js";

export { listAgentEntries };
export function findAgentEntryIndex(list, agentId) {
  const id = normalizeAgentId(agentId);
  return list.findIndex((entry) => normalizeAgentId(entry.id) === id);
}
export function parseIdentityMarkdown(content) {
  return parseIdentityMarkdownFile(content);
}
export function loadAgentIdentity(workspace) {
  const parsed = loadAgentIdentityFromWorkspace(workspace);
  if (!parsed) {
    return null;
  }
  return identityHasValues(parsed) ? parsed : null;
}
export function buildAgentSummaries(cfg) {
  const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
  const configuredAgents = listAgentEntries(cfg);
  const orderedIds =
    configuredAgents.length > 0
      ? configuredAgents.map((agent) => normalizeAgentId(agent.id))
      : [defaultAgentId];
  const bindingCounts = new Map();
  for (const binding of cfg.bindings ?? []) {
    const agentId = normalizeAgentId(binding.agentId);
    bindingCounts.set(agentId, (bindingCounts.get(agentId) ?? 0) + 1);
  }
  const ordered = orderedIds.filter((id, index) => orderedIds.indexOf(id) === index);
  return ordered.map((id) => {
    const workspace = resolveAgentWorkspaceDir(cfg, id);
    const identity = loadAgentIdentity(workspace);
    const configIdentity = configuredAgents.find(
      (agent) => normalizeAgentId(agent.id) === id,
    )?.identity;
    const identityName = identity?.name ?? configIdentity?.name?.trim();
    const identityEmoji = identity?.emoji ?? configIdentity?.emoji?.trim();
    const identitySource = identity
      ? "identity"
      : configIdentity && (identityName || identityEmoji)
        ? "config"
        : undefined;
    return {
      id,
      name: resolveAgentName(cfg, id),
      identityName,
      identityEmoji,
      identitySource,
      workspace,
      agentDir: resolveAgentDir(cfg, id),
      model: resolveAgentModel(cfg, id),
      bindings: bindingCounts.get(id) ?? 0,
      isDefault: id === defaultAgentId,
    };
  });
}
export function applyAgentConfig(cfg, params) {
  const agentId = normalizeAgentId(params.agentId);
  const name = params.name?.trim();
  const list = listAgentEntries(cfg);
  const index = findAgentEntryIndex(list, agentId);
  const base = index >= 0 ? list[index] : { id: agentId };
  const nextEntry = {
    ...base,
    ...(name ? { name } : {}),
    ...(params.workspace ? { workspace: params.workspace } : {}),
    ...(params.agentDir ? { agentDir: params.agentDir } : {}),
    ...(params.model ? { model: params.model } : {}),
  };
  const nextList = [...list];
  if (index >= 0) {
    nextList[index] = nextEntry;
  } else {
    if (nextList.length === 0 && agentId !== normalizeAgentId(resolveDefaultAgentId(cfg))) {
      nextList.push({ id: resolveDefaultAgentId(cfg) });
    }
    nextList.push(nextEntry);
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: nextList,
    },
  };
}
/**
 * Auto-wire agent-to-agent communication for a newly created agent.
 * Enables tools.agentToAgent and adds the agent to the allow list.
 * @param {object} cfg
 * @param {string} agentId
 * @returns {object} Updated config
 */
export function wireAgentCommunication(cfg, agentId) {
  const id = normalizeAgentId(agentId);

  // 1. Wire tools.agentToAgent (for sessions_send)
  const current = cfg.tools?.agentToAgent ?? {};
  const allow = current.allow ?? [];
  const nextAllow = allow.includes(id) ? allow : [...allow, id];

  // 2. Wire subagents.allowAgents ONLY on the NEW agent (allow it to spawn under main).
  //    Do NOT add cross-agent spawn permissions to existing agents — they should
  //    delegate via sessions_send and let the target agent spawn its own subagents.
  const agents = cfg.agents ?? {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  const defaultId = resolveDefaultAgentId(cfg);
  const updatedList = list.map((entry) => {
    if (normalizeAgentId(entry.id) !== id) {
      return entry;
    }
    // Give the new agent permission to spawn under the default (main) agent
    const entryAllow = entry.subagents?.allowAgents ?? [];
    if (entryAllow.includes(defaultId)) {
      return entry;
    }
    return {
      ...entry,
      subagents: { ...entry.subagents, allowAgents: [...entryAllow, defaultId] },
    };
  });

  return {
    ...cfg,
    tools: {
      ...cfg.tools,
      agentToAgent: { ...current, enabled: true, allow: nextAllow },
    },
    agents: {
      ...agents,
      list: updatedList.length ? updatedList : agents.list,
    },
  };
}

/**
 * Rename an agent's technical ID across the entire config (pure, no side effects).
 * Updates agents.list[].id, bindings[].agentId, tools.agentToAgent.allow[],
 * and agents[*].subagents.allowAgents[].
 * @param {object} cfg
 * @param {string} oldId - Normalized old agent ID
 * @param {string} newId - Normalized new agent ID
 * @param {{ workspace?: string, agentDir?: string }} [opts]
 * @returns {object} Updated config
 */
export function renameAgentConfig(cfg, oldId, newId, opts) {
  const agents = listAgentEntries(cfg);

  // 1. Update agents.list — rename the target entry, rewrite allowAgents in ALL entries
  const renamedList = agents.map((entry) => {
    const isTarget = normalizeAgentId(entry.id) === oldId;
    const base = isTarget
      ? {
          ...entry,
          id: newId,
          ...(opts?.workspace ? { workspace: opts.workspace } : {}),
          ...(opts?.agentDir ? { agentDir: opts.agentDir } : {}),
        }
      : entry;

    // Rewrite subagents.allowAgents references
    const entryAllow = base.subagents?.allowAgents;
    if (!Array.isArray(entryAllow) || !entryAllow.includes(oldId)) {
      return base;
    }
    const nextAllow = entryAllow.map((a) => (a === oldId ? newId : a));
    return { ...base, subagents: { ...base.subagents, allowAgents: nextAllow } };
  });

  // 2. Update bindings[].agentId
  const bindings = cfg.bindings ?? [];
  const renamedBindings = bindings.map((binding) =>
    normalizeAgentId(binding.agentId) === oldId ? { ...binding, agentId: newId } : binding,
  );

  // 3. Update tools.agentToAgent.allow[]
  const allow = cfg.tools?.agentToAgent?.allow ?? [];
  const renamedAllow = allow.map((a) => (a === oldId ? newId : a));
  const nextAgentToAgent = cfg.tools?.agentToAgent
    ? { ...cfg.tools.agentToAgent, allow: renamedAllow }
    : cfg.tools?.agentToAgent;
  const nextTools = nextAgentToAgent ? { ...cfg.tools, agentToAgent: nextAgentToAgent } : cfg.tools;

  return {
    ...cfg,
    agents: { ...cfg.agents, list: renamedList },
    bindings: renamedBindings.length > 0 ? renamedBindings : cfg.bindings,
    tools: nextTools,
  };
}

export function pruneAgentConfig(cfg, agentId) {
  const id = normalizeAgentId(agentId);
  const agents = listAgentEntries(cfg);
  const nextAgentsList = agents.filter((entry) => normalizeAgentId(entry.id) !== id);
  const nextAgents = nextAgentsList.length > 0 ? nextAgentsList : undefined;
  const bindings = cfg.bindings ?? [];
  const filteredBindings = bindings.filter((binding) => normalizeAgentId(binding.agentId) !== id);
  const allow = cfg.tools?.agentToAgent?.allow ?? [];
  const filteredAllow = allow.filter((entry) => entry !== id);

  // Clean subagents.allowAgents references from remaining agents
  let removedSubagentRefs = 0;
  const cleanedAgents = nextAgents?.map((entry) => {
    const entryAllow = entry.subagents?.allowAgents;
    if (!Array.isArray(entryAllow) || !entryAllow.includes(id)) {
      return entry;
    }
    const filtered = entryAllow.filter((a) => a !== id);
    removedSubagentRefs++;
    const nextSubagents =
      filtered.length > 0
        ? { ...entry.subagents, allowAgents: filtered }
        : (() => {
            const { allowAgents: _, ...rest } = entry.subagents;
            return Object.keys(rest).length > 0 ? rest : undefined;
          })();
    return nextSubagents
      ? { ...entry, subagents: nextSubagents }
      : (() => {
          const { subagents: _, ...rest } = entry;
          return rest;
        })();
  });

  const nextAgentsConfig = cfg.agents
    ? { ...cfg.agents, list: cleanedAgents }
    : cleanedAgents
      ? { list: cleanedAgents }
      : undefined;

  // Auto-disable agentToAgent when allow list becomes empty
  const nextAgentToAgent =
    filteredAllow.length > 0
      ? { ...cfg.tools?.agentToAgent, allow: filteredAllow }
      : { ...cfg.tools?.agentToAgent, enabled: false, allow: undefined };
  const nextTools = cfg.tools?.agentToAgent
    ? { ...cfg.tools, agentToAgent: nextAgentToAgent }
    : cfg.tools;

  return {
    config: {
      ...cfg,
      agents: nextAgentsConfig,
      bindings: filteredBindings.length > 0 ? filteredBindings : undefined,
      tools: nextTools,
    },
    removedBindings: bindings.length - filteredBindings.length,
    removedAllow: allow.length - filteredAllow.length,
    removedSubagentRefs,
  };
}
