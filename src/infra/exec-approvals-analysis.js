let isExecutableFile = function (filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return false;
      }
      if (process.platform !== "win32") {
        fs.accessSync(filePath, fs.constants.X_OK);
      }
      return true;
    } catch {
      return false;
    }
  },
  parseFirstToken = function (command) {
    const trimmed = command.trim();
    if (!trimmed) {
      return null;
    }
    const first = trimmed[0];
    if (first === '"' || first === "'") {
      const end = trimmed.indexOf(first, 1);
      if (end > 1) {
        return trimmed.slice(1, end);
      }
      return trimmed.slice(1);
    }
    const match = /^[^\s]+/.exec(trimmed);
    return match ? match[0] : null;
  },
  resolveExecutablePath = function (rawExecutable, cwd, env) {
    const expanded = rawExecutable.startsWith("~")
      ? expandHomePrefix(rawExecutable)
      : rawExecutable;
    if (expanded.includes("/") || expanded.includes("\\")) {
      if (path.isAbsolute(expanded)) {
        return isExecutableFile(expanded) ? expanded : undefined;
      }
      const base = cwd && cwd.trim() ? cwd.trim() : process.cwd();
      const candidate = path.resolve(base, expanded);
      return isExecutableFile(candidate) ? candidate : undefined;
    }
    const envPath = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? "";
    const entries = envPath.split(path.delimiter).filter(Boolean);
    const hasExtension = process.platform === "win32" && path.extname(expanded).length > 0;
    const extensions =
      process.platform === "win32"
        ? hasExtension
          ? [""]
          : (
              env?.PATHEXT ??
              env?.Pathext ??
              process.env.PATHEXT ??
              process.env.Pathext ??
              ".EXE;.CMD;.BAT;.COM"
            )
              .split(";")
              .map((ext) => ext.toLowerCase())
        : [""];
    for (const entry of entries) {
      for (const ext of extensions) {
        const candidate = path.join(entry, expanded + ext);
        if (isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }
    return;
  },
  normalizeMatchTarget = function (value) {
    if (process.platform === "win32") {
      const stripped = value.replace(/^\\\\[?.]\\/, "");
      return stripped.replace(/\\/g, "/").toLowerCase();
    }
    return value.replace(/\\\\/g, "/").toLowerCase();
  },
  tryRealpath = function (value) {
    try {
      return fs.realpathSync(value);
    } catch {
      return null;
    }
  },
  globToRegExp = function (pattern) {
    let regex = "^";
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === "*") {
        const next = pattern[i + 1];
        if (next === "*") {
          regex += ".*";
          i += 2;
          continue;
        }
        regex += "[^/]*";
        i += 1;
        continue;
      }
      if (ch === "?") {
        regex += ".";
        i += 1;
        continue;
      }
      regex += ch.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
      i += 1;
    }
    regex += "$";
    return new RegExp(regex, "i");
  },
  matchesPattern = function (pattern, target) {
    const trimmed = pattern.trim();
    if (!trimmed) {
      return false;
    }
    const expanded = trimmed.startsWith("~") ? expandHomePrefix(trimmed) : trimmed;
    const hasWildcard = /[*?]/.test(expanded);
    let normalizedPattern = expanded;
    let normalizedTarget = target;
    if (process.platform === "win32" && !hasWildcard) {
      normalizedPattern = tryRealpath(expanded) ?? expanded;
      normalizedTarget = tryRealpath(target) ?? target;
    }
    normalizedPattern = normalizeMatchTarget(normalizedPattern);
    normalizedTarget = normalizeMatchTarget(normalizedTarget);
    const regex = globToRegExp(normalizedPattern);
    return regex.test(normalizedTarget);
  },
  isDoubleQuoteEscape = function (next) {
    return Boolean(next && DOUBLE_QUOTE_ESCAPES.has(next));
  },
  splitShellPipeline = function (command) {
    const parseHeredocDelimiter = (source, start) => {
      let i = start;
      while (i < source.length && (source[i] === " " || source[i] === "\t")) {
        i += 1;
      }
      if (i >= source.length) {
        return null;
      }
      const first = source[i];
      if (first === "'" || first === '"') {
        const quote = first;
        i += 1;
        let delimiter = "";
        while (i < source.length) {
          const ch = source[i];
          if (ch === "\n" || ch === "\r") {
            return null;
          }
          if (quote === '"' && ch === "\\" && i + 1 < source.length) {
            delimiter += source[i + 1];
            i += 2;
            continue;
          }
          if (ch === quote) {
            return { delimiter, end: i + 1 };
          }
          delimiter += ch;
          i += 1;
        }
        return null;
      }
      let delimiter = "";
      while (i < source.length) {
        const ch = source[i];
        if (/\s/.test(ch) || ch === "|" || ch === "&" || ch === ";" || ch === "<" || ch === ">") {
          break;
        }
        delimiter += ch;
        i += 1;
      }
      if (!delimiter) {
        return null;
      }
      return { delimiter, end: i };
    };
    const segments = [];
    let buf = "";
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    let emptySegment = false;
    const pendingHeredocs = [];
    let inHeredocBody = false;
    let heredocLine = "";
    const pushPart = () => {
      const trimmed = buf.trim();
      if (trimmed) {
        segments.push(trimmed);
      }
      buf = "";
    };
    for (let i = 0; i < command.length; i += 1) {
      const ch = command[i];
      const next = command[i + 1];
      if (inHeredocBody) {
        if (ch === "\n" || ch === "\r") {
          const current = pendingHeredocs[0];
          if (current) {
            const line = current.stripTabs ? heredocLine.replace(/^\t+/, "") : heredocLine;
            if (line === current.delimiter) {
              pendingHeredocs.shift();
            }
          }
          heredocLine = "";
          if (pendingHeredocs.length === 0) {
            inHeredocBody = false;
          }
          if (ch === "\r" && next === "\n") {
            i += 1;
          }
        } else {
          heredocLine += ch;
        }
        continue;
      }
      if (escaped) {
        buf += ch;
        escaped = false;
        emptySegment = false;
        continue;
      }
      if (!inSingle && !inDouble && ch === "\\") {
        escaped = true;
        buf += ch;
        emptySegment = false;
        continue;
      }
      if (inSingle) {
        if (ch === "'") {
          inSingle = false;
        }
        buf += ch;
        emptySegment = false;
        continue;
      }
      if (inDouble) {
        if (ch === "\\" && isDoubleQuoteEscape(next)) {
          buf += ch;
          buf += next;
          i += 1;
          emptySegment = false;
          continue;
        }
        if (ch === "$" && next === "(") {
          return { ok: false, reason: "unsupported shell token: $()", segments: [] };
        }
        if (ch === "`") {
          return { ok: false, reason: "unsupported shell token: `", segments: [] };
        }
        if (ch === "\n" || ch === "\r") {
          return { ok: false, reason: "unsupported shell token: newline", segments: [] };
        }
        if (ch === '"') {
          inDouble = false;
        }
        buf += ch;
        emptySegment = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        buf += ch;
        emptySegment = false;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        buf += ch;
        emptySegment = false;
        continue;
      }
      if ((ch === "\n" || ch === "\r") && pendingHeredocs.length > 0) {
        inHeredocBody = true;
        heredocLine = "";
        if (ch === "\r" && next === "\n") {
          i += 1;
        }
        continue;
      }
      if (ch === "|" && next === "|") {
        return { ok: false, reason: "unsupported shell token: ||", segments: [] };
      }
      if (ch === "|" && next === "&") {
        return { ok: false, reason: "unsupported shell token: |&", segments: [] };
      }
      if (ch === "|") {
        emptySegment = true;
        pushPart();
        continue;
      }
      if (ch === "&" || ch === ";") {
        return { ok: false, reason: `unsupported shell token: ${ch}`, segments: [] };
      }
      if (ch === "<" && next === "<") {
        buf += "<<";
        emptySegment = false;
        i += 1;
        let scanIndex = i + 1;
        let stripTabs = false;
        if (command[scanIndex] === "-") {
          stripTabs = true;
          buf += "-";
          scanIndex += 1;
        }
        const parsed = parseHeredocDelimiter(command, scanIndex);
        if (parsed) {
          pendingHeredocs.push({ delimiter: parsed.delimiter, stripTabs });
          buf += command.slice(scanIndex, parsed.end);
          i = parsed.end - 1;
        }
        continue;
      }
      if (DISALLOWED_PIPELINE_TOKENS.has(ch)) {
        return { ok: false, reason: `unsupported shell token: ${ch}`, segments: [] };
      }
      if (ch === "$" && next === "(") {
        return { ok: false, reason: "unsupported shell token: $()", segments: [] };
      }
      buf += ch;
      emptySegment = false;
    }
    if (inHeredocBody && pendingHeredocs.length > 0) {
      const current = pendingHeredocs[0];
      const line = current.stripTabs ? heredocLine.replace(/^\t+/, "") : heredocLine;
      if (line === current.delimiter) {
        pendingHeredocs.shift();
      }
    }
    if (escaped || inSingle || inDouble) {
      return { ok: false, reason: "unterminated shell quote/escape", segments: [] };
    }
    pushPart();
    if (emptySegment || segments.length === 0) {
      return {
        ok: false,
        reason: segments.length === 0 ? "empty command" : "empty pipeline segment",
        segments: [],
      };
    }
    return { ok: true, segments };
  },
  findWindowsUnsupportedToken = function (command) {
    for (const ch of command) {
      if (WINDOWS_UNSUPPORTED_TOKENS.has(ch)) {
        if (ch === "\n" || ch === "\r") {
          return "newline";
        }
        return ch;
      }
    }
    return null;
  },
  tokenizeWindowsSegment = function (segment) {
    const tokens = [];
    let buf = "";
    let inDouble = false;
    const pushToken = () => {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = "";
      }
    };
    for (let i = 0; i < segment.length; i += 1) {
      const ch = segment[i];
      if (ch === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inDouble && /\s/.test(ch)) {
        pushToken();
        continue;
      }
      buf += ch;
    }
    if (inDouble) {
      return null;
    }
    pushToken();
    return tokens.length > 0 ? tokens : null;
  },
  analyzeWindowsShellCommand = function (params) {
    const unsupported = findWindowsUnsupportedToken(params.command);
    if (unsupported) {
      return {
        ok: false,
        reason: `unsupported windows shell token: ${unsupported}`,
        segments: [],
      };
    }
    const argv = tokenizeWindowsSegment(params.command);
    if (!argv || argv.length === 0) {
      return { ok: false, reason: "unable to parse windows command", segments: [] };
    }
    return {
      ok: true,
      segments: [
        {
          raw: params.command,
          argv,
          resolution: resolveCommandResolutionFromArgv(argv, params.cwd, params.env),
        },
      ],
    };
  },
  parseSegmentsFromParts = function (parts, cwd, env) {
    const segments = [];
    for (const raw of parts) {
      const argv = splitShellArgs(raw);
      if (!argv || argv.length === 0) {
        return null;
      }
      segments.push({
        raw,
        argv,
        resolution: resolveCommandResolutionFromArgv(argv, cwd, env),
      });
    }
    return segments;
  },
  shellEscapeSingleArg = function (value) {
    const singleQuoteEscape = `'"'"'`;
    return `'${value.replace(/'/g, singleQuoteEscape)}'`;
  },
  renderQuotedArgv = function (argv) {
    return argv.map((token) => shellEscapeSingleArg(token)).join(" ");
  };
