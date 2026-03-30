let readPackageNameSync = function (dir) {
    try {
      const raw = fsSync.readFileSync(path.join(dir, "package.json"), "utf-8");
      const parsed = JSON.parse(raw);
      return typeof parsed.name === "string" ? parsed.name : null;
    } catch {
      return null;
    }
  },
  findPackageRootSync = function (startDir, maxDepth = 12) {
    let current = path.resolve(startDir);
    for (let i = 0; i < maxDepth; i += 1) {
      const name = readPackageNameSync(current);
      if (name && CORE_PACKAGE_NAMES.has(name)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return null;
  },
  candidateDirsFromArgv1 = function (argv1) {
    const normalized = path.resolve(argv1);
    const candidates = [path.dirname(normalized)];
    try {
      const resolved = fsSync.realpathSync(normalized);
      if (resolved !== normalized) {
        candidates.push(path.dirname(resolved));
      }
    } catch {}
    const parts = normalized.split(path.sep);
    const binIndex = parts.lastIndexOf(".bin");
    if (binIndex > 0 && parts[binIndex - 1] === "node_modules") {
      const binName = path.basename(normalized);
      const nodeModulesDir = parts.slice(0, binIndex).join(path.sep);
      candidates.push(path.join(nodeModulesDir, binName));
    }
    return candidates;
  },
  buildCandidates = function (opts) {
    const candidates = [];
    if (opts.moduleUrl) {
      candidates.push(path.dirname(fileURLToPath(opts.moduleUrl)));
    }
    if (opts.argv1) {
      candidates.push(...candidateDirsFromArgv1(opts.argv1));
    }
    if (opts.cwd) {
      candidates.push(opts.cwd);
    }
    return candidates;
  };
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const CORE_PACKAGE_NAMES = new Set(["genosos"]);
async function readPackageName(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}
async function findPackageRoot(startDir, maxDepth = 12) {
  let current = path.resolve(startDir);
  for (let i = 0; i < maxDepth; i += 1) {
    const name = await readPackageName(current);
    if (name && CORE_PACKAGE_NAMES.has(name)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}
export async function resolveGenosOSPackageRoot(opts) {
  for (const candidate of buildCandidates(opts)) {
    const found = await findPackageRoot(candidate);
    if (found) {
      return found;
    }
  }
  return null;
}
export function resolveGenosOSPackageRootSync(opts) {
  for (const candidate of buildCandidates(opts)) {
    const found = findPackageRootSync(candidate);
    if (found) {
      return found;
    }
  }
  return null;
}
