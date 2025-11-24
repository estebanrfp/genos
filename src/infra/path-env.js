let isExecutable = function (filePath) {
    try {
      fs.accessSync(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  isDirectory = function (dirPath) {
    try {
      return fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  },
  mergePath = function (params) {
    const partsExisting = params.existing
      .split(path.delimiter)
      .map((part) => part.trim())
      .filter(Boolean);
    const partsPrepend = (params.prepend ?? []).map((part) => part.trim()).filter(Boolean);
    const partsAppend = (params.append ?? []).map((part) => part.trim()).filter(Boolean);
    const seen = new Set();
    const merged = [];
    for (const part of [...partsPrepend, ...partsExisting, ...partsAppend]) {
      if (!seen.has(part)) {
        seen.add(part);
        merged.push(part);
      }
    }
    return merged.join(path.delimiter);
  },
  candidateBinDirs = function (opts) {
    const execPath = opts.execPath ?? process.execPath;
    const cwd = opts.cwd ?? process.cwd();
    const homeDir = opts.homeDir ?? os.homedir();
    const platform = opts.platform ?? process.platform;
    const prepend = [];
    const append = [];
    try {
      const execDir = path.dirname(execPath);
      const siblingCli = path.join(execDir, "genosos");
      if (isExecutable(siblingCli)) {
        prepend.push(execDir);
      }
    } catch {}
    const allowProjectLocalBin =
      opts.allowProjectLocalBin === true ||
      isTruthyEnvValue(process.env.GENOS_ALLOW_PROJECT_LOCAL_BIN);
    if (allowProjectLocalBin) {
      const localBinDir = path.join(cwd, "node_modules", ".bin");
      if (isExecutable(path.join(localBinDir, "genosos"))) {
        append.push(localBinDir);
      }
    }
    const miseDataDir = process.env.MISE_DATA_DIR ?? path.join(homeDir, ".local", "share", "mise");
    const miseShims = path.join(miseDataDir, "shims");
    if (isDirectory(miseShims)) {
      prepend.push(miseShims);
    }
    prepend.push(...resolveBrewPathDirs({ homeDir }));
    if (platform === "darwin") {
      prepend.push(path.join(homeDir, "Library", "pnpm"));
    }
    if (process.env.XDG_BIN_HOME) {
      prepend.push(process.env.XDG_BIN_HOME);
    }
    prepend.push(path.join(homeDir, ".local", "bin"));
    prepend.push(path.join(homeDir, ".local", "share", "pnpm"));
    prepend.push(path.join(homeDir, ".bun", "bin"));
    prepend.push(path.join(homeDir, ".yarn", "bin"));
    prepend.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
    return { prepend: prepend.filter(isDirectory), append: append.filter(isDirectory) };
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBrewPathDirs } from "./brew.js";
import { isTruthyEnvValue } from "./env.js";
export function ensureGenosOSCliOnPath(opts = {}) {
  if (isTruthyEnvValue(process.env.GENOS_PATH_BOOTSTRAPPED)) {
    return;
  }
  process.env.GENOS_PATH_BOOTSTRAPPED = "1";
  const existing = opts.pathEnv ?? process.env.PATH ?? "";
  const { prepend, append } = candidateBinDirs(opts);
  if (prepend.length === 0 && append.length === 0) {
    return;
  }
  const merged = mergePath({ existing, prepend, append });
  if (merged) {
    process.env.PATH = merged;
  }
}
