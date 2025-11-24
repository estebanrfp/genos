let safeCwd = function () {
    try {
      const cwd = process.cwd();
      return existsSync(cwd) ? cwd : null;
    } catch {
      return null;
    }
  },
  tokenizeCommand = function (command) {
    const matches = command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
    return matches.map((token) => stripQuotes(token)).filter(Boolean);
  },
  stripQuotes = function (value) {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };
import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { sliceUtf16Safe } from "../utils.js";
const CHUNK_LIMIT = 8192;
export function buildSandboxEnv(params) {
  const env = {
    PATH: params.defaultPath,
    HOME: params.containerWorkdir,
  };
  for (const [key, value] of Object.entries(params.sandboxEnv ?? {})) {
    env[key] = value;
  }
  for (const [key, value] of Object.entries(params.paramsEnv ?? {})) {
    env[key] = value;
  }
  return env;
}
export function coerceEnv(env) {
  const record = {};
  if (!env) {
    return record;
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
}
export async function resolveSandboxWorkdir(params) {
  const fallback = params.sandbox.workspaceDir;
  try {
    const resolvedPath = path.resolve(process.cwd(), params.workdir);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error("workdir is not a directory");
    }
    const relative = path.relative(params.sandbox.workspaceDir, resolvedPath);
    const relPosix = relative ? relative.split(path.sep).join(path.posix.sep) : "";
    const containerWorkdir = relPosix
      ? path.posix.join(params.sandbox.containerWorkdir, relPosix)
      : params.sandbox.containerWorkdir;
    return { hostWorkdir: resolvedPath, containerWorkdir };
  } catch {
    params.warnings.push(
      `Warning: workdir "${params.workdir}" is unavailable; using "${fallback}".`,
    );
    return {
      hostWorkdir: fallback,
      containerWorkdir: params.sandbox.containerWorkdir,
    };
  }
}
export function resolveWorkdir(workdir, warnings) {
  const current = safeCwd();
  const fallback = current ?? homedir();
  try {
    const stats = statSync(workdir);
    if (stats.isDirectory()) {
      return workdir;
    }
  } catch {}
  warnings.push(`Warning: workdir "${workdir}" is unavailable; using "${fallback}".`);
  return fallback;
}
export function clampWithDefault(value, defaultValue, min, max) {
  if (value === undefined || Number.isNaN(value)) {
    return defaultValue;
  }
  return Math.min(Math.max(value, min), max);
}
export function readEnvInt(key) {
  const raw = process.env[key];
  if (!raw) {
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function chunkString(input, limit = CHUNK_LIMIT) {
  const chunks = [];
  for (let i = 0; i < input.length; i += limit) {
    chunks.push(input.slice(i, i + limit));
  }
  return chunks;
}
export function truncateMiddle(str, max) {
  if (str.length <= max) {
    return str;
  }
  const half = Math.floor((max - 3) / 2);
  return `${sliceUtf16Safe(str, 0, half)}...${sliceUtf16Safe(str, -half)}`;
}
export function sliceLogLines(text, offset, limit) {
  if (!text) {
    return { slice: "", totalLines: 0, totalChars: 0 };
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const totalLines = lines.length;
  const totalChars = text.length;
  let start =
    typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  if (limit !== undefined && offset === undefined) {
    const tailCount = Math.max(0, Math.floor(limit));
    start = Math.max(totalLines - tailCount, 0);
  }
  const end =
    typeof limit === "number" && Number.isFinite(limit)
      ? start + Math.max(0, Math.floor(limit))
      : undefined;
  return { slice: lines.slice(start, end).join("\n"), totalLines, totalChars };
}
export function deriveSessionName(command) {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return;
  }
  const verb = tokens[0];
  let target = tokens.slice(1).find((t) => !t.startsWith("-"));
  if (!target) {
    target = tokens[1];
  }
  if (!target) {
    return verb;
  }
  const cleaned = truncateMiddle(stripQuotes(target), 48);
  return `${stripQuotes(verb)} ${cleaned}`;
}
export function pad(str, width) {
  if (str.length >= width) {
    return str;
  }
  return str + " ".repeat(width - str.length);
}
