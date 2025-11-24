import { CONFIG_SECTIONS } from "../../../auto-reply/reply/config-sections.js";

const SECTION_BLUEPRINT_MAP = {
  channels: () => import("./channels.js"),
  security: () => import("./security.js"),
  gateway: () => import("./gateway.js"),
  agents: () => import("./agents.js"),
  session: () => import("./sessions.js"),
  cron: () => import("./cron.js"),
  messages: () => import("./messages.js"),
  models: () => import("./models.js"),
  logging: () => import("./logging.js"),
  hooks: () => import("./hooks.js"),
  commands: () => import("./commands.js"),
  advanced: () => import("./advanced.js"),
};

/** @type {Map<string, import("./channels.js").Blueprint[]>} */
const cache = new Map();

/**
 * Match a glob-style path pattern against a concrete path.
 * Supports `*` as single-segment wildcard.
 * @param {string} pattern - e.g. "channels.*.allowFrom"
 * @param {string} path - e.g. "channels.imessage.allowFrom"
 * @returns {boolean}
 */
export const matchPath = (pattern, path) => {
  const patParts = pattern.split(".");
  const pathParts = path.split(".");
  if (patParts.length !== pathParts.length) {
    return false;
  }
  return patParts.every((seg, i) => seg === "*" || seg === pathParts[i]);
};

// Root keys that have their own blueprint file but aren't in CONFIG_SECTIONS.paths
const BLUEPRINT_ROOT_MAP = {
  security: "security",
  tools: "agents",
  logging: "logging",
  hooks: "hooks",
  commands: "commands",
  env: "advanced",
  update: "advanced",
  plugins: "advanced",
  diagnostics: "advanced",
  canvasHost: "advanced",
  discovery: "advanced",
  broadcast: "advanced",
  media: "advanced",
};

// Prefix overrides — deeper paths that belong to a different section than their root key
const BLUEPRINT_PREFIX_MAP = [
  ["agents.defaults.model", "models"],
  ["agents.defaults.subagents.model", "models"],
  ["agents.defaults.imageModel", "models"],
  ["agents.defaults.imageMaxDimensionPx", "models"],
  ["agents.defaults.humanDelay", "models"],
];

/**
 * Resolve a dot-path to its blueprint section key.
 * @param {string} path - e.g. "channels.telegram.allowFrom"
 * @returns {string|undefined}
 */
export const resolveSection = (path) => {
  const prefixMatch = BLUEPRINT_PREFIX_MAP.find(([p]) => path === p || path.startsWith(p + "."));
  if (prefixMatch) {
    return prefixMatch[1];
  }
  const root = path.split(".")[0];
  return BLUEPRINT_ROOT_MAP[root] ?? CONFIG_SECTIONS.find((s) => s.paths.includes(root))?.key;
};

/**
 * Lazy-load all blueprints for a section.
 * @param {string} sectionKey
 * @returns {Promise<import("./channels.js").Blueprint[]>}
 */
export const loadBlueprints = async (sectionKey) => {
  if (cache.has(sectionKey)) {
    return cache.get(sectionKey);
  }
  const loader = SECTION_BLUEPRINT_MAP[sectionKey];
  if (!loader) {
    return [];
  }
  const mod = await loader();
  const bps = mod.default ?? [];
  cache.set(sectionKey, bps);
  return bps;
};

/**
 * Find the matching blueprint for a concrete config path.
 * @param {string} path - e.g. "channels.discord.allowFrom"
 * @returns {Promise<import("./channels.js").Blueprint|undefined>}
 */
export const findBlueprint = async (path) => {
  const sectionKey = resolveSection(path);
  if (!sectionKey) {
    return undefined;
  }
  const bps = await loadBlueprints(sectionKey);
  return bps.find((bp) => matchPath(bp.pathPattern, path));
};

/**
 * List all blueprints for a section (for section-level describe).
 * @param {string} sectionKey
 * @returns {Promise<import("./channels.js").Blueprint[]>}
 */
export const listBlueprintsForSection = async (sectionKey) => loadBlueprints(sectionKey);

/**
 * Extract channel ID from a config path.
 * @param {string} path - e.g. "channels.discord.allowFrom"
 * @returns {string|undefined}
 */
export const extractChannelId = (path) => {
  const parts = path.split(".");
  return parts[0] === "channels" && parts.length >= 3 ? parts[1] : undefined;
};

/**
 * Apply type coercion based on blueprint rules.
 * @param {import("./channels.js").Blueprint} bp
 * @param {*} value
 * @param {string} [channelId]
 * @returns {*}
 */
export const applyCoercion = (bp, value, channelId) => {
  if (!bp.itemCoerce) {
    return value;
  }

  const coerce = channelId
    ? (bp.channelRules?.[channelId]?.itemCoerce ?? bp.itemCoerce)
    : bp.itemCoerce;

  if (coerce === "string") {
    return String(value);
  }
  if (coerce === "number") {
    return /^\d+$/.test(String(value)) ? Number(value) : value;
  }
  if (coerce === "smart") {
    return /^\d+$/.test(String(value)) ? Number(value) : String(value);
  }
  return value;
};

/**
 * Validate cross-field dependencies.
 * @param {import("./channels.js").Blueprint} bp
 * @param {object} cfg - Full config object
 * @param {string} path - Concrete path being set
 * @param {*} newValue - The value being set
 * @returns {string[]} Array of error messages (empty = valid)
 */
export const checkCrossField = (bp, cfg, path, newValue) => {
  if (!bp.crossField?.length) {
    return [];
  }
  const errors = [];
  const parts = path.split(".");
  const parentParts = parts.slice(0, -1);

  for (const rule of bp.crossField) {
    const siblingPath = [...parentParts, rule.field];
    const siblingValue = getNestedValue(cfg, siblingPath);
    const effectiveValue = newValue !== undefined ? newValue : getNestedValue(cfg, parts);

    if (rule.eq !== undefined && effectiveValue === rule.eq) {
      errors.push(rule.message);
    }
    if (rule.when !== undefined && siblingValue === rule.when && rule.requires) {
      const currentValue = getNestedValue(cfg, parts);
      const required = parseRequirement(rule.requires);
      if (!meetsRequirement(currentValue, required)) {
        errors.push(`When ${rule.field}=${rule.when}: ${rule.requires} is required`);
      }
    }
  }
  return errors;
};

/**
 * Get a nested value from an object by path parts.
 * @param {object} obj
 * @param {string[]} parts
 * @returns {*}
 */
const getNestedValue = (obj, parts) => {
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[part];
  }
  return current;
};

/**
 * Parse a requirement string like '["*"]' into a value.
 * @param {string} req
 * @returns {*}
 */
const parseRequirement = (req) => {
  try {
    return JSON.parse(req);
  } catch {
    return req;
  }
};

/**
 * Check if a value meets a requirement (deep equality for arrays/objects).
 * @param {*} actual
 * @param {*} required
 * @returns {boolean}
 */
const meetsRequirement = (actual, required) => {
  if (Array.isArray(required)) {
    return Array.isArray(actual) && required.every((r) => actual.includes(r));
  }
  return actual === required;
};

/** Clear the blueprint cache (for testing). */
export const clearBlueprintCache = () => cache.clear();