import fs from "node:fs";
import path from "node:path";
import { splitShellArgs } from "../utils/shell-argv.js";
import { expandHomePrefix } from "./home-dir.js";
/**
 * Default deny list — these binaries are blocked by default.
 * Configurable via `tools.exec.denyBins` or per-agent `agents.list[].tools.exec.denyBins`.
 * When no custom denyBins is set, this list is used as the default.
 */
export const DEFAULT_DENY_BINS = new Set([
  "security", // macOS Keychain access
  "sudo",
  "su",
  "doas", // privilege escalation
  "rm", // destructive delete (use trash instead)
  "ssh",
  "scp",
  "rsync",
  "sftp", // remote access
  "open", // arbitrary app/URL launch
  "defaults", // macOS system defaults
  "networksetup", // macOS network configuration
  "scutil", // macOS system configuration
  "launchctl", // macOS service management
  "diskutil", // macOS disk management
]);

/**
 * Check if a shell command contains any denied binary from the given set.
 * @param {string} command - raw shell command
 * @param {Set<string>} denySet - set of lowercase binary names to deny
 * @returns {{ denied: boolean, bin?: string }}
 */
export function checkDenyBins(command, denySet) {
  const parts = splitCommandChain(command) ?? [command];
  for (const part of parts) {
    const pipeParts = splitShellPipeline(part);
    const segments = pipeParts?.segments?.length > 0 ? pipeParts.segments : [part];
    for (const seg of segments) {
      const token = parseFirstToken(seg.trim());
      if (!token) {
        continue;
      }
      const bin = path.basename(token).toLowerCase();
      if (denySet.has(bin)) {
        return { denied: true, bin };
      }
    }
  }
  return { denied: false };
}

