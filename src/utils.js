let resolveLidMappingDirs = function (opts) {
    const dirs = new Set();
    const addDir = (dir) => {
      if (!dir) {
        return;
      }
      dirs.add(resolveUserPath(dir));
    };
    addDir(opts?.authDir);
    for (const dir of opts?.lidMappingDirs ?? []) {
      addDir(dir);
    }
    addDir(resolveOAuthDir());
    addDir(path.join(CONFIG_DIR, "credentials"));
    return [...dirs];
  },
  readLidReverseMapping = function (lid, opts) {
    const mappingFilename = `lid-mapping-${lid}_reverse.json`;
    const mappingDirs = resolveLidMappingDirs(opts);
    for (const dir of mappingDirs) {
      const mappingPath = path.join(dir, mappingFilename);
      try {
        const data = secureReadFileSync(mappingPath);
        const phone = JSON.parse(data);
        if (phone === null || phone === undefined) {
          continue;
        }
        return normalizeE164(String(phone));
      } catch {}
    }
    return null;
  },
  isHighSurrogate = function (codeUnit) {
    return codeUnit >= 55296 && codeUnit <= 56319;
  },
  isLowSurrogate = function (codeUnit) {
    return codeUnit >= 56320 && codeUnit <= 57343;
  },
  resolveHomeDisplayPrefix = function () {
    const home = resolveHomeDir();
    if (!home) {
      return;
    }
    const explicitHome = process.env.GENOS_HOME?.trim();
    if (explicitHome) {
      return { home, prefix: "$GENOS_HOME" };
    }
    return { home, prefix: "~" };
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOAuthDir } from "./config/paths.js";
import { logVerbose, shouldLogVerbose } from "./globals.js";
import {
  expandHomePrefix,
  resolveEffectiveHomeDir,
  resolveRequiredHomeDir,
} from "./infra/home-dir.js";
import { secureReadFileSync } from "./infra/secure-io.js";
export async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}
export async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
export function clampInt(value, min, max) {
  return clampNumber(Math.floor(value), min, max);
}
export const clamp = clampNumber;
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function assertWebChannel(input) {
  if (input !== "web") {
    throw new Error("Web channel must be 'web'");
  }
}
export function normalizePath(p) {
  if (!p.startsWith("/")) {
    return `/${p}`;
  }
  return p;
}
export function withWhatsAppPrefix(number) {
  return number.startsWith("whatsapp:") ? number : `whatsapp:${number}`;
}
export function normalizeE164(number) {
  const withoutPrefix = number.replace(/^whatsapp:/, "").trim();
  const digits = withoutPrefix.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return `+${digits.slice(1)}`;
  }
  return `+${digits}`;
}
export function isSelfChatMode(selfE164, allowFrom) {
  if (!selfE164) {
    return false;
  }
  if (!Array.isArray(allowFrom) || allowFrom.length === 0) {
    return false;
  }
  const normalizedSelf = normalizeE164(selfE164);
  return allowFrom.some((n) => {
    if (n === "*") {
      return false;
    }
    try {
      return normalizeE164(String(n)) === normalizedSelf;
    } catch {
      return false;
    }
  });
}
export function toWhatsappJid(number) {
  const withoutPrefix = number.replace(/^whatsapp:/, "").trim();
  if (withoutPrefix.includes("@")) {
    return withoutPrefix;
  }
  const e164 = normalizeE164(withoutPrefix);
  const digits = e164.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}
