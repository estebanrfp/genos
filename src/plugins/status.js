import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { loadGenosOSPlugins } from "./loader.js";
import { createPluginLoaderLogger } from "./logger.js";
const log = createSubsystemLogger("plugins");
export function buildPluginStatusReport(params) {
  const config = params?.config ?? loadConfig();
  const workspaceDir = params?.workspaceDir
    ? params.workspaceDir
    : (resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config)) ??
      resolveDefaultAgentWorkspaceDir());
  const registry = loadGenosOSPlugins({
    config,
    workspaceDir,
    logger: createPluginLoaderLogger(log),
  });
  return {
    workspaceDir,
    ...registry,
  };
}
