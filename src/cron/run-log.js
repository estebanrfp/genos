import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolvePassphrase } from "../infra/crypto-utils.js";
import { isEncrypted, decryptContent } from "../infra/memory-encryption.js";

/** @param {string} raw */
function tryDecrypt(raw) {
  if (!isEncrypted(raw)) {
    return raw;
  }
  try {
    return decryptContent(raw, resolvePassphrase());
  } catch {
    return raw;
  }
}

export function resolveCronRunLogPath(params) {
  const storePath = path.resolve(params.storePath);
  const dir = path.dirname(storePath);
  return path.join(dir, "runs", `${params.jobId}.jsonl`);
}
const writesByPath = new Map();
async function pruneIfNeeded(filePath, opts) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.size <= opts.maxBytes) {
    return;
  }
  const raw = await fs.readFile(filePath, "utf-8").catch(() => "");
  const content = tryDecrypt(raw);
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const kept = lines.slice(Math.max(0, lines.length - opts.keepLines));
  await fs.writeFile(filePath, `${kept.join("\n")}\n`, "utf-8");
}
export async function appendCronRunLog(filePath, entry, opts) {
  const resolved = path.resolve(filePath);
  const prev = writesByPath.get(resolved) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      return;
    })
    .then(async () => {
      await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
      const line = typeof entry === "string" ? entry : JSON.stringify(entry);
      fsSync.appendFileSync(resolved, line + "\n", { mode: 0o600 });
      await pruneIfNeeded(resolved, {
        maxBytes: opts?.maxBytes ?? 2000000,
        keepLines: opts?.keepLines ?? 2000,
      });
    });
  writesByPath.set(resolved, next);
  await next;
}
export async function readCronRunLogEntries(filePath, opts) {
  const limit = Math.max(1, Math.min(5000, Math.floor(opts?.limit ?? 200)));
  const jobId = opts?.jobId?.trim() || undefined;
  const raw = await fs.readFile(path.resolve(filePath), "utf-8").catch(() => "");
  const content = tryDecrypt(raw);
  if (!content.trim()) {
    return [];
  }
  const parsed = [];
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0 && parsed.length < limit; i--) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }
    try {
      const obj = JSON.parse(line);
      if (!obj || typeof obj !== "object") {
        continue;
      }
      if (obj.action !== "finished") {
        continue;
      }
      if (typeof obj.jobId !== "string" || obj.jobId.trim().length === 0) {
        continue;
      }
      if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) {
        continue;
      }
      if (jobId && obj.jobId !== jobId) {
        continue;
      }
      const usage = obj.usage && typeof obj.usage === "object" ? obj.usage : undefined;
      const entry = {
        ts: obj.ts,
        jobId: obj.jobId,
        action: "finished",
        status: obj.status,
        error: obj.error,
        summary: obj.summary,
        runAtMs: obj.runAtMs,
        durationMs: obj.durationMs,
        nextRunAtMs: obj.nextRunAtMs,
        model: typeof obj.model === "string" && obj.model.trim() ? obj.model : undefined,
        provider:
          typeof obj.provider === "string" && obj.provider.trim() ? obj.provider : undefined,
        usage: usage
          ? {
              input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
              output_tokens:
                typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
              total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
              cache_read_tokens:
                typeof usage.cache_read_tokens === "number" ? usage.cache_read_tokens : undefined,
              cache_write_tokens:
                typeof usage.cache_write_tokens === "number" ? usage.cache_write_tokens : undefined,
            }
          : undefined,
      };
      if (typeof obj.sessionId === "string" && obj.sessionId.trim().length > 0) {
        entry.sessionId = obj.sessionId;
      }
      if (typeof obj.sessionKey === "string" && obj.sessionKey.trim().length > 0) {
        entry.sessionKey = obj.sessionKey;
      }
      parsed.push(entry);
    } catch {}
  }
  return parsed.toReversed();
}
