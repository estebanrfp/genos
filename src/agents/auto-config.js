// --- Tool Profile Inference ---

const PROFILE_KEYWORDS = {
  coding: [
    "code",
    "dev",
    "developer",
    "engineer",
    "build",
    "deploy",
    "devops",
    "debug",
    "infra",
    "script",
    "review",
    "test",
    "lint",
    "refactor",
  ],
  messaging: [
    "message",
    "chat",
    "support",
    "helpdesk",
    "notify",
    "broadcast",
    "social",
    "community",
    "bot",
  ],
  minimal: [
    "monitor",
    "watcher",
    "sensor",
    "probe",
    "health",
    "ping",
    "status",
    "heartbeat",
    "checker",
  ],
};

/**
 * Infer a tool profile from agent name keywords.
 * @param {string} name - Agent display name
 * @returns {"coding"|"messaging"|"minimal"|"full"}
 */
export const inferToolProfile = (name) => {
  const lower = name.toLowerCase();
  for (const [profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return profile;
    }
  }
  return "full";
};

/**
 * Apply a tool profile to a specific agent in config.
 * @param {object} cfg - Full config object (will be cloned)
 * @param {string} agentId - Target agent ID
 * @param {"coding"|"messaging"|"minimal"|"full"} profile
 * @returns {{ config: object, applied: string[] }}
 */
export const applyToolProfile = (cfg, agentId, profile) => {
  const config = structuredClone(cfg);
  const agents = config.agents?.list ?? [];
  const entry = agents.find((a) => a.id === agentId);
  if (!entry) {
    return { config, applied: [] };
  }

  entry.tools ??= {};
  entry.tools.profile = profile;
  return { config, applied: [`tools.profile=${profile}`] };
};

// --- Security Auto-Harden ---

const FORTRESS_DEFAULTS = [
  ["fortress.enabled", true],
  ["fortress.auditLog", true],
  ["fortress.rateLimiting", true],
  ["vault.autoLockMinutes", 30],
];

/**
 * Harden security config — fill undefined fortress/vault fields when vault is enabled.
 * Never overwrites explicit user values.
 * @param {object} cfg - Full config object (will be cloned)
 * @returns {{ config: object, applied: string[] }}
 */
export const hardenSecurityConfig = (cfg) => {
  const config = structuredClone(cfg);
  const sec = (config.security ??= {});
  const applied = [];

  if (!sec.vault?.enabled) {
    return { config, applied };
  }

  sec.fortress ??= {};
  sec.vault ??= {};

  for (const [dotPath, defaultVal] of FORTRESS_DEFAULTS) {
    const [group, key] = dotPath.split(".");
    if (sec[group]?.[key] === undefined) {
      sec[group] ??= {};
      sec[group][key] = defaultVal;
      applied.push(`security.${dotPath}=${defaultVal}`);
    }
  }
  return { config, applied };
};

// --- Channel Credential Detection ---

const CHANNEL_REQUIRED_FIELDS = {
  telegram: ["token"],
  discord: ["token"],
  slack: ["token"],
  signal: ["signalCliPath"],
  nostr: ["privateKey"],
  whatsapp: [],
  imessage: [],
};

/**
 * Detect missing required credentials for a channel.
 * @param {string} channelName - Channel identifier
 * @param {object} [channelConfig={}] - Current channel config
 * @returns {{ missing: string[], hint: string }}
 */
export const detectMissingCredentials = (channelName, channelConfig = {}) => {
  const required = CHANNEL_REQUIRED_FIELDS[channelName.toLowerCase()];
  if (!required) {
    return { missing: [], hint: "" };
  }
  const missing = required.filter((f) => !channelConfig[f]);
  const hint = missing.length
    ? `Set: ${missing.map((f) => `channels.${channelName}.${f}`).join(", ")}`
    : "";
  return { missing, hint };
};

// --- Session Auto-Defaults ---

const SESSION_MODE_DEFAULTS = {
  daily: { "reset.atHour": 4 },
  idle: { "reset.idleMinutes": 30 },
};

const MAINTENANCE_MODE_DEFAULTS = {
  enforce: { "maintenance.pruneAfter": "7d" },
};

/**
 * Apply sensible defaults when session reset/maintenance mode is set.
 * Only fills undefined sibling fields.
 * @param {object} cfg - Full config object (will be cloned)
 * @param {string} path - Dot path that was just set (e.g. "session.reset.mode")
 * @param {*} value - Value that was set
 * @returns {{ config: object, applied: string[] }}
 */
export const applySessionDefaults = (cfg, path, value) => {
  const config = structuredClone(cfg);
  const session = (config.session ??= {});
  const applied = [];

  if (path === "session.reset.mode") {
    const defaults = SESSION_MODE_DEFAULTS[value];
    if (defaults) {
      for (const [dotPath, defaultVal] of Object.entries(defaults)) {
        const [group, key] = dotPath.split(".");
        session[group] ??= {};
        if (session[group][key] === undefined) {
          session[group][key] = defaultVal;
          applied.push(`session.${dotPath}=${defaultVal}`);
        }
      }
    }
  }

  if (path === "session.maintenance.mode") {
    const defaults = MAINTENANCE_MODE_DEFAULTS[value];
    if (defaults) {
      for (const [dotPath, defaultVal] of Object.entries(defaults)) {
        const [group, key] = dotPath.split(".");
        session[group] ??= {};
        if (session[group][key] === undefined) {
          session[group][key] = defaultVal;
          applied.push(`session.${dotPath}=${defaultVal}`);
        }
      }
    }
  }

  return { config, applied };
};

