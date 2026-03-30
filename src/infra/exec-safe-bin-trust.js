let normalizeTrustedDir = function (value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return path.resolve(trimmed);
  },
  buildTrustedSafeBinCacheKey = function (pathEnv, delimiter) {
    return `${delimiter}\0${pathEnv}`;
  };
import path from "node:path";
const DEFAULT_SAFE_BIN_TRUSTED_DIRS = [
  "/bin",
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/opt/local/bin",
  "/snap/bin",
  "/run/current-system/sw/bin",
];
let trustedSafeBinCache = null;
export function buildTrustedSafeBinDirs(params = {}) {
  const delimiter = params.delimiter ?? path.delimiter;
  const pathEnv = params.pathEnv ?? "";
  const baseDirs = params.baseDirs ?? DEFAULT_SAFE_BIN_TRUSTED_DIRS;
  const trusted = new Set();
  for (const entry of baseDirs) {
    const normalized = normalizeTrustedDir(entry);
    if (normalized) {
      trusted.add(normalized);
    }
  }
  const pathEntries = pathEnv
    .split(delimiter)
    .map((entry) => normalizeTrustedDir(entry))
    .filter((entry) => Boolean(entry));
  for (const entry of pathEntries) {
    trusted.add(entry);
  }
  return trusted;
}
export function getTrustedSafeBinDirs(params = {}) {
  const delimiter = params.delimiter ?? path.delimiter;
  const pathEnv = params.pathEnv ?? process.env.PATH ?? process.env.Path ?? "";
  const key = buildTrustedSafeBinCacheKey(pathEnv, delimiter);
  if (!params.refresh && trustedSafeBinCache?.key === key) {
    return trustedSafeBinCache.dirs;
  }
  const dirs = buildTrustedSafeBinDirs({
    pathEnv,
    delimiter,
  });
  trustedSafeBinCache = { key, dirs };
  return dirs;
}
export function isTrustedSafeBinPath(params) {
  const trustedDirs =
    params.trustedDirs ??
    getTrustedSafeBinDirs({
      pathEnv: params.pathEnv,
      delimiter: params.delimiter,
    });
  const resolvedDir = path.dirname(path.resolve(params.resolvedPath));
  return trustedDirs.has(resolvedDir);
}
