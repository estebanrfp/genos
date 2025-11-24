let isWhitelistedSensitivePath = function (path) {
    const lowerPath = path.toLowerCase();
    return NORMALIZED_SENSITIVE_KEY_WHITELIST_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix));
  },
  matchesSensitivePattern = function (path) {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(path));
  },
  isUnwrappable = function (object) {
    return (
      !!object &&
      typeof object === "object" &&
      "unwrap" in object &&
      typeof object.unwrap === "function" &&
      !(object instanceof z.ZodArray)
    );
  };
import { z } from "zod";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { FIELD_HELP } from "./schema.help.js";
import { FIELD_LABELS } from "./schema.labels.js";
import { sensitive } from "./zod-schema.sensitive.js";
const log = createSubsystemLogger("config/schema");
const GROUP_LABELS = {
  wizard: "Wizard",
  update: "Update",
  diagnostics: "Diagnostics",
  logging: "Logging",
  gateway: "Gateway",
  nodeHost: "Node Host",
  agents: "Agents",
  tools: "Tools",
  bindings: "Bindings",
  audio: "Audio",
  models: "Models",
  messages: "Messages",
  commands: "Commands",
  session: "Session",
  cron: "Cron",
  hooks: "Hooks",
  ui: "UI",
  browser: "Browser",
  talk: "Talk",
  channels: "Messaging Channels",
  skills: "Skills",
  plugins: "Plugins",
  discovery: "Discovery",
  presence: "Presence",
  voicewake: "Voice Wake",
};
const GROUP_ORDER = {
  wizard: 20,
  update: 25,
  diagnostics: 27,
  gateway: 30,
  nodeHost: 35,
  agents: 40,
  tools: 50,
  bindings: 55,
  audio: 60,
  models: 70,
  messages: 80,
  commands: 85,
  session: 90,
  cron: 100,
  hooks: 110,
  ui: 120,
  browser: 130,
  talk: 140,
  channels: 150,
  skills: 200,
  plugins: 205,
  discovery: 210,
  presence: 220,
  voicewake: 230,
  logging: 900,
};
const FIELD_PLACEHOLDERS = {
  "gateway.remote.url": "ws://host:18789",
  "gateway.remote.tlsFingerprint": "sha256:ab12cd34\u2026",
  "gateway.remote.sshTarget": "user@host",
  "gateway.controlUi.basePath": "/genosos",
  "gateway.controlUi.root": "dist/control-ui",
  "gateway.controlUi.allowedOrigins": "https://control.example.com",
  "channels.mattermost.baseUrl": "https://chat.example.com",
  "agents.list[].identity.avatar": "avatars/genosos.png",
};
const SENSITIVE_KEY_WHITELIST_SUFFIXES = [
  "maxtokens",
  "maxoutputtokens",
  "maxinputtokens",
  "maxcompletiontokens",
  "contexttokens",
  "totaltokens",
  "tokencount",
  "tokenlimit",
  "tokenbudget",
  "passwordFile",
];
const NORMALIZED_SENSITIVE_KEY_WHITELIST_SUFFIXES = SENSITIVE_KEY_WHITELIST_SUFFIXES.map((suffix) =>
  suffix.toLowerCase(),
);
const SENSITIVE_PATTERNS = [
  /token$/i,
  /password/i,
  /secret/i,
  /api.?key/i,
  /credentials\b.*\.(key|token|secret)$/i,
];
export function isSensitiveConfigPath(path) {
  return !isWhitelistedSensitivePath(path) && matchesSensitivePattern(path);
}
export function buildBaseHints() {
  const hints = {};
  for (const [group, label] of Object.entries(GROUP_LABELS)) {
    hints[group] = {
      label,
      group: label,
      order: GROUP_ORDER[group],
    };
  }
  for (const [path, label] of Object.entries(FIELD_LABELS)) {
    const current = hints[path];
    hints[path] = current ? { ...current, label } : { label };
  }
  for (const [path, help] of Object.entries(FIELD_HELP)) {
    const current = hints[path];
    hints[path] = current ? { ...current, help } : { help };
  }
  for (const [path, placeholder] of Object.entries(FIELD_PLACEHOLDERS)) {
    const current = hints[path];
    hints[path] = current ? { ...current, placeholder } : { placeholder };
  }
  // env section: rename map blocks and suppress the legacy root-level catchall
  hints["env.vars"] = {
    ...hints["env.vars"],
    mapLabel: "Custom Variables",
    addLabel: "Add Variable",
    emptyLabel: "No variables defined.",
  };
  hints["env"] = { ...hints["env"], hideCatchall: true };
  return hints;
}
export function applySensitiveHints(hints, allowedKeys) {
  const next = { ...hints };
  for (const key of Object.keys(next)) {
    if (allowedKeys && !allowedKeys.has(key)) {
      continue;
    }
    if (next[key]?.sensitive !== undefined) {
      continue;
    }
    if (isSensitiveConfigPath(key)) {
      next[key] = { ...next[key], sensitive: true };
    }
  }
  return next;
}
export function mapSensitivePaths(schema, path, hints) {
  let next = { ...hints };
  let currentSchema = schema;
  let isSensitive = sensitive.has(currentSchema);
  while (isUnwrappable(currentSchema)) {
    currentSchema = currentSchema.unwrap();
    isSensitive ||= sensitive.has(currentSchema);
  }
  if (isSensitive) {
    next[path] = { ...next[path], sensitive: true };
  } else if (isSensitiveConfigPath(path) && !next[path]?.sensitive) {
    log.warn(`possibly sensitive key found: (${path})`);
  }
  if (currentSchema instanceof z.ZodObject) {
    const shape = currentSchema.shape;
    for (const key in shape) {
      const nextPath = path ? `${path}.${key}` : key;
      next = mapSensitivePaths(shape[key], nextPath, next);
    }
  } else if (currentSchema instanceof z.ZodArray) {
    const nextPath = path ? `${path}[]` : "[]";
    next = mapSensitivePaths(currentSchema.element, nextPath, next);
  } else if (currentSchema instanceof z.ZodRecord) {
    const nextPath = path ? `${path}.*` : "*";
    next = mapSensitivePaths(currentSchema._def.valueType, nextPath, next);
  } else if (
    currentSchema instanceof z.ZodUnion ||
    currentSchema instanceof z.ZodDiscriminatedUnion
  ) {
    for (const option of currentSchema.options) {
      next = mapSensitivePaths(option, path, next);
    }
  } else if (currentSchema instanceof z.ZodIntersection) {
    next = mapSensitivePaths(currentSchema._def.left, path, next);
    next = mapSensitivePaths(currentSchema._def.right, path, next);
  }
  return next;
}
export const __test__ = {
  mapSensitivePaths,
};
