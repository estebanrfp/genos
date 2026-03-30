import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging.js";
import { loadGenosOSPlugins } from "../plugins/loader.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
const log = createSubsystemLogger("plugins");
let pluginRegistryLoaded = false;
export function ensurePluginRegistryLoaded() {
  if (pluginRegistryLoaded) {
    return;
  }
  const active = getActivePluginRegistry();
  if (
    active &&
    (active.plugins.length > 0 || active.channels.length > 0 || active.tools.length > 0)
  ) {
    pluginRegistryLoaded = true;
    return;
  }
  const config = loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  const logger = {
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
    debug: (msg) => log.debug(msg),
  };
  loadGenosOSPlugins({
    config,
    workspaceDir,
    logger,
  });
  pluginRegistryLoaded = true;
}
