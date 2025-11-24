import { Type } from "@sinclair/typebox";
import {
  hardenSecurityConfig,
  detectMissingCredentials,
  applySessionDefaults,
  applyRoutingDefaults,
} from "../../agents/auto-config.js";
import {
  buildConfigMenu,
  buildSectionView,
  CONFIG_SECTIONS,
  isValidSectionNum,
} from "../../auto-reply/reply/config-sections.js";
import {
  parseConfigPath,
  getConfigValueAtPath,
  setConfigValueAtPath,
} from "../../config/config-paths.js";
import { loadConfig, readConfigFileSnapshot, writeConfigFile } from "../../config/io.js";
import { FIELD_HELP } from "../../config/schema.help.js";
import { validateConfigObjectWithPlugins } from "../../config/validation.js";
import { stringEnum } from "../schema/typebox.js";
import {
  findBlueprint,
  listBlueprintsForSection,
  applyCoercion,
  checkCrossField,
  extractChannelId,
} from "./blueprints/index.js";
import { jsonResult, toonResult, readStringParam, ToolInputError } from "./common.js";
import { callGatewayTool } from "./gateway.js";

/** @type {Map<string, string|null>} */
const guideCache = new Map();

/**
 * Load an operational guide from guides/{name}.md, with optional section extraction and caching.
 * @param {string} name - Guide name (channel id, "providers", "agents", etc.)
 * @param {string} [section] - Optional TOON section header to extract
 * @returns {Promise<string|null>}
 */
const loadGuide = async (name, section) => {
  const cacheKey = section ? `${name}#${section}` : name;
  if (guideCache.has(cacheKey)) {
    return guideCache.get(cacheKey);
  }

  const { readFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const toolsDir = dirname(fileURLToPath(import.meta.url));
  const guidePath = join(toolsDir, "guides", `${name}.md`);
  try {
    const fullContent = await readFile(guidePath, "utf8");
    if (!guideCache.has(name)) {
      guideCache.set(name, fullContent);
    }
    if (!section) {
      guideCache.set(cacheKey, fullContent);
      return fullContent;
    }
    // Extract TOON section: starts with "SectionName:" header, ends before next header or EOF
    const headerRe = /^[A-Z][a-zA-Z\s/()_-]*:/m;
    const sectionRe = new RegExp(`^(${section}:)`, "mi");
    const match = fullContent.match(sectionRe);
    if (!match) {
      guideCache.set(cacheKey, fullContent);
      return fullContent;
    }
    const start = match.index;
    const rest = fullContent.slice(start + match[0].length);
    const nextHeader = rest.search(headerRe);
    const result =
      nextHeader === -1
        ? fullContent.slice(start)
        : fullContent.slice(start, start + match[0].length + nextHeader).trimEnd();
    guideCache.set(cacheKey, result);
    return result;
  } catch {
    guideCache.set(cacheKey, null);
    return null;
  }
};

const SENSITIVE_PATTERNS = /key|token|password|secret|credential/i;

const CONFIG_MANAGE_ACTIONS = [
  "sections",
  "view",
  "get",
  "set",
  "remove",
  "describe",
  "status",
  "webauthn",
  "channels",
  "usage",
  "tools",
  "sessions",
  "cron",
  "logs",
  "nodes",
  "devices",
  "approvals",
  "security",
  "files",
  "skills",
  "agents",
  "providers",
  "models",
  "tts",
  "memory",
  "services",
  "gateway",
  "advanced",
  "doctor",
  "backup",
];

const ConfigManageSchema = Type.Object({
  action: stringEnum(CONFIG_MANAGE_ACTIONS),
  section: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  path: Type.Optional(Type.String()),
  value: Type.Optional(Type.Unknown()),
  subAction: Type.Optional(Type.String()),
});

/** @type {object|null} */
let schemaCache = null;

/**
 * Mask sensitive string values.
 * @param {string} path
 * @param {*} val
 * @returns {*}
 */
const maskSensitive = (path, val) =>
  typeof val === "string" && SENSITIVE_PATTERNS.test(path) && val.length > 6
    ? `${val.slice(0, 6)}***`
    : val;

/**
 * Resolve a section number from a number or key string.
 * @param {number|string} input
 * @returns {number|undefined}
 */
const resolveSectionNum = (input) => {
  if (typeof input === "number") {
    return input;
  }
  const asNum = Number(input);
  if (Number.isInteger(asNum) && isValidSectionNum(asNum)) {
    return asNum;
  }
  const match = CONFIG_SECTIONS.find(
    (s) => s.key === input || s.label.toLowerCase() === String(input).toLowerCase(),
  );
  return match?.num;
};

/**
 * Navigate a JSON Schema to a given dot-path.
 * @param {object} schema - JSON Schema root
 * @param {string[]} parts - Path segments
 * @returns {object|undefined}
 */
const navigateSchema = (schema, parts) => {
  let node = schema;
  for (const key of parts) {
    if (!node) {
      return;
    }
    const props = node.properties;
    if (props?.[key]) {
      node = props[key];
      continue;
    }
    if (node.additionalProperties && typeof node.additionalProperties === "object") {
      node = node.additionalProperties;
      continue;
    }
    return;
  }
  return node;
};

/**
 * Extract useful info from a JSON Schema node.
 * @param {object} node
 * @returns {object}
 */
const extractSchemaInfo = (node) => {
  if (!node || typeof node !== "object") {
    return {};
  }
  const info = {};
  if (node.type) {
    info.type = node.type;
  }
  if (node.enum) {
    info.options = node.enum;
  }
  if (node.default !== undefined) {
    info.default = node.default;
  }
  if (node.minimum !== undefined) {
    info.minimum = node.minimum;
  }
  if (node.maximum !== undefined) {
    info.maximum = node.maximum;
  }
  if (node.description) {
    info.description = node.description;
  }
  // Handle anyOf/oneOf enums (Zod unions)
  if (!info.options && (node.anyOf || node.oneOf)) {
    const variants = node.anyOf ?? node.oneOf;
    const literals = variants
      .filter((v) => v.const !== undefined || v.enum?.length === 1)
      .map((v) => v.const ?? v.enum?.[0]);
    if (literals.length > 0) {
      info.options = literals;
    }
  }
  return info;
};

/**
 * Find related FIELD_HELP entries sharing a common prefix.
 * @param {string} path
 * @param {object} cfg
 * @returns {Array<{path: string, help: string, currentValue?: *}>}
 */
const findRelatedPaths = (path, cfg) => {
  const parts = path.split(".");
  const prefixes = [];
  // Direct sibling prefix
  if (parts.length > 1) {
    prefixes.push(parts.slice(0, -1).join(".") + ".");
  }
  // Parent-level prefix (one level up) — for deep paths
  if (parts.length > 2) {
    prefixes.push(parts.slice(0, -2).join(".") + ".");
  }
  // Fallback for top-level keys
  if (prefixes.length === 0) {
    prefixes.push(`${path}.`);
  }
  const seen = new Set();
  const related = [];
  for (const [key, help] of Object.entries(FIELD_HELP)) {
    if (key === path || seen.has(key)) {
      continue;
    }
    if (key.includes("*") || key.includes("[]")) {
      continue;
    }
    if (!prefixes.some((p) => key.startsWith(p))) {
      continue;
    }
    seen.add(key);
    const parsed = parseConfigPath(key);
    const currentValue = parsed.ok ? getConfigValueAtPath(cfg, parsed.path) : undefined;
    related.push({ path: key, help, ...(currentValue !== undefined ? { currentValue } : {}) });
  }
  return related.slice(0, 10);
};

/**
 * Fetch and cache the JSON Schema from the gateway.
 * @returns {Promise<object|null>}
 */
const getSchema = async () => {
  if (schemaCache) {
    return schemaCache;
  }
  try {
    const result = await callGatewayTool("config.schema", {}, {});
    if (result && typeof result === "object") {
      schemaCache = result;
      return result;
    }
  } catch {
    // Gateway may not be running — schema unavailable
  }
  return null;
};

/**
 * Handle "status" action — gateway status summary with instance presence.
 * @returns {Promise<object>}
 */
const handleStatus = async () => {
  const cfg = loadConfig();
  let instances = "unavailable";
  try {
    const presence = await callGatewayTool("system-presence", {}, {});
    const entries = Array.isArray(presence?.entries) ? presence.entries : [];
    instances = entries.length;
  } catch {
    // Gateway not connected — presence unavailable
  }
  return jsonResult({
    port: cfg.gateway?.port ?? 18789,
    bind: cfg.gateway?.bind ?? "auto",
    mode: cfg.gateway?.mode ?? "local",
    agents: cfg.agents?.list ? Object.keys(cfg.agents.list).length : 0,
    channels: cfg.channels
      ? Object.keys(cfg.channels).filter((k) => typeof cfg.channels[k] === "object")
      : [],
    cron: cfg.cron?.enabled !== false,
    instances,
  });
};

/**
 * Handle "sections" action — list all config sections.
 * @returns {object}
 */
const handleSections = () => {
  const cfg = loadConfig();
  return toonResult(buildConfigMenu(cfg));
};

/**
 * Handle "view" action — show a single section.
 * @param {object} params
 * @returns {object}
 */
const handleView = (params) => {
  const raw = params.section;
  if (raw === undefined || raw === null) {
    throw new ToolInputError(`section required (1-${CONFIG_SECTIONS.length} or section key)`);
  }
  const num = resolveSectionNum(raw);
  if (!num || !isValidSectionNum(num)) {
    throw new ToolInputError(
      `Invalid section: ${raw}. Use 1-${CONFIG_SECTIONS.length} or a section key (${CONFIG_SECTIONS.map((s) => s.key).join(", ")}).`,
    );
  }
  const cfg = loadConfig();
  return toonResult(buildSectionView(cfg, num));
};

/**
 * Resolve agent string IDs in parsed paths like agents.list.{id}.x → agents.list.{index}.x
 * @param {string[]} pathParts - parsed path segments
 * @param {object} [cfg] - config object (loaded if not provided)
 * @returns {{ path: string[], resolved: boolean }}
 */
const resolveAgentInPath = (pathParts, cfg) => {
  if (pathParts[0] === "agents" && pathParts[1] === "list" && pathParts.length > 2) {
    const segment = pathParts[2];
    if (!/^\d+$/.test(segment)) {
      const config = cfg ?? loadConfig();
      const list = config?.agents?.list;
      if (Array.isArray(list)) {
        const idx = list.findIndex((a) => a?.id === segment);
        if (idx >= 0) {
          const resolved = [...pathParts];
          resolved[2] = String(idx);
          return { path: resolved, resolved: true };
        }
      }
    }
  }
  return { path: pathParts, resolved: false };
};

/**
 * Handle "get" action — retrieve a single config value.
 * @param {object} params
 * @returns {object}
 */
const handleGet = (params) => {
  const pathStr = readStringParam(params, "path", { required: true, label: "path" });
  const parsed = parseConfigPath(pathStr);
  if (!parsed.ok) {
    throw new ToolInputError(parsed.error);
  }
  const cfg = loadConfig();
  const { path } = resolveAgentInPath(parsed.path, cfg);
  const value = getConfigValueAtPath(cfg, path);
  return jsonResult({
    path: pathStr,
    value: maskSensitive(pathStr, value),
    exists: value !== undefined,
  });
};

/**
 * Handle "set" action — validate and write a config value.
 * @param {object} params
 * @returns {Promise<object>}
 */
const PROTECTED_SET_PATHS = [/^agents\.list\[\d+\]\.id$/];
const handleSet = async (params) => {
  const pathStr = readStringParam(params, "path", { required: true, label: "path" });
  if (PROTECTED_SET_PATHS.some((re) => re.test(pathStr))) {
    throw new ToolInputError(
      `Cannot set ${pathStr} directly — use "config_manage agents rename {oldId} {newId}" instead.`,
    );
  }
  if (params.value === undefined) {
    throw new ToolInputError("value required");
  }
  const parsed = parseConfigPath(pathStr);
  if (!parsed.ok) {
    throw new ToolInputError(parsed.error);
  }
  const snapshot = await readConfigFileSnapshot();
  let copy = structuredClone(snapshot.parsed);
  parsed.path = resolveAgentInPath(parsed.path, copy).path;
  // Parse JSON strings: when an LLM passes '["a","b"]' as a string, parse it
  let rawValue = params.value;
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        rawValue = JSON.parse(trimmed);
      } catch {
        // Not valid JSON — keep as string
      }
    }
  }
  // Blueprint coercion: apply type rules before writing
  const bp = await findBlueprint(pathStr);
  if (bp && !Array.isArray(rawValue)) {
    const channelId = extractChannelId(pathStr);
    rawValue = applyCoercion(bp, rawValue, channelId);
  }

  // Smart array append: when existing value is an array and new value is a scalar,
  // append instead of replace (e.g. adding a phone to channels.imessage.allowFrom)
  let finalValue = rawValue;
  let appended = false;
  const currentValue = getConfigValueAtPath(copy, parsed.path);
  if (Array.isArray(currentValue) && !Array.isArray(rawValue)) {
    finalValue = [...currentValue, rawValue];
    appended = true;
  }
  setConfigValueAtPath(copy, parsed.path, finalValue);

  // --- Auto-defaults: fill sibling fields for known paths ---
  const autoApplied = [];
  if (pathStr === "session.reset.mode" || pathStr === "session.maintenance.mode") {
    const result = applySessionDefaults(copy, pathStr, finalValue);
    if (result.applied.length) {
      copy = result.config;
      autoApplied.push(...result.applied);
    }
  }
  if (pathStr === "agents.defaults.model.routing.enabled" && finalValue === true) {
    const result = await applyRoutingDefaults(copy);
    if (result.applied.length) {
      copy = result.config;
      autoApplied.push(...result.applied);
    }
  }

  // Blueprint cross-field validation
  const crossNotes = [];
  if (bp) {
    const crossErrors = checkCrossField(
      bp,
      copy,
      pathStr,
      Array.isArray(rawValue) ? undefined : rawValue,
    );
    if (crossErrors.length) {
      if (autoApplied.length) {
        // Auto-defaults handled the dependency — downgrade to advisory notes
        crossNotes.push(...crossErrors);
      } else {
        return jsonResult({ ok: false, path: pathStr, error: crossErrors.join("; ") });
      }
    }
  }
  const validation = validateConfigObjectWithPlugins(copy);
  if (!validation.ok) {
    const msg = validation.errors?.map((e) => e.message ?? e).join("; ") ?? "Validation failed";
    return jsonResult({ ok: false, path: pathStr, error: msg });
  }
  await writeConfigFile(validation.config);

  // --- Post-set hints ---
  const hints = [];
  if (pathStr === "security.vault.enabled" && finalValue === true) {
    hints.push("Run 'config_manage security harden' to enable Fortress Mode defaults.");
  }

  return jsonResult({
    ok: true,
    path: pathStr,
    value: maskSensitive(pathStr, finalValue),
    ...(appended
      ? {
          note: `Appended to existing array (now ${finalValue.length} items). The config watcher will apply changes automatically.`,
        }
      : { note: "Config updated. The config watcher will apply changes automatically." }),
    ...(autoApplied.length ? { autoApplied } : {}),
    ...(crossNotes.length ? { advisoryNotes: crossNotes } : {}),
    ...(hints.length ? { hints } : {}),
  });
};

