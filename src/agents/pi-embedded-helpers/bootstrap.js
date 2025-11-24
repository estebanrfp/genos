let isBase64Signature = function (value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }
    const compact = trimmed.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) {
      return false;
    }
    const isUrl = compact.includes("-") || compact.includes("_");
    try {
      const buf = Buffer.from(compact, isUrl ? "base64url" : "base64");
      if (buf.length === 0) {
        return false;
      }
      const encoded = buf.toString(isUrl ? "base64url" : "base64");
      const normalize = (input) => input.replace(/=+$/g, "");
      return normalize(encoded) === normalize(compact);
    } catch {
      return false;
    }
  },
  trimBootstrapContent = function (content, fileName, maxChars) {
    const trimmed = content.trimEnd();
    if (trimmed.length <= maxChars) {
      return {
        content: trimmed,
        truncated: false,
        maxChars,
        originalLength: trimmed.length,
      };
    }
    const headChars = Math.floor(maxChars * BOOTSTRAP_HEAD_RATIO);
    const tailChars = Math.floor(maxChars * BOOTSTRAP_TAIL_RATIO);
    const head = trimmed.slice(0, headChars);
    const tail = trimmed.slice(-tailChars);
    const marker = [
      "",
      `[...truncated, read ${fileName} for full content...]`,
      `\u2026(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${trimmed.length})\u2026`,
      "",
    ].join("\n");
    const contentWithMarker = [head, marker, tail].join("\n");
    return {
      content: contentWithMarker,
      truncated: true,
      maxChars,
      originalLength: trimmed.length,
    };
  },
  clampToBudget = function (content, budget) {
    if (budget <= 0) {
      return "";
    }
    if (content.length <= budget) {
      return content;
    }
    if (budget <= 3) {
      return truncateUtf16Safe(content, budget);
    }
    const safe = budget - 1;
    return `${truncateUtf16Safe(content, safe)}\u2026`;
  };
import fs from "node:fs/promises";
import path from "node:path";
import { truncateUtf16Safe } from "../../utils.js";
import { convertBootstrapToToon } from "./md-to-toon.js";
export function stripThoughtSignatures(content, options) {
  if (!Array.isArray(content)) {
    return content;
  }
  const allowBase64Only = options?.allowBase64Only ?? false;
  const includeCamelCase = options?.includeCamelCase ?? false;
  const shouldStripSignature = (value) => {
    if (!allowBase64Only) {
      return typeof value === "string" && value.startsWith("msg_");
    }
    return typeof value !== "string" || !isBase64Signature(value);
  };
  return content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const rec = block;
    const stripSnake = shouldStripSignature(rec.thought_signature);
    const stripCamel = includeCamelCase ? shouldStripSignature(rec.thoughtSignature) : false;
    if (!stripSnake && !stripCamel) {
      return block;
    }
    const next = { ...rec };
    if (stripSnake) {
      delete next.thought_signature;
    }
    if (stripCamel) {
      delete next.thoughtSignature;
    }
    return next;
  });
}
/**
 * Heuristically compress bootstrap content to reduce token usage.
 * @param {string} content
 * @returns {string}
 */
export function compressBootstrapContent(content) {
  return content
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^(#{1,6}\s.*)\n\n+(?=\S)/gm, "$1\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trimEnd();
}
export const DEFAULT_BOOTSTRAP_MAX_CHARS = 20000;
export const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150000;
const MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64;
const BOOTSTRAP_HEAD_RATIO = 0.7;
const BOOTSTRAP_TAIL_RATIO = 0.2;
export function resolveBootstrapMaxChars(cfg) {
  const raw = cfg?.agents?.defaults?.bootstrapMaxChars;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_BOOTSTRAP_MAX_CHARS;
}
export function resolveBootstrapTotalMaxChars(cfg) {
  const raw = cfg?.agents?.defaults?.bootstrapTotalMaxChars;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS;
}
export async function ensureSessionHeader(params) {
  const file = params.sessionFile;
  try {
    await fs.stat(file);
    return;
  } catch {}
  await fs.mkdir(path.dirname(file), { recursive: true });
  const sessionVersion = 2;
  const entry = {
    type: "session",
    version: sessionVersion,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: params.cwd,
  };
  await fs.writeFile(file, `${JSON.stringify(entry)}\n`, "utf-8");
}
export function buildBootstrapContextFiles(files, opts) {
  const maxChars = opts?.maxChars ?? DEFAULT_BOOTSTRAP_MAX_CHARS;
  const totalMaxChars = Math.max(
    1,
    Math.floor(opts?.totalMaxChars ?? Math.max(maxChars, DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS)),
  );
  let remainingTotalChars = totalMaxChars;
  const result = [];
  for (const file of files) {
    if (remainingTotalChars <= 0) {
      break;
    }
    if (file.missing) {
      const missingText = `[MISSING] Expected at: ${file.path}`;
      const cappedMissingText = clampToBudget(missingText, remainingTotalChars);
      if (!cappedMissingText) {
        break;
      }
      remainingTotalChars = Math.max(0, remainingTotalChars - cappedMissingText.length);
      result.push({
        path: file.path,
        content: cappedMissingText,
      });
      continue;
    }
    if (remainingTotalChars < MIN_BOOTSTRAP_FILE_BUDGET_CHARS) {
      opts?.warn?.(
        `remaining bootstrap budget is ${remainingTotalChars} chars (<${MIN_BOOTSTRAP_FILE_BUDGET_CHARS}); skipping additional bootstrap files`,
      );
      break;
    }
    const fileMaxChars = Math.max(1, Math.min(maxChars, remainingTotalChars));
    const compressed = compressBootstrapContent(file.content ?? "");
    const toonified = convertBootstrapToToon(compressed);
    const trimmed = trimBootstrapContent(toonified, file.name, fileMaxChars);
    const contentWithinBudget = clampToBudget(trimmed.content, remainingTotalChars);
    if (!contentWithinBudget) {
      continue;
    }
    if (trimmed.truncated || contentWithinBudget.length < trimmed.content.length) {
      opts?.warn?.(
        `workspace bootstrap file ${file.name} is ${trimmed.originalLength} chars (limit ${trimmed.maxChars}); truncating in injected context`,
      );
    }
    remainingTotalChars = Math.max(0, remainingTotalChars - contentWithinBudget.length);
    result.push({
      path: file.path,
      content: contentWithinBudget,
    });
  }
  return result;
}
export function sanitizeGoogleTurnOrdering(messages) {
  const GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT = "(session bootstrap)";
  const first = messages[0];
  const role = first?.role;
  const content = first?.content;
  if (
    role === "user" &&
    typeof content === "string" &&
    content.trim() === GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT
  ) {
    return messages;
  }
  if (role !== "assistant") {
    return messages;
  }
  const bootstrap = {
    role: "user",
    content: GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT,
    timestamp: Date.now(),
  };
  return [bootstrap, ...messages];
}
