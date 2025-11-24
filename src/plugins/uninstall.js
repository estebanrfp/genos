import fs from "node:fs/promises";
import path from "node:path";
import { resolvePluginInstallDir } from "./install.js";
import { defaultSlotIdForKey } from "./slots.js";
export function resolveUninstallDirectoryTarget(params) {
  if (!params.hasInstall) {
    return null;
  }
  if (params.installRecord?.source === "path") {
    return null;
  }
  let defaultPath;
  try {
    defaultPath = resolvePluginInstallDir(params.pluginId, params.extensionsDir);
  } catch {
    return null;
  }
  const configuredPath = params.installRecord?.installPath;
  if (!configuredPath) {
    return defaultPath;
  }
  if (path.resolve(configuredPath) === path.resolve(defaultPath)) {
    return configuredPath;
  }
  return defaultPath;
}
export function removePluginFromConfig(cfg, pluginId) {
  const actions = {
    entry: false,
    install: false,
    allowlist: false,
    loadPath: false,
    memorySlot: false,
  };
  const pluginsConfig = cfg.plugins ?? {};
  let entries = pluginsConfig.entries;
  if (entries && pluginId in entries) {
    const { [pluginId]: _, ...rest } = entries;
    entries = Object.keys(rest).length > 0 ? rest : undefined;
    actions.entry = true;
  }
  let installs = pluginsConfig.installs;
  const installRecord = installs?.[pluginId];
  if (installs && pluginId in installs) {
    const { [pluginId]: _, ...rest } = installs;
    installs = Object.keys(rest).length > 0 ? rest : undefined;
    actions.install = true;
  }
  let allow = pluginsConfig.allow;
  if (Array.isArray(allow) && allow.includes(pluginId)) {
    allow = allow.filter((id) => id !== pluginId);
    if (allow.length === 0) {
      allow = undefined;
    }
    actions.allowlist = true;
  }
  let load = pluginsConfig.load;
  if (installRecord?.source === "path" && installRecord.sourcePath) {
    const sourcePath = installRecord.sourcePath;
    const loadPaths = load?.paths;
    if (Array.isArray(loadPaths) && loadPaths.includes(sourcePath)) {
      const nextLoadPaths = loadPaths.filter((p) => p !== sourcePath);
      load = nextLoadPaths.length > 0 ? { ...load, paths: nextLoadPaths } : undefined;
      actions.loadPath = true;
    }
  }
  let slots = pluginsConfig.slots;
  if (slots?.memory === pluginId) {
    slots = {
      ...slots,
      memory: defaultSlotIdForKey("memory"),
    };
    actions.memorySlot = true;
  }
  if (slots && Object.keys(slots).length === 0) {
    slots = undefined;
  }
  const newPlugins = {
    ...pluginsConfig,
    entries,
    installs,
    allow,
    load,
    slots,
  };
  const cleanedPlugins = { ...newPlugins };
  if (cleanedPlugins.entries === undefined) {
    delete cleanedPlugins.entries;
  }
  if (cleanedPlugins.installs === undefined) {
    delete cleanedPlugins.installs;
  }
  if (cleanedPlugins.allow === undefined) {
    delete cleanedPlugins.allow;
  }
  if (cleanedPlugins.load === undefined) {
    delete cleanedPlugins.load;
  }
  if (cleanedPlugins.slots === undefined) {
    delete cleanedPlugins.slots;
  }
  const config = {
    ...cfg,
    plugins: Object.keys(cleanedPlugins).length > 0 ? cleanedPlugins : undefined,
  };
  return { config, actions };
}
export async function uninstallPlugin(params) {
  const { config, pluginId, deleteFiles = true, extensionsDir } = params;
  const hasEntry = pluginId in (config.plugins?.entries ?? {});
  const hasInstall = pluginId in (config.plugins?.installs ?? {});
  if (!hasEntry && !hasInstall) {
    return { ok: false, error: `Plugin not found: ${pluginId}` };
  }
  const installRecord = config.plugins?.installs?.[pluginId];
  const isLinked = installRecord?.source === "path";
  const { config: newConfig, actions: configActions } = removePluginFromConfig(config, pluginId);
  const actions = {
    ...configActions,
    directory: false,
  };
  const warnings = [];
  const deleteTarget =
    deleteFiles && !isLinked
      ? resolveUninstallDirectoryTarget({
          pluginId,
          hasInstall,
          installRecord,
          extensionsDir,
        })
      : null;
  if (deleteTarget) {
    const existed =
      (await fs
        .access(deleteTarget)
        .then(() => true)
        .catch(() => false)) ?? false;
    try {
      await fs.rm(deleteTarget, { recursive: true, force: true });
      actions.directory = existed;
    } catch (error) {
      warnings.push(
        `Failed to remove plugin directory ${deleteTarget}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    ok: true,
    config: newConfig,
    pluginId,
    actions,
    warnings,
  };
}