/**
 * Handle "remove" action — remove an element from an array config value.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleRemove = async (params) => {
  const pathStr = readStringParam(params, "path", { required: true, label: "path" });
  if (params.value === undefined) {
    throw new ToolInputError("value required (the element to remove from the array)");
  }
  const parsed = parseConfigPath(pathStr);
  if (!parsed.ok) {
    throw new ToolInputError(parsed.error);
  }
  const snapshot = await readConfigFileSnapshot();
  const copy = structuredClone(snapshot.parsed);
  parsed.path = resolveAgentInPath(parsed.path, copy).path;
  const currentValue = getConfigValueAtPath(copy, parsed.path);
  if (!Array.isArray(currentValue)) {
    return jsonResult({
      ok: false,
      path: pathStr,
      error: `Value at ${pathStr} is not an array (type: ${typeof currentValue}). Use "set" to replace it.`,
    });
  }
  let target = params.value;
  // Blueprint coercion: match target type to array element type
  const bp = await findBlueprint(pathStr);
  if (bp) {
    const channelId = extractChannelId(pathStr);
    target = applyCoercion(bp, target, channelId);
  }
  const newArray = currentValue.filter((item) => String(item) !== String(target));
  if (newArray.length === currentValue.length) {
    return jsonResult({
      ok: false,
      path: pathStr,
      error: `Element ${JSON.stringify(target)} not found in array at ${pathStr}. Current items: ${JSON.stringify(currentValue)}`,
    });
  }
  setConfigValueAtPath(copy, parsed.path, newArray);
  const validation = validateConfigObjectWithPlugins(copy);
  if (!validation.ok) {
    const msg = validation.errors?.map((e) => e.message ?? e).join("; ") ?? "Validation failed";
    return jsonResult({ ok: false, path: pathStr, error: msg });
  }
  await writeConfigFile(validation.config);
  return jsonResult({
    ok: true,
    path: pathStr,
    removed: target,
    remaining: newArray.length,
    value: maskSensitive(pathStr, newArray),
    note: `Removed from array (now ${newArray.length} items). The config watcher will apply changes automatically.`,
  });
};

/**
 * Handle "describe" action — advise about a config path or section.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleDescribe = async (params) => {
  const pathStr = readStringParam(params, "path", { required: true, label: "path" });

  // Section-level describe: if input matches a section key, list all blueprints
  const sectionMatch = CONFIG_SECTIONS.find(
    (s) => s.key === pathStr || s.label.toLowerCase() === pathStr.toLowerCase(),
  );
  if (sectionMatch) {
    const bps = await listBlueprintsForSection(sectionMatch.key);
    return jsonResult({
      section: sectionMatch.key,
      label: sectionMatch.label,
      description: sectionMatch.desc,
      operations: bps.map((bp) => ({
        pathPattern: bp.pathPattern,
        valueType: bp.valueType,
        guidance: bp.guidance,
      })),
    });
  }

  const parsed = parseConfigPath(pathStr);
  if (!parsed.ok) {
    throw new ToolInputError(parsed.error);
  }

  const cfg = loadConfig();
  parsed.path = resolveAgentInPath(parsed.path, cfg).path;
  const currentValue = getConfigValueAtPath(cfg, parsed.path);

  // Help text — exact match or prefix match
  const help =
    FIELD_HELP[pathStr] ??
    Object.entries(FIELD_HELP).find(([k]) => pathStr.startsWith(k))?.[1] ??
    null;

  // Schema info
  const schema = await getSchema();
  const schemaNode = schema ? navigateSchema(schema, parsed.path) : null;
  const schemaInfo = extractSchemaInfo(schemaNode);

  // Related paths
  const relatedPaths = findRelatedPaths(pathStr, cfg);

  // Blueprint info
  const bp = await findBlueprint(pathStr);
  const blueprint = bp
    ? {
        valueType: bp.valueType,
        coercion: bp.itemCoerce ?? "none",
        guidance: bp.guidance,
        ...(bp.crossField?.length ? { crossFieldRules: bp.crossField } : {}),
        ...(bp.examples ? { examples: bp.examples } : {}),
        ...(bp.channelRules ? { channelRules: bp.channelRules } : {}),
        ...(bp.enumValues ? { enumValues: bp.enumValues } : {}),
      }
    : undefined;

  return jsonResult({
    path: pathStr,
    currentValue: maskSensitive(pathStr, currentValue),
    exists: currentValue !== undefined,
    help,
    ...schemaInfo,
    relatedPaths: relatedPaths.length > 0 ? relatedPaths : undefined,
    ...(blueprint ? { blueprint } : {}),
  });
};

/**
 * Handle "webauthn" action — manage WebAuthn/Touch ID credentials.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleWebAuthn = async (params) => {
  const sub = (params.subAction ?? "list").toLowerCase();
  switch (sub) {
    case "list": {
      const res = await callGatewayTool("webauthn.credentials.list", {}, {});
      const creds = Array.isArray(res?.credentials) ? res.credentials : [];
      return jsonResult({
        credentials: creds.map((c) => ({
          id: typeof c.id === "string" ? c.id.slice(0, 12) + "..." : c.id,
          displayName: c.displayName ?? c.name ?? "unknown",
          createdAt: c.createdAt ?? null,
        })),
        count: creds.length,
      });
    }
    case "remove": {
      const id = readStringParam(params, "path", { required: true, label: "credential id" });
      await callGatewayTool("webauthn.credential.remove", {}, { id });
      return jsonResult({ ok: true, removed: id });
    }
    case "rename": {
      const id = readStringParam(params, "path", { required: true, label: "credential id" });
      const displayName = readStringParam(params, "value", {
        required: true,
        label: "display name",
      });
      await callGatewayTool("webauthn.credential.rename", {}, { id, displayName });
      return jsonResult({ ok: true, renamed: id, displayName });
    }
    case "register": {
      const displayName = typeof params.value === "string" ? params.value : "Touch ID";
      const res = await callGatewayTool("webauthn.register.initiate", {}, { displayName });
      return jsonResult(res);
    }
    default:
      throw new ToolInputError(
        `Unknown webauthn sub-action: ${sub}. Valid: list, remove, rename, register`,
      );
  }
};

/**
 * Compact verbose channels.status response into a summary.
 * @param {object} res - Raw channels.status response
 * @returns {object}
 */
