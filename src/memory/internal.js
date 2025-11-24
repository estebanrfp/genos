import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { runTasksWithConcurrency } from "../utils/run-with-concurrency.js";
export function ensureDir(dir) {
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}
export function normalizeRelPath(value) {
  const trimmed = value.trim().replace(/^[./]+/, "");
  return trimmed.replace(/\\/g, "/");
}
export function normalizeExtraMemoryPaths(workspaceDir, extraPaths) {
  if (!extraPaths?.length) {
    return [];
  }
  const resolved = extraPaths
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) =>
      path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceDir, value),
    );
  return Array.from(new Set(resolved));
}
export function isMemoryPath(relPath) {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) {
    return false;
  }
  if (normalized === "MEMORY.md" || normalized === "memory.md") {
    return true;
  }
  return normalized.startsWith("memory/");
}
async function walkDir(dir, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      await walkDir(full, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".md")) {
      continue;
    }
    files.push(full);
  }
}
export async function listMemoryFiles(workspaceDir, extraPaths) {
  const result = [];
  const memoryFile = path.join(workspaceDir, "MEMORY.md");
  const altMemoryFile = path.join(workspaceDir, "memory.md");
  const memoryDir = path.join(workspaceDir, "memory");
  const addMarkdownFile = async (absPath) => {
    try {
      const stat = await fs.lstat(absPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return;
      }
      if (!absPath.endsWith(".md")) {
        return;
      }
      result.push(absPath);
    } catch {}
  };
  await addMarkdownFile(memoryFile);
  await addMarkdownFile(altMemoryFile);
  try {
    const dirStat = await fs.lstat(memoryDir);
    if (!dirStat.isSymbolicLink() && dirStat.isDirectory()) {
      await walkDir(memoryDir, result);
    }
  } catch {}
  const normalizedExtraPaths = normalizeExtraMemoryPaths(workspaceDir, extraPaths);
  if (normalizedExtraPaths.length > 0) {
    for (const inputPath of normalizedExtraPaths) {
      try {
        const stat = await fs.lstat(inputPath);
        if (stat.isSymbolicLink()) {
          continue;
        }
        if (stat.isDirectory()) {
          await walkDir(inputPath, result);
          continue;
        }
        if (stat.isFile() && inputPath.endsWith(".md")) {
          result.push(inputPath);
        }
      } catch {}
    }
  }
  if (result.length <= 1) {
    return result;
  }
  const seen = new Set();
  const deduped = [];
  for (const entry of result) {
    let key = entry;
    try {
      key = await fs.realpath(entry);
    } catch {}
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}
export function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
/**
 * Read a memory file, transparently decrypting NYXENC1 content.
 * @param {string} absPath
 * @returns {Promise<string>}
 */
export async function readMemoryFile(absPath) {
  const raw = await fs.readFile(absPath, "utf-8");
  if (!raw.startsWith("NYXENC1\n")) {
    return raw;
  }
  try {
    const { decryptContent } = await import("../infra/memory-encryption.js");
    const { resolvePassphrase } = await import("../infra/crypto-utils.js");
    return decryptContent(raw, resolvePassphrase());
  } catch {
    return raw; // graceful degradation — no passphrase configured
  }
}

export async function buildFileEntry(absPath, workspaceDir) {
  const stat = await fs.stat(absPath);
  const content = await readMemoryFile(absPath);
  const hash = hashText(content);
  return {
    path: path.relative(workspaceDir, absPath).replace(/\\/g, "/"),
    absPath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hash,
  };
}
/**
 * Chunk an array of {line, lineNo} entries using line-accumulation with overlap.
 * @param {{ line: string, lineNo: number }[]} entries
 * @param {number} maxChars
 * @param {number} overlapChars
 * @returns {Array<{ startLine: number, endLine: number, text: string, hash: string }>}
 */
function chunkLines(entries, maxChars, overlapChars) {
  const chunks = [];
  let current = [];
  let currentChars = 0;
  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const firstEntry = current[0];
    const lastEntry = current[current.length - 1];
    if (!firstEntry || !lastEntry) {
      return;
    }
    const text = current.map((e) => e.line).join("\n");
    chunks.push({
      startLine: firstEntry.lineNo,
      endLine: lastEntry.lineNo,
      text,
      hash: hashText(text),
    });
  };
  const carryOverlap = () => {
    if (overlapChars <= 0 || current.length === 0) {
      current = [];
      currentChars = 0;
      return;
    }
    let acc = 0;
    const kept = [];
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const entry = current[i];
      if (!entry) {
        continue;
      }
      acc += entry.line.length + 1;
      kept.unshift(entry);
      if (acc >= overlapChars) {
        break;
      }
    }
    current = kept;
    currentChars = kept.reduce((sum, e) => sum + e.line.length + 1, 0);
  };
  for (const entry of entries) {
    const segments = [];
    if (entry.line.length === 0) {
      segments.push("");
    } else {
      for (let start = 0; start < entry.line.length; start += maxChars) {
        segments.push(entry.line.slice(start, start + maxChars));
      }
    }
    for (const segment of segments) {
      const lineSize = segment.length + 1;
      if (currentChars + lineSize > maxChars && current.length > 0) {
        flush();
        carryOverlap();
      }
      current.push({ line: segment, lineNo: entry.lineNo });
      currentChars += lineSize;
    }
  }
  flush();
  return chunks;
}
export function chunkMarkdown(content, chunking) {
  const lines = content.split("\n");
  if (lines.length === 0) {
    return [];
  }

  const maxChars = Math.max(32, chunking.tokens * 4);
  const overlapChars = Math.max(0, chunking.overlap * 4);

  // Split into sections by headings
  const sections = [];
  let currentSection = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s/.test(line) && currentSection.length > 0) {
      sections.push(currentSection);
      currentSection = [];
    }
    currentSection.push({ line, lineNo: i + 1 });
  }
  if (currentSection.length > 0) {
    sections.push(currentSection);
  }

  // Chunk each section independently (no overlap across sections)
  const allChunks = [];
  for (const section of sections) {
    const sectionChars = section.reduce((sum, e) => sum + e.line.length + 1, 0);
    if (sectionChars <= maxChars) {
      const text = section.map((e) => e.line).join("\n");
      if (text.trim().length > 0) {
        allChunks.push({
          startLine: section[0].lineNo,
          endLine: section[section.length - 1].lineNo,
          text,
          hash: hashText(text),
        });
      }
    } else {
      allChunks.push(...chunkLines(section, maxChars, overlapChars));
    }
  }
  return allChunks;
}
export function remapChunkLines(chunks, lineMap) {
  if (!lineMap || lineMap.length === 0) {
    return;
  }
  for (const chunk of chunks) {
    chunk.startLine = lineMap[chunk.startLine - 1] ?? chunk.startLine;
    chunk.endLine = lineMap[chunk.endLine - 1] ?? chunk.endLine;
  }
}
export function parseEmbedding(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
export function cosineSimilarity(a, b) {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
export async function runWithConcurrency(tasks, limit) {
  const { results, firstError, hasError } = await runTasksWithConcurrency({
    tasks,
    limit,
    errorMode: "stop",
  });
  if (hasError) {
    throw firstError;
  }
  return results;
}
