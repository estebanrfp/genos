let safeRealpathSync = function (rootDir, cache) {
    const cached = cache.get(rootDir);
    if (cached) {
      return cached;
    }
    try {
      const resolved = fs.realpathSync(rootDir);
      cache.set(rootDir, resolved);
      return resolved;
    } catch {
      return null;
    }
  },
  resolveManifestCacheMs = function (env) {
    const raw = env.GENOS_PLUGIN_MANIFEST_CACHE_MS?.trim();
    if (raw === "" || raw === "0") {
      return 0;
    }
    if (!raw) {
      return DEFAULT_MANIFEST_CACHE_MS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_MANIFEST_CACHE_MS;
    }
    return Math.max(0, parsed);
  },
  shouldUseManifestCache = function (env) {
    const disabled = env.GENOS_DISABLE_PLUGIN_MANIFEST_CACHE?.trim();
    if (disabled) {
      return false;
    }
    return resolveManifestCacheMs(env) > 0;
  },
  buildCacheKey = function (params) {
    const workspaceKey = params.workspaceDir ? resolveUserPath(params.workspaceDir) : "";
    const loadPaths = params.plugins.loadPaths
      .map((p) => resolveUserPath(p))
      .map((p) => p.trim())
      .filter(Boolean)
      .toSorted();
    return `${workspaceKey}::${JSON.stringify(loadPaths)}`;
  },
  safeStatMtimeMs = function (filePath) {
    try {
      return fs.statSync(filePath).mtimeMs;
    } catch {
      return null;
    }
  },
  normalizeManifestLabel = function (raw) {
    const trimmed = raw?.trim();
    return trimmed ? trimmed : undefined;
  },
  buildRecord = function (params) {
    return {
      id: params.manifest.id,
      name: normalizeManifestLabel(params.manifest.name) ?? params.candidate.packageName,
      description:
        normalizeManifestLabel(params.manifest.description) ?? params.candidate.packageDescription,
      version: normalizeManifestLabel(params.manifest.version) ?? params.candidate.packageVersion,
      kind: params.manifest.kind,
      channels: params.manifest.channels ?? [],
      providers: params.manifest.providers ?? [],
      skills: params.manifest.skills ?? [],
      origin: params.candidate.origin,
      workspaceDir: params.candidate.workspaceDir,
      rootDir: params.candidate.rootDir,
      source: params.candidate.source,
      manifestPath: params.manifestPath,
      schemaCacheKey: params.schemaCacheKey,
      configSchema: params.configSchema,
      configUiHints: params.manifest.uiHints,
    };
  };
import fs from "node:fs";
import { resolveUserPath } from "../utils.js";
import { normalizePluginsConfig } from "./config-state.js";
import { discoverGenosOSPlugins } from "./discovery.js";
import { loadPluginManifest } from "./manifest.js";
const PLUGIN_ORIGIN_RANK = {
  config: 0,
  workspace: 1,
  global: 2,
  bundled: 3,
};
const registryCache = new Map();
const DEFAULT_MANIFEST_CACHE_MS = 200;
export function clearPluginManifestRegistryCache() {
  registryCache.clear();
}
export function loadPluginManifestRegistry(params) {
  const config = params.config ?? {};
  const normalized = normalizePluginsConfig(config.plugins);
  const cacheKey = buildCacheKey({ workspaceDir: params.workspaceDir, plugins: normalized });
  const env = params.env ?? process.env;
  const cacheEnabled = params.cache !== false && shouldUseManifestCache(env);
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.registry;
    }
  }
  const discovery = params.candidates
    ? {
        candidates: params.candidates,
        diagnostics: params.diagnostics ?? [],
      }
    : discoverGenosOSPlugins({
        workspaceDir: params.workspaceDir,
        extraPaths: normalized.loadPaths,
      });
  const diagnostics = [...discovery.diagnostics];
  const candidates = discovery.candidates;
  const records = [];
  const seenIds = new Map();
  const realpathCache = new Map();
  for (const candidate of candidates) {
    const manifestRes = loadPluginManifest(candidate.rootDir);
    if (!manifestRes.ok) {
      diagnostics.push({
        level: "error",
        message: manifestRes.error,
        source: manifestRes.manifestPath,
      });
      continue;
    }
    const manifest = manifestRes.manifest;
    if (candidate.idHint && candidate.idHint !== manifest.id) {
      diagnostics.push({
        level: "warn",
        pluginId: manifest.id,
        source: candidate.source,
        message: `plugin id mismatch (manifest uses "${manifest.id}", entry hints "${candidate.idHint}")`,
      });
    }
    const configSchema = manifest.configSchema;
    const manifestMtime = safeStatMtimeMs(manifestRes.manifestPath);
    const schemaCacheKey = manifestMtime
      ? `${manifestRes.manifestPath}:${manifestMtime}`
      : manifestRes.manifestPath;
    const existing = seenIds.get(manifest.id);
    if (existing) {
      const existingReal = safeRealpathSync(existing.candidate.rootDir, realpathCache);
      const candidateReal = safeRealpathSync(candidate.rootDir, realpathCache);
      const samePlugin = Boolean(existingReal && candidateReal && existingReal === candidateReal);
      if (samePlugin) {
        if (PLUGIN_ORIGIN_RANK[candidate.origin] < PLUGIN_ORIGIN_RANK[existing.candidate.origin]) {
          records[existing.recordIndex] = buildRecord({
            manifest,
            candidate,
            manifestPath: manifestRes.manifestPath,
            schemaCacheKey,
            configSchema,
          });
          seenIds.set(manifest.id, { candidate, recordIndex: existing.recordIndex });
        }
        continue;
      }
      diagnostics.push({
        level: "warn",
        pluginId: manifest.id,
        source: candidate.source,
        message: `duplicate plugin id detected; later plugin may be overridden (${candidate.source})`,
      });
    } else {
      seenIds.set(manifest.id, { candidate, recordIndex: records.length });
    }
    records.push(
      buildRecord({
        manifest,
        candidate,
        manifestPath: manifestRes.manifestPath,
        schemaCacheKey,
        configSchema,
      }),
    );
  }
  const registry = { plugins: records, diagnostics };
  if (cacheEnabled) {
    const ttl = resolveManifestCacheMs(env);
    if (ttl > 0) {
      registryCache.set(cacheKey, { expiresAt: Date.now() + ttl, registry });
    }
  }
  return registry;
}