const formatChannelStatus = (res) => {
  const raw = res?.channels ?? res ?? {};
  const labels = res?.channelLabels ?? {};
  const channels = Object.entries(raw)
    .filter(([, v]) => v && typeof v === "object")
    .map(([id, ch]) => ({
      id,
      label: labels[id] ?? id,
      configured: ch.configured ?? false,
      running: ch.running ?? false,
      connected: ch.connected ?? false,
      ...(ch.lastError ? { lastError: ch.lastError } : {}),
      ...(ch.probe ? { probe: ch.probe } : {}),
    }));
  const accounts = res?.accounts ?? undefined;
  return { channels, ...(accounts ? { accounts } : {}) };
};

/**
 * Handle "channels" action — manage channels conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleChannels = async (params) => {
  const sub = (params.subAction ?? "status").toLowerCase();
  switch (sub) {
    case "status": {
      const res = await callGatewayTool("channels.status", {}, { probe: false });
      const formatted = formatChannelStatus(res);
      return jsonResult({
        ...formatted,
        _renderHint:
          "Present using a nyx-ui status-grid. Dot: green=connected, yellow=running no connection, red=error, gray=disabled/unconfigured. Actions: chat commands for enable/disable/configure, rpc channel.setup.initiate for WhatsApp/Telegram setup.",
      });
    }
    case "probe": {
      const res = await callGatewayTool("channels.status", {}, { probe: true, timeoutMs: 10000 });
      return jsonResult(formatChannelStatus(res));
    }
    case "enable": {
      const name = readStringParam(params, "path", { required: true, label: "channel name" });
      const result = await handleSet({ path: `channels.${name}.enabled`, value: true });
      const channelCfg = loadConfig()?.channels?.[name] ?? {};
      const { missing, hint } = detectMissingCredentials(name, channelCfg);
      if (missing.length) {
        const parsed = JSON.parse(result.content[0].text);
        parsed.warnings = missing.map((f) => `Missing required field: ${f}`);
        parsed.hint = hint;
        return jsonResult(parsed);
      }
      return result;
    }
    case "disable": {
      const name = readStringParam(params, "path", { required: true, label: "channel name" });
      return await handleSet({ path: `channels.${name}.enabled`, value: false });
    }
    case "logout": {
      const channel = readStringParam(params, "path", { required: true, label: "channel name" });
      const res = await callGatewayTool("channels.logout", {}, { channel });
      return jsonResult(res);
    }
    case "whatsapp.login": {
      const res = await callGatewayTool("whatsapp.qr.initiate", {}, {});
      return jsonResult(res);
    }
    case "nostr.profile": {
      const accountId = typeof params.path === "string" ? params.path : undefined;
      const rpcParams = accountId ? { accountId } : {};
      const res = await callGatewayTool("nostr.profile.edit.initiate", {}, rpcParams);
      return jsonResult(res);
    }
    case "whatsapp.setup":
    case "telegram.setup": {
      const channel = sub.replace(/\.setup$/, "");
      const accountId = typeof params.path === "string" ? params.path : undefined;
      const rpcParams = { channel, ...(accountId ? { accountId } : {}) };
      const res = await callGatewayTool("channel.setup.initiate", {}, rpcParams);
      return jsonResult(res);
    }
    case "overview": {
      const guide = await loadGuide("channels-overview");
      if (!guide) {
        return jsonResult({ error: "No overview guide found for channels." });
      }
      return jsonResult({
        topic: "channels-overview",
        guide,
        hint: "IMPORTANT: Follow the guide for policy hierarchy, DM scopes, and common patterns. Use config_manage set/get to apply settings.",
      });
    }
    case "imessage.setup":
    case "discord.setup":
    case "slack.setup":
    case "signal.setup":
    case "nostr.setup":
    case "matrix.setup": {
      const channel = sub.replace(/\.setup$/, "");
      const guide = await loadGuide(channel);
      if (!guide) {
        return jsonResult({
          error: `No setup guide found for channel: ${channel}. Use config_manage set to configure manually.`,
        });
      }
      return jsonResult({
        channel,
        guide,
        hint: "IMPORTANT: Follow the guide STRICTLY in order. For diagnostics, follow the numbered checklist — do NOT run extra commands outside the guide. Use config_manage set/get to apply settings.",
      });
    }
    default:
      throw new ToolInputError(
        `Unknown channels sub-action: ${sub}. Valid: status, probe, enable, disable, logout, overview, whatsapp.login, whatsapp.setup, telegram.setup, nostr.profile, imessage.setup, discord.setup, slack.setup, signal.setup, nostr.setup, matrix.setup`,
      );
  }
};

/**
 * Build a ready-to-paste nyx-ui chart block from daily usage data.
 * @param {Array} daily
 * @param {"cost"|"tokens"} [metric]
 * @param {"bar"|"line"} [chartType]
 * @returns {string}
 */
const buildUsageChartBlock = (daily, metric = "cost", chartType = "bar") => {
  const labels = daily.map((d) => d.date);
  const isCost = metric === "cost";
  const values = daily.map((d) => (isCost ? +(d.totalCost ?? 0).toFixed(4) : (d.totalTokens ?? 0)));
  const block = JSON.stringify({
    component: "chart",
    chartType,
    title: isCost ? "Daily Cost ($)" : "Daily Tokens",
    data: { labels, datasets: [{ name: isCost ? "Cost ($)" : "Tokens", values }] },
  });
  return "\n```nyx-ui\n" + block + "\n```";
};

/**
 * Build compact totals summary from daily usage data.
 * @param {Array} daily
 * @returns {{ totalTokens: number, totalCost: string, days: number, topDay: object|null }}
 */
const buildUsageTotals = (daily) => {
  const totals = daily.reduce(
    (acc, d) => {
      acc.tokens += d.totalTokens ?? 0;
      acc.cost += d.totalCost ?? 0;
      return acc;
    },
    { tokens: 0, cost: 0 },
  );
  const topDay = daily.toSorted((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0))[0];
  return {
    totalTokens: totals.tokens,
    totalCost: `$${totals.cost.toFixed(4)}`,
    days: daily.length,
    topDay: topDay ? { date: topDay.date, cost: `$${(topDay.totalCost ?? 0).toFixed(4)}` } : null,
  };
};

/** Detect metric from user params. */
const inferUsageMetric = (params) => {
  const hint = `${params.path ?? ""} ${params.section ?? ""}`.toLowerCase();
  return hint.includes("token") ? "tokens" : "cost";
};

