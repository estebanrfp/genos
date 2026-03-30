let clampLimit = function (value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }
    const v = Math.floor(value);
    return v > 0 ? v : undefined;
  },
  resolveExtractLimits = function (limits) {
    return {
      maxArchiveBytes: clampLimit(limits?.maxArchiveBytes) ?? DEFAULT_MAX_ARCHIVE_BYTES_ZIP,
      maxEntries: clampLimit(limits?.maxEntries) ?? DEFAULT_MAX_ENTRIES,
      maxExtractedBytes: clampLimit(limits?.maxExtractedBytes) ?? DEFAULT_MAX_EXTRACTED_BYTES,
      maxEntryBytes: clampLimit(limits?.maxEntryBytes) ?? DEFAULT_MAX_ENTRY_BYTES,
    };
  },
  assertArchiveEntryCountWithinLimit = function (entryCount, limits) {
    if (entryCount > limits.maxEntries) {
      throw new Error(ERROR_ARCHIVE_ENTRY_COUNT_EXCEEDS_LIMIT);
    }
  },
  createByteBudgetTracker = function (limits) {
    let entryBytes = 0;
    let extractedBytes = 0;
    const addBytes = (bytes) => {
      const b = Math.max(0, Math.floor(bytes));
      if (b === 0) {
        return;
      }
      entryBytes += b;
      if (entryBytes > limits.maxEntryBytes) {
        throw new Error(ERROR_ARCHIVE_ENTRY_EXTRACTED_SIZE_EXCEEDS_LIMIT);
      }
      extractedBytes += b;
      if (extractedBytes > limits.maxExtractedBytes) {
        throw new Error(ERROR_ARCHIVE_EXTRACTED_SIZE_EXCEEDS_LIMIT);
      }
    };
    return {
      startEntry() {
        entryBytes = 0;
      },
      addBytes,
      addEntrySize(size) {
        const s = Math.max(0, Math.floor(size));
        if (s > limits.maxEntryBytes) {
          throw new Error(ERROR_ARCHIVE_ENTRY_EXTRACTED_SIZE_EXCEEDS_LIMIT);
        }
        addBytes(s);
      },
    };
  },
  createExtractBudgetTransform = function (params) {
    return new Transform({
      transform(chunk, _encoding, callback) {
        try {
          const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
          params.onChunkBytes(buf.byteLength);
          callback(null, buf);
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });
  },
  readTarEntryInfo = function (entry) {
    const p =
      typeof entry === "object" && entry !== null && "path" in entry ? String(entry.path) : "";
    const t =
      typeof entry === "object" && entry !== null && "type" in entry ? String(entry.type) : "";
    const s =
      typeof entry === "object" &&
      entry !== null &&
      "size" in entry &&
      typeof entry.size === "number" &&
      Number.isFinite(entry.size)
        ? Math.max(0, Math.floor(entry.size))
        : 0;
    return { path: p, type: t, size: s };
  };
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import * as tar from "tar";
import {
  resolveArchiveOutputPath,
  stripArchivePath,
  validateArchiveEntryPath,
} from "./archive-path.js";
export const DEFAULT_MAX_ARCHIVE_BYTES_ZIP = 268435456;
export const DEFAULT_MAX_ENTRIES = 50000;
export const DEFAULT_MAX_EXTRACTED_BYTES = 536870912;
export const DEFAULT_MAX_ENTRY_BYTES = 268435456;
const ERROR_ARCHIVE_SIZE_EXCEEDS_LIMIT = "archive size exceeds limit";
const ERROR_ARCHIVE_ENTRY_COUNT_EXCEEDS_LIMIT = "archive entry count exceeds limit";
const ERROR_ARCHIVE_ENTRY_EXTRACTED_SIZE_EXCEEDS_LIMIT =
  "archive entry extracted size exceeds limit";
const ERROR_ARCHIVE_EXTRACTED_SIZE_EXCEEDS_LIMIT = "archive extracted size exceeds limit";
const TAR_SUFFIXES = [".tgz", ".tar.gz", ".tar"];
export function resolveArchiveKind(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  if (TAR_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return "tar";
  }
  return null;
}
export async function resolvePackedRootDir(extractDir) {
  const direct = path.join(extractDir, "package");
  try {
    const stat = await fs.stat(direct);
    if (stat.isDirectory()) {
      return direct;
    }
  } catch {}
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (dirs.length !== 1) {
    throw new Error(`unexpected archive layout (dirs: ${dirs.join(", ")})`);
  }
  const onlyDir = dirs[0];
  if (!onlyDir) {
    throw new Error("unexpected archive layout (no package dir found)");
  }
  return path.join(extractDir, onlyDir);
}
export async function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
async function readZipEntryStream(entry) {
  if (typeof entry.nodeStream === "function") {
    return entry.nodeStream();
  }
  const buf = await entry.async("nodebuffer");
  return Readable.from(buf);
}
async function extractZip(params) {
  const limits = resolveExtractLimits(params.limits);
  const stat = await fs.stat(params.archivePath);
  if (stat.size > limits.maxArchiveBytes) {
    throw new Error(ERROR_ARCHIVE_SIZE_EXCEEDS_LIMIT);
  }
  const buffer = await fs.readFile(params.archivePath);
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  const strip = Math.max(0, Math.floor(params.stripComponents ?? 0));
  assertArchiveEntryCountWithinLimit(entries.length, limits);
  const budget = createByteBudgetTracker(limits);
  for (const entry of entries) {
    validateArchiveEntryPath(entry.name);
    const relPath = stripArchivePath(entry.name, strip);
    if (!relPath) {
      continue;
    }
    validateArchiveEntryPath(relPath);
    const outPath = resolveArchiveOutputPath({
      rootDir: params.destDir,
      relPath,
      originalPath: entry.name,
    });
    if (entry.dir) {
      await fs.mkdir(outPath, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    budget.startEntry();
    const readable = await readZipEntryStream(entry);
    try {
      await pipeline(
        readable,
        createExtractBudgetTransform({ onChunkBytes: budget.addBytes }),
        createWriteStream(outPath),
      );
    } catch (err) {
      await fs.unlink(outPath).catch(() => {
        return;
      });
      throw err;
    }
    if (typeof entry.unixPermissions === "number") {
      const mode = entry.unixPermissions & 511;
      if (mode !== 0) {
        await fs.chmod(outPath, mode).catch(() => {
          return;
        });
      }
    }
  }
}
export async function extractArchive(params) {
  const kind = params.kind ?? resolveArchiveKind(params.archivePath);
  if (!kind) {
    throw new Error(`unsupported archive: ${params.archivePath}`);
  }
  const label = kind === "zip" ? "extract zip" : "extract tar";
  if (kind === "tar") {
    const strip = Math.max(0, Math.floor(params.stripComponents ?? 0));
    const limits = resolveExtractLimits(params.limits);
    let entryCount = 0;
    const budget = createByteBudgetTracker(limits);
    await withTimeout(
      tar.x({
        file: params.archivePath,
        cwd: params.destDir,
        strip,
        gzip: params.tarGzip,
        preservePaths: false,
        strict: true,
        onReadEntry(entry) {
          const info = readTarEntryInfo(entry);
          try {
            validateArchiveEntryPath(info.path);
            const relPath = stripArchivePath(info.path, strip);
            if (!relPath) {
              return;
            }
            validateArchiveEntryPath(relPath);
            resolveArchiveOutputPath({
              rootDir: params.destDir,
              relPath,
              originalPath: info.path,
            });
            if (
              info.type === "SymbolicLink" ||
              info.type === "Link" ||
              info.type === "BlockDevice" ||
              info.type === "CharacterDevice" ||
              info.type === "FIFO" ||
              info.type === "Socket"
            ) {
              throw new Error(`tar entry is a link: ${info.path}`);
            }
            entryCount += 1;
            assertArchiveEntryCountWithinLimit(entryCount, limits);
            budget.addEntrySize(info.size);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const emitter = this;
            emitter.abort?.(error);
          }
        },
      }),
      params.timeoutMs,
      label,
    );
    return;
  }
  await withTimeout(
    extractZip({
      archivePath: params.archivePath,
      destDir: params.destDir,
      stripComponents: params.stripComponents,
      limits: params.limits,
    }),
    params.timeoutMs,
    label,
  );
}
export async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
export async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}
