import { createSubsystemLogger } from "../logging/subsystem.js";
import { loadGenosOSPlugins } from "./loader.js";
import { createPluginLoaderLogger } from "./logger.js";
const log = createSubsystemLogger("plugins");
export function resolvePluginProviders(params) {
  const registry = loadGenosOSPlugins({
    config: params.config,
    workspaceDir: params.workspaceDir,
    logger: createPluginLoaderLogger(log),
  });
  return registry.providers.map((entry) => entry.provider);
}