/**
 * Handle "usage" action — query usage analytics conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleUsage = async (params) => {
  const sub = (params.subAction ?? "summary").toLowerCase();
  const dateParams = {};
  if (typeof params.value === "number") {
    dateParams.days = params.value;
  } else if (typeof params.value === "string") {
    dateParams.days = parseInt(params.value) || 30;
  }
  if (typeof params.path === "string" && params.path.includes(",")) {
    const [start, end] = params.path.split(",").map((s) => s.trim());
    dateParams.startDate = start;
    dateParams.endDate = end;
  }
  switch (sub) {
    case "summary":
    case "cost":
    case "chart": {
      const days = dateParams.days ?? (sub === "summary" ? 30 : 7);
      const res = await callGatewayTool(
        "usage.cost",
        {},
        { days, startDate: dateParams.startDate, endDate: dateParams.endDate },
      );
      const daily = res?.daily ?? [];
      const metric = inferUsageMetric(params);
      return jsonResult({
        ...buildUsageTotals(daily),
        _chartBlock: buildUsageChartBlock(daily, metric),
        _renderHint:
          "Include the _chartBlock value verbatim in your reply (it is a ready-to-use ```nyx-ui block). Add a brief text summary with the totals.",
      });
    }
    case "sessions": {
      const limit = typeof params.value === "number" ? params.value : 20;
      const res = await callGatewayTool(
        "sessions.usage",
        {},
        {
          days: dateParams.days ?? 30,
          limit,
          startDate: dateParams.startDate,
          endDate: dateParams.endDate,
        },
      );
      const sessions = (res?.sessions ?? []).slice(0, 20).map((s) => ({
        key: s.key,
        label: s.label,
        tokens: s.usage?.totalTokens ?? 0,
        cost: `$${(s.usage?.totalCost ?? 0).toFixed(4)}`,
        messages: s.usage?.messageCounts?.total ?? 0,
        errors: s.usage?.messageCounts?.errors ?? 0,
      }));
      return jsonResult({
        sessions,
        totals: res?.totals
          ? { tokens: res.totals.totalTokens, cost: `$${res.totals.totalCost.toFixed(4)}` }
          : null,
      });
    }
    default:
      throw new ToolInputError(
        `Unknown usage sub-action: ${sub}. Valid: summary, cost, sessions, chart`,
      );
  }
};

/**
 * Resolve an agent ID to its numeric index in agents.list[].
 * @param {object} cfg
 * @param {string} agentId
 * @returns {number}
 */
const resolveAgentIndex = (cfg, agentId) => {
  const list = cfg?.agents?.list;
  if (!Array.isArray(list)) {
    return -1;
  }
  return list.findIndex((e) => e?.id === agentId);
};

/**
 * Handle "security" action — manage vault/fortress/webauthn conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleSecurity = async (params) => {
  const sub = (params.subAction ?? "status").toLowerCase();
  const cfg = loadConfig();

  switch (sub) {
    case "status": {
      const sec = cfg?.security ?? {};
      const { getVaultStatus } = await import("../../infra/vault-state.js");
      const vaultStatus = getVaultStatus();
      return jsonResult({
        vault: {
          enabled: !vaultStatus.locked,
          autoLockMinutes: Math.round(vaultStatus.autoLockMs / 60_000),
          idleMinutes: Math.round(vaultStatus.idleMs / 60_000),
        },
        fortress: {
          enabled: sec.fortress?.enabled ?? false,
          auditLog: sec.fortress?.auditLog ?? false,
          rateLimiting: sec.fortress?.rateLimiting ?? false,
        },
        webauthn: { enabled: sec.webauthn?.enabled ?? false },
      });
    }
    case "harden": {
      const { config, applied } = hardenSecurityConfig(cfg);
      if (!applied.length) {
        return jsonResult({
          ok: true,
          note: cfg?.security?.vault?.enabled
            ? "Already hardened — all fortress defaults are set."
            : "Vault is not enabled. Enable security.vault.enabled first.",
        });
      }
      const validation = validateConfigObjectWithPlugins(config);
      if (!validation.ok) {
        const msg = validation.errors?.map((e) => e.message ?? e).join("; ") ?? "Validation failed";
        return jsonResult({ ok: false, error: msg });
      }
      await writeConfigFile(validation.config);
      return jsonResult({
        ok: true,
        applied,
        note: "Security hardened. Config watcher will apply changes.",
      });
    }
    case "audit": {
      const { runSecurityAudit } = await import("../../security/audit.js");
      const { resolveStateDir } = await import("../../config/paths.js");
      const deep = params.value === "deep" || params.value === true;
      const report = await runSecurityAudit({
        config: cfg,
        stateDir: resolveStateDir(),
        deep,
        includeFilesystem: true,
        includeChannelSecurity: true,
      });
      return jsonResult({
        summary: report.summary,
        findings: report.findings.map((f) => ({
          checkId: f.checkId,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          ...(f.remediation ? { remediation: f.remediation } : {}),
        })),
        ...(report.deep ? { deep: report.deep } : {}),
      });
    }
    default: {
      // Delegate to handleSet/handleGet with security.* prefix
      if (params.value !== undefined) {
        const pathStr = typeof params.path === "string" ? params.path : sub;
        const fullPath = pathStr.startsWith("security.") ? pathStr : `security.${pathStr}`;
        return await handleSet({ path: fullPath, value: params.value });
      }
      const pathStr = typeof params.path === "string" ? params.path : sub;
      const fullPath = pathStr.startsWith("security.") ? pathStr : `security.${pathStr}`;
      return handleGet({ path: fullPath });
    }
  }
};

/**
 * Handle "tools" action — manage agent tool policies conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleTools = async (params) => {
  const sub = (params.subAction ?? "status").toLowerCase();
  const cfg = loadConfig();
  const agentId = typeof params.path === "string" ? params.path : cfg?.agents?.list?.[0]?.id;

  if (sub === "global") {
    // Global tools config — show or set
    const globalTools = cfg?.tools ?? {};
    if (params.value === undefined) {
      return jsonResult({
        tools: {
          allow: globalTools.allow ?? null,
          deny: globalTools.deny ?? null,
          "exec.denyBins": globalTools.exec?.denyBins ?? "(defaults)",
          "exec.safeBins": globalTools.exec?.safeBins ?? [],
        },
      });
    }
    // Set a global field: value should be { field: val }
    if (typeof params.value === "object" && !Array.isArray(params.value)) {
      const results = [];
      for (const [field, val] of Object.entries(params.value)) {
        const dotPath = field.includes(".") ? `tools.${field}` : `tools.${field}`;
        results.push(await handleSet({ path: dotPath, value: val }));
      }
      return results.length === 1 ? results[0] : jsonResult({ results });
    }
    throw new ToolInputError(
      'For global tools set, pass value as {field: val}, e.g. {"deny": ["exec"]}',
    );
  }

  // Resolve agent — support implicit default agent (no agents.list)
  const hasList = Array.isArray(cfg?.agents?.list) && cfg.agents.list.length > 0;
  const resolvedAgentId = agentId ?? (hasList ? cfg.agents.list[0]?.id : "main");
  const idx = hasList ? resolveAgentIndex(cfg, resolvedAgentId) : -1;
  const isImplicit = !hasList || idx < 0;
  const basePath = isImplicit ? "agents.defaults.tools" : `agents.list.${idx}.tools`;
  const entry = isImplicit
    ? (cfg?.agents?.defaults?.tools ?? cfg?.tools ?? {})
    : (cfg?.agents?.list?.[idx]?.tools ?? {});

  switch (sub) {
    case "profile": {
      const profile = typeof params.value === "string" ? params.value : null;
      if (!profile) {
        throw new ToolInputError(
          "Pass profile name via value: minimal | coding | messaging | full",
        );
      }
      return await handleSet({ path: `${basePath}.profile`, value: profile });
    }

    case "allow":
      return await handleSet({ path: `${basePath}.allow`, value: params.value });

    case "also-allow": {
      const val = typeof params.value === "string" ? params.value : params.value;
      return await handleSet({ path: `${basePath}.alsoAllow`, value: val });
    }

    case "deny":
      return await handleSet({ path: `${basePath}.deny`, value: params.value });

    case "unallow": {
      const target = typeof params.value === "string" ? params.value : String(params.value);
      // Try alsoAllow first, then allow
      const alsoAllow = entry.alsoAllow ?? [];
      const allow = entry.allow ?? [];
      if (alsoAllow.map(String).includes(target)) {
        return await handleRemove({ path: `${basePath}.alsoAllow`, value: target });
      }
      if (allow.map(String).includes(target)) {
        return await handleRemove({ path: `${basePath}.allow`, value: target });
      }
      return jsonResult({
        ok: false,
        error: `"${target}" not found in allow or alsoAllow for agent ${agentId}`,
      });
    }

    case "undeny":
      return await handleRemove({ path: `${basePath}.deny`, value: params.value });

    case "denybins":
      return await handleSet({ path: `${basePath}.exec.denyBins`, value: params.value });

    case "safebins":
      return await handleSet({ path: `${basePath}.exec.safeBins`, value: params.value });

    default:
      throw new ToolInputError(
        `Unknown tools sub-action: ${sub}. Valid: status, profile, allow, also-allow, deny, unallow, undeny, denybins, safebins, global`,
      );
  }
};

/**
 * Compact a sessions list into a summary.
 * @param {object} res - Raw sessions.list response
 * @returns {object[]}
 */
const formatSessionList = (res) => {
  const sessions = res?.sessions ?? [];
  return sessions.map((s) => ({
    key: s.key,
    label: s.label ?? null,
    kind: s.kind ?? "dm",
    tokens: s.totalTokens ?? 0,
    context: s.contextTokens ?? 0,
    ...(s.thinkingLevel ? { thinking: s.thinkingLevel } : {}),
    ...(s.verboseLevel ? { verbose: s.verboseLevel } : {}),
    ...(s.reasoningLevel ? { reasoning: s.reasoningLevel } : {}),
    ...(s.model ? { model: s.model } : {}),
  }));
};

