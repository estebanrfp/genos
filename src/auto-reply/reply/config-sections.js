/** @type {Array<{num: number, key: string, label: string, desc: string, paths: string[]}>} */
export const CONFIG_SECTIONS = [
  {
    num: 1,
    key: "providers",
    label: "Providers",
    desc: "AI model providers",
    paths: ["providers"],
  },
  { num: 2, key: "models", label: "Models", desc: "defaults, fallbacks", paths: ["models"] },
  {
    num: 3,
    key: "agents",
    label: "Agents",
    desc: "agent list, defaults, tools",
    paths: ["agents"],
  },
  {
    num: 4,
    key: "channels",
    label: "Channels",
    desc: "WhatsApp, Telegram, Discord...",
    paths: ["channels"],
  },
  {
    num: 5,
    key: "messages",
    label: "Messages",
    desc: "TTS, streaming, markdown",
    paths: ["messages", "audio"],
  },
  {
    num: 6,
    key: "session",
    label: "Session",
    desc: "session config, send policy",
    paths: ["session"],
  },
  { num: 7, key: "skills", label: "Skills", desc: "installed skills, limits", paths: ["skills"] },
  { num: 8, key: "cron", label: "Cron", desc: "scheduled jobs config", paths: ["cron"] },
  { num: 9, key: "memory", label: "Memory", desc: "memory backend, search", paths: ["memory"] },
  { num: 10, key: "browser", label: "Browser", desc: "CDP, profiles", paths: ["browser"] },
  { num: 11, key: "hooks", label: "Hooks", desc: "webhooks, mappings", paths: ["hooks"] },
  { num: 12, key: "gateway", label: "Gateway", desc: "port, bind, TLS, auth", paths: ["gateway"] },
  {
    num: 13,
    key: "advanced",
    label: "Advanced",
    desc: "env, logging, diagnostics, plugins",
    paths: [
      "env",
      "logging",
      "diagnostics",
      "update",
      "plugins",
      "discovery",
      "canvasHost",
      "talk",
      "ui",
      "web",
      "media",
      "bindings",
      "broadcast",
      "nodeHost",
      "commands",
      "approvals",
    ],
  },
];

const SENSITIVE_PATTERNS = /key|token|password|secret|credential/i;
const MAX_SECTION_NUM = CONFIG_SECTIONS.length;

/**
 * Build the numbered config menu shown by `/config`.
 * @param {object} cfg - Parsed config object
 * @returns {string}
 */
export function buildConfigMenu(cfg) {
  const pad = String(MAX_SECTION_NUM).length;
  const lines = CONFIG_SECTIONS.map(({ num, label, desc }) => {
    const n = String(num).padStart(pad, " ");
    const tag = getSectionTag(cfg, num);
    const tagStr = tag ? `  ${tag}` : "";
    return `  ${n}  ${label.padEnd(12)}— ${desc}${tagStr}`;
  });

  return [
    "\u2699\uFE0F GenosOS Config",
    "",
    ...lines,
    "",
    "  /config <N>          — view section",
    "  /config set <path>   — change value",
    "  /config show         — raw JSON",
  ].join("\n");
}

/**
 * Build a readable view for a single config section.
 * @param {object} cfg - Parsed config object
 * @param {number} sectionNum
 * @returns {string}
 */
export function buildSectionView(cfg, sectionNum) {
  const section = CONFIG_SECTIONS.find((s) => s.num === sectionNum);
  if (!section) {
    return `\u26A0\uFE0F Invalid section number (1-${MAX_SECTION_NUM}).`;
  }

  const entries = [];
  for (const path of section.paths) {
    const val = cfg[path];
    if (val === undefined || val === null) {
      continue;
    }
    flattenSection(val, path, entries);
  }

  if (entries.length === 0) {
    return `\u2699\uFE0F ${section.label}\n\n  (no configuration set)`;
  }

  const maxKey = Math.max(...entries.map(([k]) => k.length));
  const lines = entries.map(([k, v]) => `  ${k.padEnd(maxKey)}  ${v}`);

  return [
    `\u2699\uFE0F ${section.label}`,
    "",
    ...lines,
    "",
    `  /config set ${section.paths[0]}.<path> <value>`,
  ].join("\n");
}

/**
 * Validate a section number.
 * @param {number} num
 * @returns {boolean}
 */
export function isValidSectionNum(num) {
  return Number.isInteger(num) && num >= 1 && num <= MAX_SECTION_NUM;
}

// --- internal helpers ---

/**
 * Recursively flatten a config object into key-value pairs.
 * @param {*} obj
 * @param {string} prefix
 * @param {Array<[string, string]>} out
 */
function flattenSection(obj, prefix, out) {
  if (obj === undefined || obj === null) {
    return;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      out.push([prefix, "[]"]);
    } else if (obj.every((v) => typeof v !== "object" || v === null)) {
      out.push([prefix, `[${obj.map(formatLeaf).join(", ")}]`]);
    } else {
      out.push([prefix, `[${obj.length} items]`]);
    }
    return;
  }

  if (typeof obj === "object") {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      out.push([prefix, "{}"]);
      return;
    }
    for (const key of keys) {
      flattenSection(obj[key], `${prefix}.${key}`, out);
    }
    return;
  }

  out.push([prefix, formatLeaf(obj, prefix)]);
}

/**
 * Format a scalar config value, masking sensitive fields.
 * @param {*} val
 * @param {string} [path]
 * @returns {string}
 */
function formatLeaf(val, path) {
  if (val === undefined || val === null) {
    return "null";
  }
  if (typeof val === "boolean") {
    return String(val);
  }
  if (typeof val === "number") {
    return String(val);
  }
  if (typeof val === "string") {
    if (path && SENSITIVE_PATTERNS.test(path) && val.length > 6) {
      return `${val.slice(0, 6)}***`;
    }
    return val;
  }
  return String(val);
}

/**
 * Optional status tag for each section in the menu.
 * @param {object} cfg
 * @param {number} num
 * @returns {string|null}
 */
function getSectionTag(cfg, num) {
  switch (num) {
    case 1: {
      const providers = cfg.providers;
      if (!providers) {
        return null;
      }
      const count = Object.keys(providers).length;
      return count > 0 ? `[${count}]` : null;
    }
    case 3: {
      const list = cfg.agents?.list;
      if (!list) {
        return null;
      }
      const count = Object.keys(list).length;
      return count > 0 ? `[${count}]` : null;
    }
    case 4: {
      const channels = cfg.channels;
      if (!channels) {
        return null;
      }
      const count = Object.keys(channels).filter((k) => typeof channels[k] === "object").length;
      return count > 0 ? `[${count}]` : null;
    }
    default:
      return null;
  }
}
