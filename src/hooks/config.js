import {
  evaluateRuntimeRequires,
  hasBinary,
  isConfigPathTruthyWithDefaults,
  resolveConfigPath,
  resolveRuntimePlatform,
} from "../shared/config-eval.js";
import { resolveHookKey } from "./frontmatter.js";
const DEFAULT_CONFIG_VALUES = {
  "browser.enabled": true,
  "browser.evaluateEnabled": true,
  "workspace.dir": true,
};

export { hasBinary, resolveConfigPath, resolveRuntimePlatform };
export function isConfigPathTruthy(config, pathStr) {
  return isConfigPathTruthyWithDefaults(config, pathStr, DEFAULT_CONFIG_VALUES);
}
export function resolveHookConfig(config, hookKey) {
  const hooks = config?.hooks?.internal?.entries;
  if (!hooks || typeof hooks !== "object") {
    return;
  }
  const entry = hooks[hookKey];
  if (!entry || typeof entry !== "object") {
    return;
  }
  return entry;
}
export function shouldIncludeHook(params) {
  const { entry, config, eligibility } = params;
  const hookKey = resolveHookKey(entry.hook.name, entry);
  const hookConfig = resolveHookConfig(config, hookKey);
  const pluginManaged = entry.hook.source === "genosos-plugin";
  const osList = entry.metadata?.os ?? [];
  const remotePlatforms = eligibility?.remote?.platforms ?? [];
  if (!pluginManaged && hookConfig?.enabled === false) {
    return false;
  }
  if (
    osList.length > 0 &&
    !osList.includes(resolveRuntimePlatform()) &&
    !remotePlatforms.some((platform) => osList.includes(platform))
  ) {
    return false;
  }
  if (entry.metadata?.always === true) {
    return true;
  }
  return evaluateRuntimeRequires({
    requires: entry.metadata?.requires,
    hasBin: hasBinary,
    hasRemoteBin: eligibility?.remote?.hasBin,
    hasAnyRemoteBin: eligibility?.remote?.hasAnyBin,
    hasEnv: (envName) => Boolean(process.env[envName] || hookConfig?.env?.[envName]),
    isConfigPathTruthy: (configPath) => isConfigPathTruthy(config, configPath),
  });
}