/**
 * Handle "sessions" action — manage sessions conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleSessions = async (params) => {
  const sub = (params.subAction ?? "list").toLowerCase();
  switch (sub) {
    case "setup": {
      const guide = await loadGuide("sessions");
      if (!guide) {
        return jsonResult({ error: "No setup guide found for sessions." });
      }
      return jsonResult({
        topic: "sessions",
        guide,
        hint: "IMPORTANT: Follow the guide STRICTLY in order. For diagnostics, follow the numbered checklist. Use config_manage set/get to apply settings.",
      });
    }
    case "list": {
      const res = await callGatewayTool("sessions.list", {}, { includeGlobal: true });
      return jsonResult({ sessions: formatSessionList(res), count: res?.sessions?.length ?? 0 });
    }
    case "get": {
      const key = readStringParam(params, "path", { required: true, label: "session key" });
      const res = await callGatewayTool("sessions.list", {}, { includeGlobal: true });
      const match = (res?.sessions ?? []).find((s) => s.key === key);
      if (!match) {
        return jsonResult({ ok: false, error: `Session "${key}" not found` });
      }
      return jsonResult(match);
    }
    case "patch": {
      const key = readStringParam(params, "path", { required: true, label: "session key" });
      if (!params.value || typeof params.value !== "object") {
        throw new ToolInputError(
          "value required as object: {thinkingLevel?, verboseLevel?, reasoningLevel?, label?, model?}",
        );
      }
      const patch = { key };
      for (const field of ["thinkingLevel", "verboseLevel", "reasoningLevel", "label", "model"]) {
        if (field in params.value) {
          patch[field] = params.value[field];
        }
      }
      await callGatewayTool("sessions.patch", {}, patch);
      return jsonResult({ ok: true, patched: key, applied: params.value });
    }
    case "delete": {
      const key = readStringParam(params, "path", { required: true, label: "session key" });
      await callGatewayTool("sessions.delete", {}, { key, deleteTranscript: true });
      return jsonResult({ ok: true, deleted: key });
    }
    case "reset": {
      const key = readStringParam(params, "path", { required: true, label: "session key" });
      await callGatewayTool("sessions.reset", {}, { key });
      return jsonResult({ ok: true, reset: key });
    }
    case "compact": {
      const key = readStringParam(params, "path", { required: true, label: "session key" });
      const res = await callGatewayTool("sessions.compact", {}, { key });
      return jsonResult({ ok: true, compacted: key, ...res });
    }
    default:
      throw new ToolInputError(
        `Unknown sessions sub-action: ${sub}. Valid: setup, list, get, patch, delete, reset, compact`,
      );
  }
};

/**
 * Handle "cron" action — manage cron jobs conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleCron = async (params) => {
  const sub = (params.subAction ?? "board").toLowerCase();
  if (sub === "board") {
    const res = await callGatewayTool("cron.board.initiate", {}, {});
    return jsonResult(res);
  }
  throw new ToolInputError(
    `Use the dedicated cron tool for ${sub} operations. config_manage cron only supports: board`,
  );
};

/**
 * Handle "logs" action — view logs via overlay or tail in chat.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleLogs = async (params) => {
  const sub = (params.subAction ?? "view").toLowerCase();
  switch (sub) {
    case "view": {
      const levels = (() => {
        if (Array.isArray(params.value)) {
          return params.value;
        }
        if (typeof params.value === "string") {
          return params.value.split(",").map((s) => s.trim());
        }
        return undefined;
      })();
      const text = typeof params.path === "string" ? params.path : undefined;
      const res = await callGatewayTool(
        "logs.view.initiate",
        {},
        { ...(levels ? { levels } : {}), ...(text ? { text } : {}) },
      );
      return jsonResult(res);
    }
    case "tail": {
      const limit = typeof params.value === "number" ? params.value : 50;
      const res = await callGatewayTool("logs.tail", {}, { limit });
      const lines = Array.isArray(res?.lines) ? res.lines : [];
      return jsonResult({
        file: res?.file ?? null,
        lines: lines.slice(-limit),
        count: lines.length,
        truncated: res?.truncated ?? false,
      });
    }
    default:
      throw new ToolInputError(`Unknown logs sub-action: ${sub}. Valid: view, tail`);
  }
};

/**
 * Handle "nodes" action — list paired nodes and manage exec binding.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleNodes = async (params) => {
  const sub = (params.subAction ?? "list").toLowerCase();
  switch (sub) {
    case "list": {
      const res = await callGatewayTool("nodes.list", {}, {});
      const nodes = (res?.nodes ?? []).map((n) => ({
        id: n.id,
        name: n.name ?? n.id,
        connected: n.connected ?? false,
        capabilities: n.capabilities ?? [],
        ...(n.platform ? { platform: n.platform } : {}),
        ...(n.version ? { version: n.version } : {}),
      }));
      return jsonResult({ nodes, count: nodes.length });
    }
    case "binding": {
      const nodeId = readStringParam(params, "value", { required: true, label: "node id" });
      const agentPath = typeof params.path === "string" ? params.path : null;
      if (agentPath) {
        const cfg = loadConfig();
        const idx = resolveAgentIndex(cfg, agentPath);
        if (idx < 0) {
          return jsonResult({ ok: false, error: `Agent "${agentPath}" not found in agents.list` });
        }
        return await handleSet({ path: `agents.list.${idx}.tools.exec.node`, value: nodeId });
      }
      return await handleSet({ path: "tools.exec.node", value: nodeId });
    }
    case "unbind": {
      const agentPath = typeof params.path === "string" ? params.path : null;
      if (agentPath) {
        const cfg = loadConfig();
        const idx = resolveAgentIndex(cfg, agentPath);
        if (idx < 0) {
          return jsonResult({ ok: false, error: `Agent "${agentPath}" not found in agents.list` });
        }
        return await handleRemove({ path: `agents.list.${idx}.tools.exec.node`, value: "" });
      }
      return await handleRemove({ path: "tools.exec.node", value: "" });
    }
    default:
      throw new ToolInputError(`Unknown nodes sub-action: ${sub}. Valid: list, binding, unbind`);
  }
};

/**
 * Handle "devices" action — manage paired devices.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleDevices = async (params) => {
  const sub = (params.subAction ?? "list").toLowerCase();
  switch (sub) {
    case "list": {
      const res = await callGatewayTool("devices.list", {}, {});
      const devices = (res?.devices ?? []).map((d) => ({
        id: d.id ?? d.deviceId,
        name: d.name ?? null,
        status: d.status ?? "unknown",
        role: d.role ?? null,
        ...(d.lastSeen ? { lastSeen: d.lastSeen } : {}),
        ...(d.platform ? { platform: d.platform } : {}),
      }));
      return jsonResult({ devices, count: devices.length });
    }
    case "approve": {
      const deviceId = readStringParam(params, "value", { required: true, label: "device id" });
      const res = await callGatewayTool("devices.approve", {}, { requestId: deviceId });
      return jsonResult({ ok: true, approved: deviceId, ...res });
    }
    case "reject": {
      const deviceId = readStringParam(params, "value", { required: true, label: "device id" });
      const res = await callGatewayTool("devices.reject", {}, { requestId: deviceId });
      return jsonResult({ ok: true, rejected: deviceId, ...res });
    }
    case "remove": {
      const deviceId = readStringParam(params, "value", { required: true, label: "device id" });
      const res = await callGatewayTool("devices.remove", {}, { deviceId });
      return jsonResult({ ok: true, removed: deviceId, ...res });
    }
    case "rotate": {
      const deviceId = readStringParam(params, "value", { required: true, label: "device id" });
      const role = typeof params.path === "string" ? params.path : undefined;
      const res = await callGatewayTool(
        "devices.rotateToken",
        {},
        { deviceId, ...(role ? { role } : {}) },
      );
      return jsonResult({ ok: true, rotated: deviceId, ...res });
    }
    default:
      throw new ToolInputError(
        `Unknown devices sub-action: ${sub}. Valid: list, approve, reject, remove, rotate`,
      );
  }
};

/**
 * Handle "approvals" action — manage exec approval policies.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleApprovals = async (params) => {
  const sub = (params.subAction ?? "get").toLowerCase();
  const scope = typeof params.path === "string" ? params.path : "__defaults__";
  const isDefault = scope === "__defaults__";

  /** Read the full approvals snapshot. */
  const getSnapshot = async () => {
    const res = await callGatewayTool("exec.approvals.get", {}, {});
    return res;
  };

  /** Resolve the section for the current scope from the file. */
  const resolveSection = (file) =>
    isDefault ? (file?.defaults ?? {}) : (file?.agents?.[scope] ?? {});

  /** Write the section back into the file at the correct scope. */
  const applySection = (file, section) => {
    const next = { ...file, version: file?.version ?? 1 };
    if (isDefault) {
      next.defaults = section;
    } else {
      next.agents = { ...next.agents, [scope]: section };
    }
    return next;
  };

  switch (sub) {
    case "get": {
      const snap = await getSnapshot();
      return jsonResult(isDefault ? snap : { ...snap, scope, section: resolveSection(snap?.file) });
    }
    case "policy": {
      const value = readStringParam(params, "value", { required: true, label: "policy" });
      const snap = await getSnapshot();
      const section = { ...resolveSection(snap?.file), security: value };
      const file = applySection(snap?.file, section);
      await callGatewayTool("exec.approvals.set", {}, { file, baseHash: snap?.hash });
      return jsonResult({ ok: true, scope, security: value });
    }
    case "ask": {
      const value = readStringParam(params, "value", { required: true, label: "ask mode" });
      const snap = await getSnapshot();
      const section = { ...resolveSection(snap?.file), ask: value };
      const file = applySection(snap?.file, section);
      await callGatewayTool("exec.approvals.set", {}, { file, baseHash: snap?.hash });
      return jsonResult({ ok: true, scope, ask: value });
    }
    case "auto-allow": {
      const raw = params.value;
      const value = raw === true || raw === "true";
      const snap = await getSnapshot();
      const section = { ...resolveSection(snap?.file), autoAllowSkills: value };
      const file = applySection(snap?.file, section);
      await callGatewayTool("exec.approvals.set", {}, { file, baseHash: snap?.hash });
      return jsonResult({ ok: true, scope, autoAllowSkills: value });
    }
    case "allowlist.add": {
      const pattern = readStringParam(params, "value", { required: true, label: "pattern" });
      const snap = await getSnapshot();
      const section = { ...resolveSection(snap?.file) };
      const list = Array.isArray(section.allowlist) ? [...section.allowlist] : [];
      if (!list.some((e) => (typeof e === "string" ? e : e?.pattern) === pattern)) {
        list.push({ pattern });
      }
      section.allowlist = list;
      const file = applySection(snap?.file, section);
      await callGatewayTool("exec.approvals.set", {}, { file, baseHash: snap?.hash });
      return jsonResult({ ok: true, scope, added: pattern, allowlist: list });
    }
    case "allowlist.remove": {
      const pattern = readStringParam(params, "value", { required: true, label: "pattern" });
      const snap = await getSnapshot();
      const section = { ...resolveSection(snap?.file) };
      const list = Array.isArray(section.allowlist)
        ? section.allowlist.filter((e) => (typeof e === "string" ? e : e?.pattern) !== pattern)
        : [];
      section.allowlist = list;
      const file = applySection(snap?.file, section);
      await callGatewayTool("exec.approvals.set", {}, { file, baseHash: snap?.hash });
      return jsonResult({ ok: true, scope, removed: pattern, allowlist: list });
    }
    default:
      throw new ToolInputError(
        `Unknown approvals sub-action: ${sub}. Valid: get, policy, ask, auto-allow, allowlist.add, allowlist.remove`,
      );
  }
};