// --- Model Routing Auto-Defaults ---

/**
 * @deprecated Tier routing removed — boost tool handles model escalation.
 * Kept as no-op for backward compatibility with config-manage-tool.
 */
export const applyRoutingDefaults = async (cfg) => ({
  config: structuredClone(cfg),
  applied: [],
});

/** @deprecated No-op — catalog cache removed with tier routing. */
export const clearCatalogCache = () => {};

// --- Agent Template Parsing ---

/**
 * Parse an agent template markdown file into a structured config object.
 * Extracts: Name, ToolProfile, Description, AlsoAllow, Deny, A2A, Cron, etc.
 * @param {string} content - Raw markdown content of the template
 * @returns {object} Parsed template fields
 */
export const parseAgentTemplate = (content) => {
  const lines = content.split("\n");
  const result = {};
  let inDescription = false;
  const descLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Single-line fields
    if (trimmed.startsWith("Name:")) {
      result.name = trimmed.slice(5).trim();
      inDescription = false;
      continue;
    }
    if (trimmed.startsWith("ToolProfile:")) {
      result.toolProfile = trimmed.slice(12).trim();
      inDescription = false;
      continue;
    }
    if (trimmed.startsWith("AlsoAllow:")) {
      result.alsoAllow = trimmed.slice(10).trim().split(/,\s*/).filter(Boolean);
      inDescription = false;
      continue;
    }
    if (trimmed.startsWith("Deny:")) {
      result.deny = trimmed.slice(5).trim().split(/,\s*/).filter(Boolean);
      inDescription = false;
      continue;
    }
    if (trimmed.startsWith("BusinessHours:")) {
      result.businessHours = trimmed.slice(14).trim();
      inDescription = false;
      continue;
    }

    // Multi-line Description block
    if (trimmed === "Description:") {
      inDescription = true;
      continue;
    }

    // End of description on next section header
    if (inDescription) {
      if (
        /^(Channels|Services|BusinessHours|Hardening|Approvals|A2A|Cron|Skills|ConnectedAPIs|SetupQuestions|ProductionPipeline):/.test(
          trimmed,
        )
      ) {
        inDescription = false;
        result.description = descLines.join("\n").trim();
      } else {
        descLines.push(line);
        continue;
      }
    }

    // Skills section — extract skill names from bullet lines
    if (trimmed.startsWith("Skills:")) {
      result._inSkills = true;
      result.skills = [];
      continue;
    }
    if (result._inSkills) {
      if (trimmed.startsWith("·") || trimmed.startsWith("-")) {
        const match = trimmed.replace(/^[·-]\s*/, "").match(/^(\S+)/);
        if (match) {
          result.skills.push(match[1]);
        }
        continue;
      }
      if (!trimmed) {
        continue;
      }
      delete result._inSkills;
      // Fall through so the line (e.g. "A2A:") gets processed below
    }

    // A2A section — extract agent names from bullet lines
    if (trimmed.startsWith("A2A:")) {
      // A2A is on next lines as bullets, handled below
      result._inA2A = true;
      result.a2aAgents = [];
      continue;
    }
    if (result._inA2A) {
      if (trimmed.startsWith("·") || trimmed.startsWith("-")) {
        // Extract agent ID mentions — simple heuristic
        result.a2aAgents.push(trimmed.replace(/^[·-]\s*/, ""));
      } else if (trimmed && !trimmed.startsWith("·") && !trimmed.startsWith("-")) {
        delete result._inA2A;
      }
      continue;
    }
  }

  // Flush description if file ends during description block
  if (inDescription && descLines.length) {
    result.description = descLines.join("\n").trim();
  }

  delete result._inA2A;
  delete result._inSkills;
  return result;
};

/**
 * Apply template config fields (alsoAllow, deny, A2A) to an agent entry in config.
 * @param {object} cfg - Full config object (will be cloned)
 * @param {string} agentId - Target agent ID
 * @param {object} template - Parsed template object
 * @returns {{ config: object, applied: string[] }}
 */
export const applyTemplateConfig = (cfg, agentId, template) => {
  const config = structuredClone(cfg);
  const agents = config.agents?.list ?? [];
  const entry = agents.find((a) => a.id === agentId);
  if (!entry) {
    return { config, applied: [] };
  }

  const applied = [];
  entry.tools ??= {};

  if (template.alsoAllow?.length) {
    entry.tools.alsoAllow = template.alsoAllow;
    applied.push(`tools.alsoAllow=${JSON.stringify(template.alsoAllow)}`);
  }

  if (template.deny?.length) {
    entry.tools.deny = template.deny;
    applied.push(`tools.deny=${JSON.stringify(template.deny)}`);
  }

  // Add agent to A2A allow list if one is explicitly configured
  const a2a = config.tools?.agentToAgent;
  if (a2a?.allow && Array.isArray(a2a.allow) && a2a.allow.length > 0) {
    if (!a2a.allow.includes(agentId) && !a2a.allow.includes("*")) {
      a2a.allow.push(agentId);
      applied.push(`agentToAgent.allow+=${agentId}`);
    }
  }

  return { config, applied };
};