/**
 * Default safeBins allowlist — ONLY these binaries can auto-approve in stdin-only mode.
 * Prevent prompt injection attacks from accessing system credentials or destructive commands.
 * Explicitly blocked (never add): see DEFAULT_DENY_BINS above.
 */
export const DEFAULT_SAFE_BINS = [
  // Runtime & tools
  "bun",
  "git",
  "curl",
  // Text processing (stdin-only)
  "cat",
  "ls",
  "find",
  "grep",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "diff",
  "awk",
  "sed",
  "tr",
  // File operations (safe subset — no rm)
  "cp",
  "mv",
  "mkdir",
  "chmod",
  "touch",
  "basename",
  "dirname",
  "realpath",
  // Shell builtins & utilities
  "echo",
  "date",
  "sleep",
  "true",
  "false",
  "test",
  "env",
  "which",
  // Languages
  "python3",
  // macOS automation
  "osascript",
  // Safe delete (moves to trash instead of permanent delete)
  "trash",
  // Media processing
  "ffmpeg",
  "ffprobe",
  // AI assistant
  "claude",
  // GenosOS self
  "genosos",
];
export function resolveCommandResolution(command, cwd, env) {
  const rawExecutable = parseFirstToken(command);
  if (!rawExecutable) {
    return null;
  }
  const resolvedPath = resolveExecutablePath(rawExecutable, cwd, env);
  const executableName = resolvedPath ? path.basename(resolvedPath) : rawExecutable;
  return { rawExecutable, resolvedPath, executableName };
}
export function resolveCommandResolutionFromArgv(argv, cwd, env) {
  const rawExecutable = argv[0]?.trim();
  if (!rawExecutable) {
    return null;
  }
  const resolvedPath = resolveExecutablePath(rawExecutable, cwd, env);
  const executableName = resolvedPath ? path.basename(resolvedPath) : rawExecutable;
  return { rawExecutable, resolvedPath, executableName };
}
export function resolveAllowlistCandidatePath(resolution, cwd) {
  if (!resolution) {
    return;
  }
  if (resolution.resolvedPath) {
    return resolution.resolvedPath;
  }
  const raw = resolution.rawExecutable?.trim();
  if (!raw) {
    return;
  }
  const expanded = raw.startsWith("~") ? expandHomePrefix(raw) : raw;
  if (!expanded.includes("/") && !expanded.includes("\\")) {
    return;
  }
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  const base = cwd && cwd.trim() ? cwd.trim() : process.cwd();
  return path.resolve(base, expanded);
}
export function matchAllowlist(entries, resolution) {
  if (!entries.length || !resolution?.resolvedPath) {
    return null;
  }
  const resolvedPath = resolution.resolvedPath;
  for (const entry of entries) {
    const pattern = entry.pattern?.trim();
    if (!pattern) {
      continue;
    }
    const hasPath = pattern.includes("/") || pattern.includes("\\") || pattern.includes("~");
    if (!hasPath) {
      continue;
    }
    if (matchesPattern(pattern, resolvedPath)) {
      return entry;
    }
  }
  return null;
}
const DISALLOWED_PIPELINE_TOKENS = new Set([">", "<", "`", "\n", "\r", "(", ")"]);
const DOUBLE_QUOTE_ESCAPES = new Set(["\\", '"', "$", "`", "\n", "\r"]);
const WINDOWS_UNSUPPORTED_TOKENS = new Set([
  "&",
  "|",
  "<",
  ">",
  "^",
  "(",
  ")",
  "%",
  "!",
  "\n",
  "\r",
]);
export function isWindowsPlatform(platform) {
  const normalized = String(platform ?? "")
    .trim()
    .toLowerCase();
  return normalized.startsWith("win");
}
export function splitCommandChainWithOperators(command) {
  const parts = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let foundChain = false;
  let invalidChain = false;
  const pushPart = (opToNext) => {
    const trimmed = buf.trim();
    buf = "";
    if (!trimmed) {
      return false;
    }
    parts.push({ part: trimmed, opToNext });
    return true;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (!inSingle && !inDouble && ch === "\\") {
      escaped = true;
      buf += ch;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      buf += ch;
      continue;
    }
    if (inDouble) {
      if (ch === "\\" && isDoubleQuoteEscape(next)) {
        buf += ch;
        buf += next;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      buf += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }
    if (ch === "&" && next === "&") {
      if (!pushPart("&&")) {
        invalidChain = true;
      }
      i += 1;
      foundChain = true;
      continue;
    }
    if (ch === "|" && next === "|") {
      if (!pushPart("||")) {
        invalidChain = true;
      }
      i += 1;
      foundChain = true;
      continue;
    }
    if (ch === ";") {
      if (!pushPart(";")) {
        invalidChain = true;
      }
      foundChain = true;
      continue;
    }
    buf += ch;
  }
  if (!foundChain) {
    return null;
  }
  const trimmed = buf.trim();
  if (!trimmed) {
    return null;
  }
  parts.push({ part: trimmed, opToNext: null });
  if (invalidChain || parts.length === 0) {
    return null;
  }
  return parts;
}
export function buildSafeShellCommand(params) {
  const platform = params.platform ?? null;
  if (isWindowsPlatform(platform)) {
    return { ok: false, reason: "unsupported platform" };
  }
  const source = params.command.trim();
  if (!source) {
    return { ok: false, reason: "empty command" };
  }
  const chain = splitCommandChainWithOperators(source);
  const chainParts = chain ?? [{ part: source, opToNext: null }];
  let out = "";
  for (let i = 0; i < chainParts.length; i += 1) {
    const part = chainParts[i];
    const pipelineSplit = splitShellPipeline(part.part);
    if (!pipelineSplit.ok) {
      return { ok: false, reason: pipelineSplit.reason ?? "unable to parse pipeline" };
    }
    const renderedSegments = [];
    for (const segmentRaw of pipelineSplit.segments) {
      const argv = splitShellArgs(segmentRaw);
      if (!argv || argv.length === 0) {
        return { ok: false, reason: "unable to parse shell segment" };
      }
      renderedSegments.push(argv.map((token) => shellEscapeSingleArg(token)).join(" "));
    }
    out += renderedSegments.join(" | ");
    if (part.opToNext) {
      out += ` ${part.opToNext} `;
    }
  }
  return { ok: true, command: out };
}
export function buildSafeBinsShellCommand(params) {
  const platform = params.platform ?? null;
  if (isWindowsPlatform(platform)) {
    return { ok: false, reason: "unsupported platform" };
  }
  if (params.segments.length !== params.segmentSatisfiedBy.length) {
    return { ok: false, reason: "segment metadata mismatch" };
  }
  const chain = splitCommandChainWithOperators(params.command.trim());
  const chainParts = chain ?? [{ part: params.command.trim(), opToNext: null }];
  let segIndex = 0;
  let out = "";
  for (const part of chainParts) {
    const pipelineSplit = splitShellPipeline(part.part);
    if (!pipelineSplit.ok) {
      return { ok: false, reason: pipelineSplit.reason ?? "unable to parse pipeline" };
    }
    const rendered = [];
    for (const raw of pipelineSplit.segments) {
      const seg = params.segments[segIndex];
      const by = params.segmentSatisfiedBy[segIndex];
      if (!seg || by === undefined) {
        return { ok: false, reason: "segment mapping failed" };
      }
      const needsLiteral = by === "safeBins";
      rendered.push(needsLiteral ? renderQuotedArgv(seg.argv) : raw.trim());
      segIndex += 1;
    }
    out += rendered.join(" | ");
    if (part.opToNext) {
      out += ` ${part.opToNext} `;
    }
  }
  if (segIndex !== params.segments.length) {
    return { ok: false, reason: "segment count mismatch" };
  }
  return { ok: true, command: out };
}
export function splitCommandChain(command) {
  const parts = splitCommandChainWithOperators(command);
  if (!parts) {
    return null;
  }
  return parts.map((p) => p.part);
}
export function analyzeShellCommand(params) {
  if (isWindowsPlatform(params.platform)) {
    return analyzeWindowsShellCommand(params);
  }
  const chainParts = splitCommandChain(params.command);
  if (chainParts) {
    const chains = [];
    const allSegments = [];
    for (const part of chainParts) {
      const pipelineSplit = splitShellPipeline(part);
      if (!pipelineSplit.ok) {
        return { ok: false, reason: pipelineSplit.reason, segments: [] };
      }
      const segments = parseSegmentsFromParts(pipelineSplit.segments, params.cwd, params.env);
      if (!segments) {
        return { ok: false, reason: "unable to parse shell segment", segments: [] };
      }
      chains.push(segments);
      allSegments.push(...segments);
    }
    return { ok: true, segments: allSegments, chains };
  }
  const split = splitShellPipeline(params.command);
  if (!split.ok) {
    return { ok: false, reason: split.reason, segments: [] };
  }
  const segments = parseSegmentsFromParts(split.segments, params.cwd, params.env);
  if (!segments) {
    return { ok: false, reason: "unable to parse shell segment", segments: [] };
  }
  return { ok: true, segments };
}
export function analyzeArgvCommand(params) {
  const argv = params.argv.filter((entry) => entry.trim().length > 0);
  if (argv.length === 0) {
    return { ok: false, reason: "empty argv", segments: [] };
  }
  return {
    ok: true,
    segments: [
      {
        raw: argv.join(" "),
        argv,
        resolution: resolveCommandResolutionFromArgv(argv, params.cwd, params.env),
      },
    ],
  };
}