/**
 * Handle "files" action — browse/list/get/set workspace files conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleFiles = async (params) => {
  const sub = (params.subAction ?? "browse").toLowerCase();
  const cfg = loadConfig();
  const list = cfg?.agents?.list ?? [];
  const agentId = typeof params.path === "string" ? params.path : (list[0]?.id ?? "main");

  switch (sub) {
    case "browse": {
      const res = await callGatewayTool("files.browser.initiate", {}, { agentId });
      return jsonResult(res);
    }
    case "list": {
      const res = await callGatewayTool("agents.files.list", {}, { agentId });
      const files = (res?.files ?? []).map((f) => ({
        name: f.name,
        section: f.section ?? "core",
        size: f.size ?? 0,
        missing: f.missing ?? false,
      }));
      return jsonResult({ agentId, files, count: files.length, workspace: res?.workspace ?? null });
    }
    case "get": {
      const name = readStringParam(params, "value", { required: true, label: "file name" });
      const res = await callGatewayTool("agents.files.get", {}, { agentId, name });
      return jsonResult(res);
    }
    case "set": {
      const name = readStringParam(params, "value", { required: true, label: "file name" });
      const content = typeof params.section === "string" ? params.section : "";
      const res = await callGatewayTool("agents.files.set", {}, { agentId, name, content });
      return jsonResult(res);
    }
    default:
      throw new ToolInputError(`Unknown files sub-action: ${sub}. Valid: browse, list, get, set`);
  }
};

/**
 * Handle "skills" action — manage agent skills conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleSkills = async (params) => {
  const sub = (params.subAction ?? "status").toLowerCase();

  switch (sub) {
    case "status": {
      const res = await callGatewayTool("skills.status", {}, {});
      const skills = res?.skills ?? [];
      return jsonResult({
        skills: skills.map((s) => ({
          key: s.skillKey,
          name: s.name,
          enabled: !s.disabled,
          source: s.source,
          description: s.description,
        })),
        count: skills.length,
        _renderHint:
          "Present using a nyx-ui data-table. Columns: Name, Source, Status. Dot: green=enabled, gray=disabled. Actions: chat commands for enable/disable.",
      });
    }
    case "list": {
      const res = await callGatewayTool("skills.status", {}, {});
      const skills = res?.skills ?? [];
      const filter = typeof params.path === "string" ? params.path.toLowerCase() : null;
      const filtered = filter
        ? skills.filter((s) =>
            filter === "enabled"
              ? !s.disabled
              : filter === "disabled"
                ? s.disabled
                : filter === "blocked"
                  ? s.blocked
                  : true,
          )
        : skills;
      return jsonResult({
        skills: filtered.map((s) => ({
          key: s.skillKey,
          name: s.name,
          enabled: !s.disabled,
          source: s.source,
          description: s.description,
        })),
        count: filtered.length,
        total: skills.length,
      });
    }
    case "enable": {
      const skillKey = readStringParam(params, "value", { required: true, label: "skill key" });
      await callGatewayTool("skills.update", {}, { skillKey, enabled: true });
      return jsonResult({ ok: true, skillKey, enabled: true });
    }
    case "disable": {
      const skillKey = readStringParam(params, "value", { required: true, label: "skill key" });
      await callGatewayTool("skills.update", {}, { skillKey, enabled: false });
      return jsonResult({ ok: true, skillKey, enabled: false });
    }
    case "key": {
      const skillKey = readStringParam(params, "value", { required: true, label: "skill key" });
      const apiKey = typeof params.section === "string" ? params.section : "";
      await callGatewayTool("skills.update", {}, { skillKey, apiKey });
      return jsonResult({ ok: true, skillKey, apiKeySaved: true });
    }
    case "install": {
      const name = readStringParam(params, "value", { required: true, label: "skill name" });
      const installId = typeof params.path === "string" ? params.path : undefined;
      const res = await callGatewayTool(
        "skills.install",
        {},
        { name, installId, timeoutMs: 120000 },
      );
      return jsonResult(res);
    }
    default:
      throw new ToolInputError(
        `Unknown skills sub-action: ${sub}. Valid: status, list, enable, disable, key, install`,
      );
  }
};

/**
 * Handle "agents" action — manage agents conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleAgents = async (params) => {
  const sub = (params.subAction ?? "list").toLowerCase();
  switch (sub) {
    case "setup": {
      const guide = await loadGuide("agents");
      if (!guide) {
        return jsonResult({ error: "No setup guide found for agents." });
      }
      return jsonResult({
        topic: "agents",
        guide,
        hint: "IMPORTANT: Follow the guide STRICTLY in order. For diagnostics, follow the numbered checklist. Use config_manage agents list/get/create/set to apply settings.",
      });
    }
    case "list": {
      const res = await callGatewayTool("agents.list", {}, {});
      return jsonResult({
        agents: (res?.agents ?? []).map((a) => ({
          id: a.id,
          name: a.name ?? a.id,
          identity: a.identity ?? {},
        })),
        count: (res?.agents ?? []).length,
        defaultId: res?.defaultId ?? "main",
      });
    }
    case "get": {
      const agentId = readStringParam(params, "value", { required: true, label: "agent id" });
      const res = await callGatewayTool("agents.list", {}, {});
      const match = (res?.agents ?? []).find(
        (a) => a.id === agentId || a.name?.toLowerCase() === agentId.toLowerCase(),
      );
      if (!match) {
        return jsonResult({ ok: false, error: `Agent "${agentId}" not found` });
      }
      return jsonResult(match);
    }
    case "create":
    case "add": {
      const name = readStringParam(params, "value", { required: true, label: "agent name" });
      // Check both section and path for template slug — LLMs may use either
      const rawSection = typeof params.section === "string" ? params.section.trim() : undefined;
      const rawPath = readStringParam(params, "path") || undefined;
      // A template slug has no spaces and matches a known pattern (e.g. "seo-specialist")
      const isSlug = (s) => s && /^[a-z0-9-]+$/.test(s);
      const template = rawSection ?? (isSlug(rawPath) ? rawPath : undefined);
      const description = template ? undefined : rawPath;
      const res = await callGatewayTool(
        "agents.create",
        {},
        {
          name,
          ...(description ? { description } : {}),
          ...(template ? { template } : {}),
        },
      );
      return jsonResult(res);
    }
    case "update": {
      const agentId = readStringParam(params, "value", { required: true, label: "agent id" });
      const name = typeof params.path === "string" ? params.path.trim() : undefined;
      const model = typeof params.section === "string" ? params.section.trim() : undefined;
      const res = await callGatewayTool(
        "agents.update",
        {},
        { agentId, ...(name ? { name } : {}), ...(model ? { model } : {}) },
      );
      return jsonResult(res);
    }
    case "rename": {
      const agentId = readStringParam(params, "value", {
        required: true,
        label: "current agent id",
      });
      const newId = readStringParam(params, "path", { required: true, label: "new agent id" });
      const res = await callGatewayTool("agents.rename", {}, { agentId, newId });
      return jsonResult(res);
    }
    case "delete":
    case "remove": {
      const agentId = readStringParam(params, "value", { required: true, label: "agent id" });
      const deleteFiles = params.path !== "keep-files";
      const res = await callGatewayTool("agents.delete", {}, { agentId, deleteFiles });
      return jsonResult(res);
    }
    default:
      throw new ToolInputError(
        `Unknown agents sub-action: ${sub}. Valid: setup, list, get, create, update, rename, delete`,
      );
  }
};

/**
 * Format provider list for chat display.
 * @param {Array<object>} profiles
 * @returns {Array<object>}
 */
