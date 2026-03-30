let makeToolPolicyMatcher = function (policy) {
    const deny = compileGlobPatterns({
      raw: expandToolGroups(policy.deny ?? []),
      normalize: normalizeToolName,
    });
    const allow = compileGlobPatterns({
      raw: expandToolGroups(policy.allow ?? []),
      normalize: normalizeToolName,
    });
    return (name) => {
      const normalized = normalizeToolName(name);
      if (matchesAnyGlobPattern(normalized, deny)) {
        return false;
      }
      if (allow.length === 0) {
        return true;
      }
      if (matchesAnyGlobPattern(normalized, allow)) {
        return true;
      }
      if (normalized === "apply_patch" && matchesAnyGlobPattern("exec", allow)) {
        return true;
      }
      return false;
    };
  },
  resolveSubagentDenyList = function (depth, maxSpawnDepth) {
    const isLeaf = depth >= Math.max(1, Math.floor(maxSpawnDepth));
    if (isLeaf) {
      return [...SUBAGENT_TOOL_DENY_ALWAYS, ...SUBAGENT_TOOL_DENY_LEAF];
    }
    return [...SUBAGENT_TOOL_DENY_ALWAYS];
  },
  normalizeProviderKey = function (value) {
    return value.trim().toLowerCase();
  },
  resolveGroupContextFromSessionKey = function (sessionKey) {
    const raw = (sessionKey ?? "").trim();
    if (!raw) {
      return {};
    }
    const base = resolveThreadParentSessionKey(raw) ?? raw;
    const parsed = parseAgentSessionKey(base);
    let body = (parsed?.rest ?? base).split(":").filter(Boolean);
    if (body[0] === "subagent") {
      body = body.slice(1);
    }
    if (body.length < 3) {
      return {};
    }
    const [channel, kind, ...rest] = body;
    if (kind !== "group" && kind !== "channel") {
      return {};
    }
    const groupId = rest.join(":").trim();
    if (!groupId) {
      return {};
    }
    return { channel: channel.trim().toLowerCase(), groupId };
  },
  resolveProviderToolPolicy = function (params) {
    const provider = params.modelProvider?.trim();
    if (!provider || !params.byProvider) {
      return;
    }
    const entries = Object.entries(params.byProvider);
    if (entries.length === 0) {
      return;
    }
    const lookup = new Map();
    for (const [key, value] of entries) {
      const normalized = normalizeProviderKey(key);
      if (!normalized) {
        continue;
      }
      lookup.set(normalized, value);
    }
    const normalizedProvider = normalizeProviderKey(provider);
    const rawModelId = params.modelId?.trim().toLowerCase();
    const fullModelId =
      rawModelId && !rawModelId.includes("/") ? `${normalizedProvider}/${rawModelId}` : rawModelId;
    const candidates = [...(fullModelId ? [fullModelId] : []), normalizedProvider];
    for (const key of candidates) {
      const match = lookup.get(key);
      if (match) {
        return match;
      }
    }
    return;
  };
