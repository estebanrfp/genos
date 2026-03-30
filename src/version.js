import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let readVersionFromJsonCandidates = function (moduleUrl, candidates, opts = {}) {
    const baseDir = path.dirname(fileURLToPath(moduleUrl));
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.resolve(baseDir, candidate), "utf-8"));
        const version = parsed.version?.trim();
        if (!version) {
          continue;
        }
        if (opts.requirePackageName && parsed.name !== CORE_PACKAGE_NAME) {
          continue;
        }
        return version;
      } catch {}
    }
    return null;
  },
  firstNonEmpty = function (...values) {
    for (const value of values) {
      const trimmed = value?.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return;
  };
const CORE_PACKAGE_NAME = "genosos";
const PACKAGE_JSON_CANDIDATES = [
  "../package.json",
  "../../package.json",
  "../../../package.json",
  "./package.json",
];
const BUILD_INFO_CANDIDATES = ["../build-info.json", "../../build-info.json", "./build-info.json"];
export function readVersionFromPackageJsonForModuleUrl(moduleUrl) {
  return readVersionFromJsonCandidates(moduleUrl, PACKAGE_JSON_CANDIDATES, {
    requirePackageName: true,
  });
}
export function readVersionFromBuildInfoForModuleUrl(moduleUrl) {
  return readVersionFromJsonCandidates(moduleUrl, BUILD_INFO_CANDIDATES);
}
export function resolveVersionFromModuleUrl(moduleUrl) {
  return (
    readVersionFromPackageJsonForModuleUrl(moduleUrl) ||
    readVersionFromBuildInfoForModuleUrl(moduleUrl)
  );
}
export function resolveRuntimeServiceVersion(env = process.env, fallback = "dev") {
  return (
    firstNonEmpty(env["GENOS_VERSION"], env["GENOS_SERVICE_VERSION"], env["npm_package_version"]) ??
    fallback
  );
}
export const VERSION =
  (typeof __GENOS_VERSION__ === "string" && __GENOS_VERSION__) ||
  process.env.GENOS_BUNDLED_VERSION ||
  resolveVersionFromModuleUrl(import.meta.url) ||
  "0.0.0";