const formatProviderList = (profiles) =>
  profiles.map((p) => ({
    id: p.profileId,
    provider: p.provider,
    type: p.type,
    masked: p.maskedValue,
    ...(p.disabled ? { disabled: true } : {}),
    ...(p.email ? { email: p.email } : {}),
  }));

/**
 * Handle "providers" action — manage AI model providers conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleProviders = async (params) => {
  const sub = (params.subAction ?? "list").toLowerCase();
  switch (sub) {
    case "setup": {
      const guide = await loadGuide("providers");
      if (!guide) {
        return jsonResult({ error: "No setup guide found for providers." });
      }
      return jsonResult({
        topic: "providers",
        guide,
        hint: "IMPORTANT: Follow the guide STRICTLY in order. For diagnostics, follow the numbered checklist. Use config_manage providers add/list/get to apply settings.",
      });
    }
    case "status": {
      const res = await callGatewayTool("providers.list", {}, {});
      const profiles = res?.profiles ?? [];
      return jsonResult({
        providers: formatProviderList(profiles),
        count: profiles.length,
        _renderHint:
          "Present using a nyx-ui status-grid. Dot: green=enabled (no disabled flag), gray=disabled/paused. Label=provider name (capitalize). Status=type + masked key. Actions: chat commands for pause/resume/delete.",
      });
    }
    case "list": {
      const res = await callGatewayTool("providers.list", {}, {});
      const profiles = res?.profiles ?? [];
      const filter = typeof params.path === "string" ? params.path.toLowerCase() : null;
      const filtered = filter
        ? profiles.filter((p) =>
            filter === "enabled"
              ? !p.disabled
              : filter === "disabled"
                ? p.disabled === true
                : filter === "paused"
                  ? p.disabled === true
                  : p.provider === filter,
          )
        : profiles;
      return jsonResult({
        providers: formatProviderList(filtered),
        count: filtered.length,
        total: profiles.length,
      });
    }
    case "get": {
      const profileId = readStringParam(params, "value", { required: true, label: "profile id" });
      const res = await callGatewayTool("providers.list", {}, {});
      const match = (res?.profiles ?? []).find(
        (p) => p.profileId === profileId || p.provider === profileId,
      );
      if (!match) {
        return jsonResult({ ok: false, error: `Provider "${profileId}" not found` });
      }
      return jsonResult(formatProviderList([match])[0]);
    }
    case "pause":
    case "disable": {
      const profileId = readStringParam(params, "value", { required: true, label: "profile id" });
      const resolved = await resolveProfileId(profileId);
      await callGatewayTool("providers.setDisabled", {}, { profileId: resolved, disabled: true });
      return jsonResult({ ok: true, profileId: resolved, disabled: true });
    }
    case "resume":
    case "enable": {
      const profileId = readStringParam(params, "value", { required: true, label: "profile id" });
      const resolved = await resolveProfileId(profileId);
      await callGatewayTool("providers.setDisabled", {}, { profileId: resolved, disabled: false });
      return jsonResult({ ok: true, profileId: resolved, disabled: false });
    }
    case "add": {
      const provider = readStringParam(params, "value", { required: true, label: "provider name" });
      const apiKey = typeof params.section === "string" ? params.section : "";
      if (!apiKey) {
        throw new ToolInputError("API key required: pass key via section param");
      }
      const profileId =
        typeof params.path === "string" ? params.path : `${provider.toLowerCase()}:default`;
      const res = await callGatewayTool(
        "providers.set",
        {},
        {
          provider: provider.toLowerCase(),
          type: "api_key",
          value: apiKey,
          profileId,
        },
      );
      return jsonResult(res);
    }
    case "delete":
    case "remove": {
      const profileId = readStringParam(params, "value", { required: true, label: "profile id" });
      const resolved = await resolveProfileId(profileId);
      await callGatewayTool("providers.delete", {}, { profileId: resolved });
      return jsonResult({ ok: true, deleted: resolved });
    }
    default:
      throw new ToolInputError(
        `Unknown providers sub-action: ${sub}. Valid: setup, list, get, pause, resume, enable, disable, add, delete`,
      );
  }
};

/**
 * Resolve a provider name or profileId to the actual profileId.
 * Allows "openai" to match "openai:default".
 * @param {string} input
 * @returns {Promise<string>}
 */
const resolveProfileId = async (input) => {
  if (input.includes(":")) {
    return input;
  }
  const res = await callGatewayTool("providers.list", {}, {});
  const profiles = res?.profiles ?? [];
  const match =
    profiles.find((p) => p.profileId === `${input}:default`) ??
    profiles.find((p) => p.provider === input);
  return match?.profileId ?? `${input}:default`;
};

/**
 * Handle "models" action — manage model selection and fallbacks conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleModels = async (params) => {
  const sub = (params.subAction ?? "list").toLowerCase();
  switch (sub) {
    case "list": {
      const onlyAvailable = params.path === "available" || params.path === "configured";
      const res = await callGatewayTool("models.list", {}, { onlyAvailable });
      const models = (res?.models ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        ...(m.discovered ? { discovered: true } : {}),
        ...(m.reasoning ? { reasoning: true } : {}),
      }));
      return jsonResult({ models, count: models.length });
    }
    case "current":
    case "get": {
      const primary = await handleGet({ path: "agents.defaults.model" });
      return primary;
    }
    case "set-default":
    case "default": {
      const model = readStringParam(params, "value", {
        required: true,
        label: "model id or alias",
      });
      return await handleSet({ path: "agents.defaults.model.primary", value: model });
    }
    case "add-fallback": {
      const model = readStringParam(params, "value", { required: true, label: "fallback model" });
      return await handleSet({ path: "agents.defaults.model.fallbacks", value: model });
    }
    case "remove-fallback": {
      const model = readStringParam(params, "value", { required: true, label: "fallback model" });
      return await handleRemove({ path: "agents.defaults.model.fallbacks", value: model });
    }
    case "aliases": {
      const cfg = loadConfig();
      const models = cfg?.agents?.defaults?.models ?? {};
      const aliases = Object.entries(models)
        .filter(([, v]) => typeof v === "string")
        .map(([alias, target]) => ({ alias, target }));
      return jsonResult({ aliases });
    }
    default:
      throw new ToolInputError(
        `Unknown models sub-action: ${sub}. Valid: list, current, set-default, add-fallback, remove-fallback, aliases`,
      );
  }
};

/**
 * Handle "tts" action — manage text-to-speech conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleTts = async (params) => {
  const sub = (params.subAction ?? "status").toLowerCase();
  switch (sub) {
    case "status": {
      const res = await callGatewayTool("tts.status", {}, {});
      return jsonResult(res);
    }
    case "enable": {
      await callGatewayTool("tts.enable", {}, {});
      return jsonResult({ ok: true, enabled: true });
    }
    case "disable": {
      await callGatewayTool("tts.disable", {}, {});
      return jsonResult({ ok: true, enabled: false });
    }
    case "provider":
    case "set-provider": {
      const provider = readStringParam(params, "value", { required: true, label: "TTS provider" });
      await callGatewayTool("tts.setProvider", {}, { provider });
      return jsonResult({ ok: true, provider });
    }
    case "providers":
    case "list": {
      const res = await callGatewayTool("tts.providers", {}, {});
      return jsonResult(res);
    }
    case "auto": {
      const mode = readStringParam(params, "value", { required: true, label: "auto mode" });
      return await handleSet({ path: "messages.tts.auto", value: mode });
    }
    case "voice": {
      const provider = typeof params.path === "string" ? params.path : undefined;
      const voice = readStringParam(params, "value", { required: true, label: "voice name" });
      const providerPath = provider ?? "kokoro";
      return await handleSet({ path: `messages.tts.${providerPath}.voice`, value: voice });
    }
    default:
      throw new ToolInputError(
        `Unknown tts sub-action: ${sub}. Valid: status, enable, disable, provider, providers, auto, voice`,
      );
  }
};

/**
 * Handle "memory" action — manage memory/search config conversationally.
 * @param {object} params
 * @returns {Promise<object>}
 */
const handleMemory = async (params) => {
  const sub = (params.subAction ?? "status").toLowerCase();
  switch (sub) {
    case "status": {
      const backend = await handleGet({ path: "memory.backend" });
      const sources = await handleGet({ path: "agents.defaults.memorySearch.sources" });
      const provider = await handleGet({ path: "agents.defaults.memorySearch.provider" });
      const hybrid = await handleGet({ path: "agents.defaults.memorySearch.query.hybrid.enabled" });
      return jsonResult({
        backend: backend?.result,
        sources: sources?.result,
        provider: provider?.result,
        hybrid: hybrid?.result,
      });
    }
    case "backend": {
      const value = readStringParam(params, "value", { required: true, label: "backend" });
      return await handleSet({ path: "memory.backend", value });
    }
    case "provider": {
      const value = readStringParam(params, "value", {
        required: true,
        label: "embedding provider",
      });
      return await handleSet({ path: "agents.defaults.memorySearch.provider", value });
    }
    case "sources": {
      const value = readStringParam(params, "value", { required: true, label: "source" });
      return await handleSet({ path: "agents.defaults.memorySearch.sources", value });
    }
    case "add-path": {
      const value = readStringParam(params, "value", { required: true, label: "extra path" });
      return await handleSet({ path: "agents.defaults.memorySearch.extraPaths", value });
    }
    case "remove-path": {
      const value = readStringParam(params, "value", { required: true, label: "extra path" });
      return await handleRemove({ path: "agents.defaults.memorySearch.extraPaths", value });
    }
    default:
      throw new ToolInputError(
        `Unknown memory sub-action: ${sub}. Valid: status, backend, provider, sources, add-path, remove-path`,
      );
  }
};

