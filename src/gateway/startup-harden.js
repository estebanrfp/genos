// GenosOS — Esteban & Nyx 🦀🌙
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("security");
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

/**
 * Recursively harden permissions on the state directory.
 * Directories → 0o700, files → 0o600.
 */
export async function hardenStateDirectoryPermissions() {
  if (process.platform === "win32") {
    return;
  }

  const stateDir = STATE_DIR;
  try {
    await fs.access(stateDir);
  } catch {
    return; // state dir does not exist yet
  }

  await hardenDir(stateDir);

  // Spotlight exclusion: sentinel file prevents content indexing
  if (process.platform === "darwin") {
    const sentinel = path.join(stateDir, ".metadata_never_index");
    try {
      await fs.access(sentinel);
    } catch {
      await fs.writeFile(sentinel, "", { mode: FILE_MODE });
      log.info("Spotlight exclusion sentinel created");
    }

    // Time Machine exclusion via extended attribute
    try {
      execFileSync("xattr", [
        "-w",
        "com.apple.metadata:com_apple_backup_excludeItem",
        "com.apple.backupd",
        stateDir,
      ]);
      log.info("Time Machine exclusion xattr set");
    } catch {
      log.warn("Failed to set Time Machine exclusion xattr");
    }
  }

  log.info(`State directory permissions hardened: ${stateDir}`);
}

/**
 * @param {string} dir
 */
async function hardenDir(dir) {
  try {
    await fs.chmod(dir, DIR_MODE);
  } catch {}

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await hardenDir(full);
    } else if (entry.isFile()) {
      try {
        await fs.chmod(full, FILE_MODE);
      } catch {}
    }
  }
}