export function jidToE164(jid, opts) {
  const match = jid.match(/^(\d+)(?::\d+)?@(s\.whatsapp\.net|hosted)$/);
  if (match) {
    const digits = match[1];
    return `+${digits}`;
  }
  const lidMatch = jid.match(/^(\d+)(?::\d+)?@(lid|hosted\.lid)$/);
  if (lidMatch) {
    const lid = lidMatch[1];
    const phone = readLidReverseMapping(lid, opts);
    if (phone) {
      return phone;
    }
    const shouldLog = opts?.logMissing ?? shouldLogVerbose();
    if (shouldLog) {
      logVerbose(`LID mapping not found for ${lid}; skipping inbound message`);
    }
  }
  return null;
}
export async function resolveJidToE164(jid, opts) {
  if (!jid) {
    return null;
  }
  const direct = jidToE164(jid, opts);
  if (direct) {
    return direct;
  }
  if (!/(@lid|@hosted\.lid)$/.test(jid)) {
    return null;
  }
  if (!opts?.lidLookup?.getPNForLID) {
    return null;
  }
  try {
    const pnJid = await opts.lidLookup.getPNForLID(jid);
    if (!pnJid) {
      return null;
    }
    return jidToE164(pnJid, opts);
  } catch (err) {
    if (shouldLogVerbose()) {
      logVerbose(`LID mapping lookup failed for ${jid}: ${String(err)}`);
    }
    return null;
  }
}
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function sliceUtf16Safe(input, start, end) {
  const len = input.length;
  let from = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
  let to = end === undefined ? len : end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
  if (to < from) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  if (from > 0 && from < len) {
    const codeUnit = input.charCodeAt(from);
    if (isLowSurrogate(codeUnit) && isHighSurrogate(input.charCodeAt(from - 1))) {
      from += 1;
    }
  }
  if (to > 0 && to < len) {
    const codeUnit = input.charCodeAt(to - 1);
    if (isHighSurrogate(codeUnit) && isLowSurrogate(input.charCodeAt(to))) {
      to -= 1;
    }
  }
  return input.slice(from, to);
}
export function truncateUtf16Safe(input, maxLen) {
  const limit = Math.max(0, Math.floor(maxLen));
  if (input.length <= limit) {
    return input;
  }
  return sliceUtf16Safe(input, 0, limit);
}
export function resolveUserPath(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("~")) {
    const expanded = expandHomePrefix(trimmed, {
      home: resolveRequiredHomeDir(process.env, os.homedir),
      env: process.env,
      homedir: os.homedir,
    });
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}
export function resolveConfigDir(env = process.env, homedir = os.homedir) {
  const override = env.GENOS_STATE_DIR?.trim() || env.GENOS_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath(override);
  }
  const newDir = path.join(resolveRequiredHomeDir(env, homedir), ".genosv1");
  try {
    const hasNew = fs.existsSync(newDir);
    if (hasNew) {
      return newDir;
    }
  } catch {}
  return newDir;
}
export function resolveHomeDir() {
  return resolveEffectiveHomeDir(process.env, os.homedir);
}
export function shortenHomePath(input) {
  if (!input) {
    return input;
  }
  const display = resolveHomeDisplayPrefix();
  if (!display) {
    return input;
  }
  const { home, prefix } = display;
  if (input === home) {
    return prefix;
  }
  if (input.startsWith(`${home}/`) || input.startsWith(`${home}\\`)) {
    return `${prefix}${input.slice(home.length)}`;
  }
  return input;
}
export function shortenHomeInString(input) {
  if (!input) {
    return input;
  }
  const display = resolveHomeDisplayPrefix();
  if (!display) {
    return input;
  }
  return input.split(display.home).join(display.prefix);
}
export function displayPath(input) {
  return shortenHomePath(input);
}
export function displayString(input) {
  return shortenHomeInString(input);
}
export function formatTerminalLink(label, url, opts) {
  const esc = "\x1B";
  const safeLabel = label.replaceAll(esc, "");
  const safeUrl = url.replaceAll(esc, "");
  const allow =
    opts?.force === true ? true : opts?.force === false ? false : Boolean(process.stdout.isTTY);
  if (!allow) {
    return opts?.fallback ?? `${safeLabel} (${safeUrl})`;
  }
  return `\x1B]8;;${safeUrl}\x07${safeLabel}\x1B]8;;\x07`;
}
export const CONFIG_DIR = resolveConfigDir();