/**
 * Create the config_manage tool for conversational config advisory.
 * @returns {object}
 */
export function createConfigManageTool() {
  return {
    label: "Config",
    name: "config_manage",
    description: [
      "Read, describe, and modify GenosOS configuration.",
      "IMPORTANT: Before changing a value, always use 'describe' first to show current value, valid options, and trade-offs.",
      "",
      "Core operations: sections | view | get | set | remove | describe | status",
      "· set auto-appends scalars to arrays. To replace, pass the full array.",
      "· remove: delete element from array (String coercion: '123' matches 123).",
      "· String values that look like JSON arrays/objects are auto-parsed.",
      "",
      "SubActions by domain (default: status or list):",
      "· channels: status | probe | enable | disable | logout | overview | {channel}.setup | whatsapp.login | whatsapp.setup | nostr.profile",
      "· providers: setup | status | list | get | add | delete | pause | resume",
      "· models: list | current | set-default | add-fallback | remove-fallback | aliases",
      "· agents: setup | list | get | create | update | rename | delete",
      "· sessions: setup | list | get | patch | delete | reset | compact",
      "· tools: status | profile | allow | also-allow | deny | unallow | undeny | denybins | safebins | global",
      "· cron: board (use the dedicated cron tool for add/update/remove/run)",
      "· usage: summary | cost | sessions | chart (days via value)",
      "· tts: status | enable | disable | provider | providers | auto | voice",
      "· memory: status | backend | provider | sources | add-path | remove-path",
      "· skills: status | list | enable | disable | key | install",
      "· logs: view | tail (filter via value, search via path)",
      "· nodes: list | binding | unbind",
      "· devices: list | approve | reject | remove | rotate",
      "· approvals: get | policy | ask | auto-allow | allowlist.add | allowlist.remove (scope via path)",
      "· files: browse | list | get | set (agent id via path)",
      "· security: status | harden | audit (value=deep for deep probe)",
      "· webauthn: list | register | remove | rename",
      "· services: overview | voice | crm | payments | calendar | youtube | avatar (connected service guides)",
      "· apis: service API keys in env.vars (operational guide, no subActions)",
      "· gateway: operational guide (no subActions)",
      "· advanced: operational guide (no subActions)",
      "· doctor: full system health check — gateway, config, security, channels, workspace, auto-fixes (no subActions)",
      "· backup: state backups. sub_action: setup, create, list, verify (value=manifest path), restore (value=manifest path)",
      "",
      "Parameters:",
      "· action (required): domain from Capabilities catalog or core operation",
      "· subAction: operation within domain",
      "· path: identifier — agent id, channel name, config dot-path, scope",
      "· value: target — name, model id, true/false, number, JSON array",
      "· section: secondary value — emoji, API key, content body",
      "",
      "Key param patterns:",
      "· agents create: value=name, path=description, section=template (e.g. seo-specialist, security-guard, restaurant). Template applies profile+alsoAllow+deny+description atomically.",
      "· agents update: value=agentId, path=newName, section=newModel",
      "· agents rename: value=currentId, path=newId",
      "· agents delete: value=agentId (always removes agent + workspace)",
      "· providers add: value=providerName, section=apiKey, path=profileId",
      "· sessions patch: path=sessionKey, value={label?,model?,thinkingLevel?,verboseLevel?}",
      "· channels enable/disable: path=channelName",
      "· set/get/describe: path=dot.notation.path, value=newValue",
      "",
      "Notes:",
      "· files browse / logs view / cron board → opens browser overlay",
      "· {channel}.setup → returns conversational setup guide (except whatsapp.setup which opens overlay)",
      "· 'setup' subAction on agents/providers/sessions → loads operational guide",
      "· For any unknown path, use action='describe' with the path.",
    ].join("\n"),
    parameters: ConfigManageSchema,
    execute: async (_toolCallId, args) => {
      const action = readStringParam(args, "action", { required: true });

      switch (action) {
        case "sections":
          return handleSections();
        case "view":
          return handleView(args);
        case "get":
          return handleGet(args);
        case "set":
          return await handleSet(args);
        case "remove":
          return await handleRemove(args);
        case "describe":
          return await handleDescribe(args);
        case "status":
          return await handleStatus();
        case "webauthn":
          return await handleWebAuthn(args);
        case "channels":
          return await handleChannels(args);
        case "usage":
          return await handleUsage(args);
        case "tools":
          return await handleTools(args);
        case "sessions":
          return await handleSessions(args);
        case "cron":
          return await handleCron(args);
        case "logs":
          return await handleLogs(args);
        case "nodes":
          return await handleNodes(args);
        case "devices":
          return await handleDevices(args);
        case "approvals":
          return await handleApprovals(args);
        case "security":
          return await handleSecurity(args);
        case "doctor": {
          const { runDoctor } = await import("../../doctor/engine.js");
          const { resolveStateDir } = await import("../../config/paths.js");
          const cfg = loadConfig();
          const report = await runDoctor({ config: cfg, stateDir: resolveStateDir() });
          return jsonResult(report);
        }
        case "backup": {
          const { resolveStateDir } = await import("../../config/paths.js");
          const stateDir = resolveStateDir();
          const sub = readStringParam(args, "sub_action") ?? "create";
          if (sub === "setup") {
            const guide = await loadGuide("backup");
            if (!guide) {
              return jsonResult({ error: "No setup guide found for backup." });
            }
            return jsonResult({
              topic: "backup",
              guide,
              hint: "Follow the guide for when to create backups proactively.",
            });
          }
          if (sub === "create") {
            const { createBackup } = await import("../../backup/engine.js");
            return jsonResult(await createBackup({ stateDir }));
          }
          if (sub === "list") {
            const { listBackups } = await import("../../backup/engine.js");
            return jsonResult(await listBackups({ stateDir }));
          }
          if (sub === "verify") {
            const { verifyBackup } = await import("../../backup/engine.js");
            const manifestPath = readStringParam(args, "value", {
              required: true,
              label: "manifest path",
            });
            return jsonResult(await verifyBackup({ manifestPath, stateDir }));
          }
          if (sub === "restore") {
            const { restoreBackup } = await import("../../backup/engine.js");
            const manifestPath = readStringParam(args, "value", {
              required: true,
              label: "manifest path",
            });
            return jsonResult(await restoreBackup({ manifestPath, stateDir }));
          }
          throw new ToolInputError(`Unknown backup sub_action: ${sub}`);
        }
        case "files":
          return await handleFiles(args);
        case "skills":
          return await handleSkills(args);
        case "agents":
          return await handleAgents(args);
        case "providers":
          return await handleProviders(args);
        case "models":
          return await handleModels(args);
        case "tts":
          return await handleTts(args);
        case "memory":
          return await handleMemory(args);
        case "apis": {
          const guide = await loadGuide("apis");
          if (!guide) {
            return jsonResult({ error: "No guide found for apis." });
          }
          return jsonResult({
            topic: "apis",
            guide,
            hint: "Service API keys live in env.vars. Use config_manage get/set env.vars to manage them. NEVER store credentials in workspace files.",
          });
        }
        case "gateway": {
          const guide = await loadGuide("gateway");
          if (!guide) {
            return jsonResult({ error: "No setup guide found for gateway." });
          }
          return jsonResult({
            topic: "gateway",
            guide,
            hint: "IMPORTANT: Follow the guide for bind modes, TLS, authentication, and reload config. Use config_manage set/get to apply settings.",
          });
        }
        case "advanced": {
          const guide = await loadGuide("advanced");
          if (!guide) {
            return jsonResult({ error: "No setup guide found for advanced." });
          }
          return jsonResult({
            topic: "advanced",
            guide,
            hint: "Follow the guide for canvas, plugins, diagnostics, updates, and shell environment. Use config_manage set/get to apply settings.",
          });
        }
        case "services": {
          const sub = readStringParam(args, "subAction") ?? "overview";
          const guideMap = {
            voice: "voice-telephony-twilio",
            telephony: "voice-telephony-twilio",
            twilio: "voice-telephony-twilio",
            crm: "crm-hubspot",
            hubspot: "crm-hubspot",
            payments: "payments-stripe",
            stripe: "payments-stripe",
            calendar: "calendar-google",
            "google-calendar": "calendar-google",
            scheduling: "calendar-google",
            youtube: "youtube-api",
            "youtube-api": "youtube-api",
            video: "youtube-api",
            avatar: "avatar-heygen",
            heygen: "avatar-heygen",
            "avatar-heygen": "avatar-heygen",
          };
          const guideName = guideMap[sub];
          if (!guideName) {
            return jsonResult({
              topic: "services",
              available: ["voice", "crm", "payments", "calendar", "youtube", "avatar"],
              hint: "Use config_manage services {name} to load the setup guide for a connected service. Available: voice (Twilio), crm (HubSpot), payments (Stripe), calendar (Google Calendar), youtube (YouTube Data API), avatar (HeyGen).",
            });
          }
          const guide = await loadGuide(guideName);
          if (!guide) {
            return jsonResult({ error: `No setup guide found for service: ${sub}` });
          }
          return jsonResult({
            topic: `services/${sub}`,
            guide,
            hint: "IMPORTANT: Follow the guide step by step. Store credentials securely. Use web_fetch for API calls with Bearer token.",
          });
        }
        default:
          throw new ToolInputError(`Unknown config_manage action: ${action}`);
      }
    },
  };
}
