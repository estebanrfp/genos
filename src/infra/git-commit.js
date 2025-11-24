import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGitHeadPath } from "./git-root.js";
const formatCommit = (value) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readJsonSafe = (relPath) => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, relPath), "utf-8"));
  } catch {
    return null;
  }
};
let cachedCommit;
const readCommitFromPackageJson = () => {
  const pkg = readJsonSafe("../../package.json");
  return formatCommit(pkg?.gitHead ?? pkg?.githead ?? null);
};
const readCommitFromBuildInfo = () => {
  for (const candidate of ["../build-info.json", "./build-info.json"]) {
    const info = readJsonSafe(candidate);
    const formatted = formatCommit(info?.commit ?? null);
    if (formatted) {
      return formatted;
    }
  }
  return null;
};
export const resolveCommitHash = (options = {}) => {
  if (cachedCommit !== undefined) {
    return cachedCommit;
  }
  const env = options.env ?? process.env;
  const envCommit = env.GIT_COMMIT?.trim() || env.GIT_SHA?.trim();
  const normalized = formatCommit(envCommit);
  if (normalized) {
    cachedCommit = normalized;
    return cachedCommit;
  }
  const buildInfoCommit = readCommitFromBuildInfo();
  if (buildInfoCommit) {
    cachedCommit = buildInfoCommit;
    return cachedCommit;
  }
  const pkgCommit = readCommitFromPackageJson();
  if (pkgCommit) {
    cachedCommit = pkgCommit;
    return cachedCommit;
  }
  try {
    const headPath = resolveGitHeadPath(options.cwd ?? process.cwd());
    if (!headPath) {
      cachedCommit = null;
      return cachedCommit;
    }
    const head = fs.readFileSync(headPath, "utf-8").trim();
    if (!head) {
      cachedCommit = null;
      return cachedCommit;
    }
    if (head.startsWith("ref:")) {
      const ref = head.replace(/^ref:\s*/i, "").trim();
      const refPath = path.resolve(path.dirname(headPath), ref);
      const refHash = fs.readFileSync(refPath, "utf-8").trim();
      cachedCommit = formatCommit(refHash);
      return cachedCommit;
    }
    cachedCommit = formatCommit(head);
    return cachedCommit;
  } catch {
    cachedCommit = null;
    return cachedCommit;
  }
};
