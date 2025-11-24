import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BACKUP_VERSION = 2;
const AUTO_FULL_EVERY = 7;
const DEFAULT_DESKTOP_COPY_DIR = path.join(os.homedir(), "Desktop", "Nyx-Backups");
const SKIP_NAMES = new Set(["node_modules", ".git", "dist", "backups"]);

/**
 * Collect all files under a directory recursively with SHA-256 checksums.
 * @param {string} dir
 * @param {string} base
 * @returns {Promise<Array<{rel: string, size: number, hash: string}>>}
 */
async function collectFiles(dir, base = dir) {
  const entries = [];
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const item of items) {
    if (SKIP_NAMES.has(item.name)) {
      continue;
    }
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...(await collectFiles(full, base)));
    } else if (item.isFile()) {
      try {
        const content = await fs.readFile(full);
        const hash = createHash("sha256").update(content).digest("hex");
        const stat = await fs.stat(full);
        entries.push({ rel: path.relative(base, full), size: stat.size, hash });
      } catch {}
    }
  }
  return entries;
}

/**
 * Load the most recent manifest from the backups directory.
 * @param {string} backupsDir
 * @returns {Promise<object|null>}
 */
async function loadLatestManifest(backupsDir) {
  if (!existsSync(backupsDir)) {
    return null;
  }
  const entries = await fs.readdir(backupsDir);
  const manifests = entries
    .filter((e) => e.endsWith(".manifest.json"))
    .toSorted()
    .toReversed();
  if (manifests.length === 0) {
    return null;
  }
  try {
    const raw = await fs.readFile(path.join(backupsDir, manifests[0]), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Count consecutive incremental backups since the last full.
 * @param {string} backupsDir
 * @returns {Promise<number>}
 */
async function countIncrementalsSinceFull(backupsDir) {
  if (!existsSync(backupsDir)) {
    return 0;
  }
  const entries = await fs.readdir(backupsDir);
  const manifests = entries
    .filter((e) => e.endsWith(".manifest.json"))
    .toSorted()
    .toReversed();
  let count = 0;
  for (const name of manifests) {
    try {
      const raw = await fs.readFile(path.join(backupsDir, name), "utf-8");
      const m = JSON.parse(raw);
      if (m.type === "full") {
        break;
      }
      if (m.type === "incremental") {
        count++;
      }
      if (!m.type) {
        break;
      }
    } catch {
      break;
    }
  }
  return count;
}

/**
 * Diff current file entries against a previous manifest.
 * @param {Array<{rel: string, hash: string}>} current
 * @param {object} prevManifest
 * @returns {{ changed: string[], added: string[], removed: string[] }}
 */
function diffAgainstManifest(current, prevManifest) {
  const prevMap = new Map(prevManifest.files.map((f) => [f.rel, f.hash]));
  const currentMap = new Map(current.map((f) => [f.rel, f.hash]));

  const changed = [];
  const added = [];

  for (const { rel, hash } of current) {
    const prevHash = prevMap.get(rel);
    if (!prevHash) {
      added.push(rel);
    } else if (prevHash !== hash) {
      changed.push(rel);
    }
  }

  const removed = [...prevMap.keys()].filter((rel) => !currentMap.has(rel));
  return { changed, added, removed };
}

/**
 * Delete a backup's archive + manifest from both local and Desktop.
 * @param {string} backupsDir
 * @param {object} backup - { manifest, archive, archiveExists }
 */
async function deleteBackup(backupsDir, backup) {
  try {
    await fs.unlink(path.join(backupsDir, backup.manifest));
  } catch {}
  if (backup.archiveExists) {
    try {
      await fs.unlink(path.join(backupsDir, backup.archive));
    } catch {}
  }
  // Mirror cleanup on Desktop
  try {
    await fs.unlink(path.join(DEFAULT_DESKTOP_COPY_DIR, backup.archive));
  } catch {}
}

/**
 * Cycle-based retention: keep current cycle (latest full + its incrementals)
 * + previous full as safety net. Delete everything else.
 * @param {{ stateDir: string }} opts
 * @returns {Promise<{ pruned: number, kept: number }>}
 */
async function pruneBackups({ stateDir }) {
  const { backups } = await listBackups({ stateDir });
  if (backups.length === 0) {
    return { pruned: 0, kept: 0 };
  }

  const backupsDir = path.join(stateDir, "backups");

  // Find the two most recent full backups
  const fullBackups = backups.filter((b) => b.type === "full");
  const latestFull = fullBackups[0] ?? null;
  const previousFull = fullBackups[1] ?? null;

  // Keep: current cycle (latest full + incrementals after it) + previous full
  const keep = new Set();

  if (latestFull) {
    keep.add(latestFull.manifest);
    // Keep incrementals that belong to current cycle (after latest full)
    for (const b of backups) {
      if (b.type === "incremental" && b.timestamp > latestFull.timestamp) {
        keep.add(b.manifest);
      }
    }
  }

  if (previousFull) {
    keep.add(previousFull.manifest);
  }

  // Delete everything not in keep set
  let pruned = 0;
  for (const b of backups) {
    if (!keep.has(b.manifest)) {
      await deleteBackup(backupsDir, b);
      pruned++;
    }
  }

  return { pruned, kept: backups.length - pruned };
}

/**
 * Create a smart backup — automatically decides full vs incremental.
 * - No previous backup → full
 * - N incrementals since last full → full (auto-promote, old incrementals cleaned)
 * - Files changed → incremental (only changed/added files)
 * - Nothing changed → skip
 * @param {{ stateDir: string }} opts
 * @returns {Promise<object>} Backup report
 */
export async function createBackup({ stateDir } = {}) {
  const backupsDir = path.join(stateDir, "backups");
  await fs.mkdir(backupsDir, { recursive: true });

  // Scan all current files
  const allFiles = (await collectFiles(stateDir)).filter((e) => !e.rel.startsWith("backups"));

  // Decide: full or incremental?
  const prevManifest = await loadLatestManifest(backupsDir);
  const incrementalCount = await countIncrementalsSinceFull(backupsDir);
  const needsFull = !prevManifest || incrementalCount >= AUTO_FULL_EVERY;

  let type, filesToArchive, diff;

  if (needsFull) {
    type = "full";
    filesToArchive = allFiles;
    diff = null;
  } else {
    diff = diffAgainstManifest(allFiles, prevManifest);
    const deltaRels = new Set([...diff.changed, ...diff.added]);

    if (deltaRels.size === 0 && diff.removed.length === 0) {
      return { ok: true, skipped: true, reason: "no changes since last backup" };
    }

    type = "incremental";
    filesToArchive = allFiles.filter((f) => deltaRels.has(f.rel));
  }

  // Create archive
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveName = `genosos-backup-${type}-${ts}.tar.gz`;
  const archivePath = path.join(backupsDir, archiveName);
  const manifestName = `genosos-backup-${type}-${ts}.manifest.json`;
  const manifestPath = path.join(backupsDir, manifestName);

  const tar = await import("tar");
  const filePaths = filesToArchive.map((e) => e.rel);

  if (filePaths.length > 0) {
    await tar.create({ gzip: true, file: archivePath, cwd: stateDir }, filePaths);
  } else {
    const { createGzip } = await import("node:zlib");
    const { pipeline } = await import("node:stream/promises");
    const { Readable } = await import("node:stream");
    const { createWriteStream } = await import("node:fs");
    await pipeline(Readable.from(Buffer.alloc(0)), createGzip(), createWriteStream(archivePath));
  }

  const archiveStat = await fs.stat(archivePath);

  // Write manifest — all manifests include ALL files for restore baseline
  const manifest = {
    version: BACKUP_VERSION,
    type,
    timestamp: new Date().toISOString(),
    stateDir,
    archive: archiveName,
    archiveSize: archiveStat.size,
    fileCount: filesToArchive.length,
    totalFiles: allFiles.length,
    files: allFiles.map(({ rel, size, hash }) => ({ rel, size, hash })),
    ...(type === "incremental" && {
      base: prevManifest.archive,
      delta: {
        changed: diff.changed.length,
        added: diff.added.length,
        removed: diff.removed.length,
        removedFiles: diff.removed,
      },
    }),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Cycle-based retention: current cycle + previous full
  const rotation = await pruneBackups({ stateDir });

  // Copy to Desktop for iCloud sync
  let copiedTo;
  try {
    await fs.mkdir(DEFAULT_DESKTOP_COPY_DIR, { recursive: true });
    const dest = path.join(DEFAULT_DESKTOP_COPY_DIR, archiveName);
    await fs.copyFile(archivePath, dest);
    copiedTo = dest;
  } catch {}

  return {
    ok: true,
    type,
    archive: archivePath,
    manifest: manifestPath,
    fileCount: filesToArchive.length,
    totalFiles: allFiles.length,
    archiveSize: archiveStat.size,
    timestamp: manifest.timestamp,
    rotation,
    copiedTo,
    ...(diff && {
      delta: {
        changed: diff.changed.length,
        added: diff.added.length,
        removed: diff.removed.length,
      },
    }),
  };
}

/**
 * Verify a backup archive against its manifest checksums.
 * @param {{ manifestPath: string, stateDir: string }} opts
 * @returns {Promise<object>} Verification report
 */
export async function verifyBackup({ manifestPath, stateDir } = {}) {
  let manifest;
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    manifest = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Failed to read manifest: ${err.message}` };
  }

  const archivePath = path.join(path.dirname(manifestPath), manifest.archive);
  if (!existsSync(archivePath)) {
    return { ok: false, error: `Archive not found: ${manifest.archive}` };
  }

  const archiveStat = await fs.stat(archivePath);
  const sizeMatch = archiveStat.size === manifest.archiveSize;

  const tmpDir = path.join(stateDir, "backups", `.verify-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const tar = await import("tar");
    await tar.extract({ file: archivePath, cwd: tmpDir });

    const filesToVerify =
      manifest.type === "incremental"
        ? manifest.files.filter((f) => existsSync(path.join(tmpDir, f.rel)))
        : manifest.files;

    const verified = [];
    const mismatches = [];

    for (const entry of filesToVerify) {
      const filePath = path.join(tmpDir, entry.rel);
      try {
        const content = await fs.readFile(filePath);
        const hash = createHash("sha256").update(content).digest("hex");
        if (hash === entry.hash) {
          verified.push(entry.rel);
        } else {
          mismatches.push({ file: entry.rel, expected: entry.hash, actual: hash });
        }
      } catch {
        mismatches.push({ file: entry.rel, expected: entry.hash, actual: "missing" });
      }
    }

    return {
      ok: mismatches.length === 0 && sizeMatch,
      sizeMatch,
      type: manifest.type ?? "full",
      totalFiles: manifest.fileCount,
      verified: verified.length,
      mismatches,
      timestamp: manifest.timestamp,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * List existing backups in the state directory.
 * @param {{ stateDir: string }} opts
 * @returns {Promise<object>} List of backups
 */
export async function listBackups({ stateDir } = {}) {
  const backupsDir = path.join(stateDir, "backups");
  if (!existsSync(backupsDir)) {
    return { ok: true, backups: [] };
  }

  const entries = await fs.readdir(backupsDir);
  const manifests = entries.filter((e) => e.endsWith(".manifest.json"));

  const backups = [];
  for (const name of manifests) {
    try {
      const raw = await fs.readFile(path.join(backupsDir, name), "utf-8");
      const m = JSON.parse(raw);
      const archiveExists = existsSync(path.join(backupsDir, m.archive));
      backups.push({
        manifest: name,
        archive: m.archive,
        type: m.type ?? "full",
        timestamp: m.timestamp,
        fileCount: m.fileCount,
        totalFiles: m.totalFiles ?? m.fileCount,
        archiveSize: m.archiveSize,
        archiveExists,
        ...(m.delta && { delta: m.delta }),
      });
    } catch {}
  }

  backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { ok: true, backups };
}

/**
 * Restore state from backups — walks the chain (last full + incrementals).
 * @param {{ manifestPath: string, stateDir: string }} opts
 * @returns {Promise<object>} Restore report
 */
export async function restoreBackup({ manifestPath, stateDir } = {}) {
  const backupsDir = path.join(stateDir, "backups");

  const chain = [];
  let currentPath = manifestPath;

  while (currentPath) {
    let manifest;
    try {
      const raw = await fs.readFile(currentPath, "utf-8");
      manifest = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: `Failed to read manifest: ${err.message}` };
    }

    const archivePath = path.join(path.dirname(currentPath), manifest.archive);
    if (!existsSync(archivePath)) {
      return { ok: false, error: `Archive not found: ${manifest.archive}` };
    }

    chain.unshift({ manifest, archivePath });

    if (!manifest.type || manifest.type === "full") {
      break;
    }

    if (manifest.base) {
      currentPath = path.join(backupsDir, manifest.base.replace(".tar.gz", ".manifest.json"));
    } else {
      break;
    }
  }

  const tar = await import("tar");
  for (const { archivePath } of chain) {
    await tar.extract({ file: archivePath, cwd: stateDir });
  }

  const latest = chain[chain.length - 1].manifest;
  if (latest.delta?.removedFiles?.length > 0) {
    for (const rel of latest.delta.removedFiles) {
      await fs.unlink(path.join(stateDir, rel)).catch(() => {});
    }
  }

  return {
    ok: true,
    restored: latest.totalFiles ?? latest.fileCount,
    chain: chain.map((c) => c.manifest.type ?? "full"),
    timestamp: latest.timestamp,
  };
}