import { getChannelDock } from "../channels/dock.js";
import { resolveChannelGroupToolsPolicy } from "../config/group-policy.js";
import {
  parseAgentSessionKey,
  resolveThreadParentSessionKey,
} from "../sessions/session-key-utils.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import { resolveAgentConfig, resolveAgentIdFromSessionKey } from "./agent-scope.js";
import { compileGlobPatterns, matchesAnyGlobPattern } from "./glob-pattern.js";
import { expandToolGroups, normalizeToolName } from "./tool-policy.js";
/** @param {object|undefined} toolsConfig */
const pickToolPolicy = (toolsConfig) => {
  if (!toolsConfig || typeof toolsConfig !== "object") {
    return undefined;
  }
  const allow = Array.isArray(toolsConfig.allow) ? toolsConfig.allow : undefined;
  const deny = Array.isArray(toolsConfig.deny) ? toolsConfig.deny : undefined;
  return allow || deny ? { allow, deny } : undefined;
};
const SUBAGENT_TOOL_DENY_ALWAYS = [
  "gateway",
  "agents_list",
  "whatsapp_login",
  "session_status",
  "cron",
  "memory_search",
  "memory_get",
  "sessions_send",
];
const SUBAGENT_TOOL_DENY_LEAF = ["sessions_list", "sessions_history", "sessions_spawn"];
export function resolveSubagentToolPolicy(cfg, depth) {
  const configured = cfg?.tools?.subagents?.tools;
  const maxSpawnDepth = cfg?.agents?.defaults?.subagents?.maxSpawnDepth ?? 1;
  const effectiveDepth = typeof depth === "number" && depth >= 0 ? depth : 1;
  const baseDeny = resolveSubagentDenyList(effectiveDepth, maxSpawnDepth);
  const deny = [...baseDeny, ...(Array.isArray(configured?.deny) ? configured.deny : [])];
  const allow = Array.isArray(configured?.allow) ? configured.allow : undefined;
  return { allow, deny };
}
export function isToolAllowedByPolicyName(name, policy) {
  if (!policy) {
    return true;
  }
  return makeToolPolicyMatcher(policy)(name);
}
export function filterToolsByPolicy(tools, policy) {
  if (!policy) {
    return tools;
  }
  const matcher = makeToolPolicyMatcher(policy);
  return tools.filter((tool) => matcher(tool.name));
}
export function resolveEffectiveToolPolicy(params) {
  const agentId = params.sessionKey ? resolveAgentIdFromSessionKey(params.sessionKey) : undefined;
  const agentConfig =
    params.config && agentId ? resolveAgentConfig(params.config, agentId) : undefined;
  const agentTools = agentConfig?.tools;
  const globalTools = params.config?.tools;
  const profile = agentTools?.profile ?? globalTools?.profile;
  const providerPolicy = resolveProviderToolPolicy({
    byProvider: globalTools?.byProvider,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });
  const agentProviderPolicy = resolveProviderToolPolicy({
    byProvider: agentTools?.byProvider,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });
  return {
    agentId,
    globalPolicy: pickToolPolicy(globalTools),
    globalProviderPolicy: pickToolPolicy(providerPolicy),
    agentPolicy: pickToolPolicy(agentTools),
    agentProviderPolicy: pickToolPolicy(agentProviderPolicy),
    profile,
    providerProfile: agentProviderPolicy?.profile ?? providerPolicy?.profile,
    profileAlsoAllow: Array.isArray(agentTools?.alsoAllow)
      ? agentTools?.alsoAllow
      : Array.isArray(globalTools?.alsoAllow)
        ? globalTools?.alsoAllow
        : undefined,
    providerProfileAlsoAllow: Array.isArray(agentProviderPolicy?.alsoAllow)
      ? agentProviderPolicy?.alsoAllow
      : Array.isArray(providerPolicy?.alsoAllow)
        ? providerPolicy?.alsoAllow
        : undefined,
  };
}
export function resolveGroupToolPolicy(params) {
  if (!params.config) {
    return;
  }
  const sessionContext = resolveGroupContextFromSessionKey(params.sessionKey);
  const spawnedContext = resolveGroupContextFromSessionKey(params.spawnedBy);
  const groupId = params.groupId ?? sessionContext.groupId ?? spawnedContext.groupId;
  if (!groupId) {
    return;
  }
  const channelRaw = params.messageProvider ?? sessionContext.channel ?? spawnedContext.channel;
  const channel = normalizeMessageChannel(channelRaw);
  if (!channel) {
    return;
  }
  let dock;
  try {
    dock = getChannelDock(channel);
  } catch {
    dock = undefined;
  }
  const toolsConfig =
    dock?.groups?.resolveToolPolicy?.({
      cfg: params.config,
      groupId,
      groupChannel: params.groupChannel,
      groupSpace: params.groupSpace,
      accountId: params.accountId,
      senderId: params.senderId,
      senderName: params.senderName,
      senderUsername: params.senderUsername,
      senderE164: params.senderE164,
    }) ??
    resolveChannelGroupToolsPolicy({
      cfg: params.config,
      channel,
      groupId,
      accountId: params.accountId,
      senderId: params.senderId,
      senderName: params.senderName,
      senderUsername: params.senderUsername,
      senderE164: params.senderE164,
    });
  return pickToolPolicy(toolsConfig);
}
/** Built-in channel deny defaults when no channelRestrictions configured. */
const DEFAULT_CHANNEL_RESTRICTIONS = {
  voice: {
    deny: ["exec", "bash", "process", "write", "edit", "read", "browser", "canvas", "nodes"],
  },
};
const DEFAULT_EXTERNAL_DENY = ["exec", "bash", "process"];
const UNRESTRICTED_CHANNELS = new Set(["webchat", "internal", "heartbeat"]);

/**
 * Resolve tool restrictions for a communication channel.
 * Returns a deny-only policy or undefined (no restriction).
 * @param {{ config: object, agentId: string|undefined, messageProvider: string|undefined }} params
 * @returns {{ deny: string[] } | undefined}
 */
export function resolveChannelRestrictions(params) {
  const channel = normalizeMessageChannel(params.messageProvider);
  if (!channel || UNRESTRICTED_CHANNELS.has(channel)) {
    return undefined;
  }

  // Per-agent override
  const agentConfig =
    params.config && params.agentId ? resolveAgentConfig(params.config, params.agentId) : undefined;
  const agentRestrictions = agentConfig?.tools?.channelRestrictions?.[channel];
  if (agentRestrictions) {
    return pickToolPolicy(agentRestrictions);
  }

  // Global config
  const globalRestrictions = params.config?.tools?.channelRestrictions?.[channel];
  if (globalRestrictions) {
    return pickToolPolicy(globalRestrictions);
  }

  // Built-in defaults
  if (DEFAULT_CHANNEL_RESTRICTIONS[channel]) {
    return DEFAULT_CHANNEL_RESTRICTIONS[channel];
  }

  // All other external channels
  return { deny: DEFAULT_EXTERNAL_DENY };
}

export function isToolAllowedByPolicies(name, policies) {
  return policies.every((policy) => isToolAllowedByPolicyName(name, policy));
}
