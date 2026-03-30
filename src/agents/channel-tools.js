let runPluginListActions = function (plugin, cfg) {
    if (!plugin.actions?.listActions) {
      return [];
    }
    try {
      const listed = plugin.actions.listActions({ cfg });
      return Array.isArray(listed) ? listed : [];
    } catch (err) {
      logListActionsError(plugin.id, err);
      return [];
    }
  },
  logListActionsError = function (pluginId, err) {
    const message = err instanceof Error ? err.message : String(err);
    const key = `${pluginId}:${message}`;
    if (loggedListActionErrors.has(key)) {
      return;
    }
    loggedListActionErrors.add(key);
    const stack = err instanceof Error && err.stack ? err.stack : null;
    const details = stack ?? message;
    defaultRuntime.error?.(`[channel-tools] ${pluginId}.actions.listActions failed: ${details}`);
  };
import { getChannelDock } from "../channels/dock.js";
import { getChannelPlugin, listChannelPlugins } from "../channels/plugins/index.js";
import { normalizeAnyChannelId } from "../channels/registry.js";
import { defaultRuntime } from "../runtime.js";
export function listChannelSupportedActions(params) {
  if (!params.channel) {
    return [];
  }
  const plugin = getChannelPlugin(params.channel);
  if (!plugin?.actions?.listActions) {
    return [];
  }
  const cfg = params.cfg ?? {};
  return runPluginListActions(plugin, cfg);
}
export function listAllChannelSupportedActions(params) {
  const actions = new Set();
  for (const plugin of listChannelPlugins()) {
    if (!plugin.actions?.listActions) {
      continue;
    }
    const cfg = params.cfg ?? {};
    const channelActions = runPluginListActions(plugin, cfg);
    for (const action of channelActions) {
      actions.add(action);
    }
  }
  return Array.from(actions);
}
export function listChannelAgentTools(params) {
  const tools = [];
  for (const plugin of listChannelPlugins()) {
    const entry = plugin.agentTools;
    if (!entry) {
      continue;
    }
    const resolved = typeof entry === "function" ? entry(params) : entry;
    if (Array.isArray(resolved)) {
      tools.push(...resolved);
    }
  }
  return tools;
}
export function resolveChannelMessageToolHints(params) {
  const channelId = normalizeAnyChannelId(params.channel);
  if (!channelId) {
    return [];
  }
  const dock = getChannelDock(channelId);
  const resolve = dock?.agentPrompt?.messageToolHints;
  if (!resolve) {
    return [];
  }
  const cfg = params.cfg ?? {};
  return (resolve({ cfg, accountId: params.accountId }) ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
}
const loggedListActionErrors = new Set();
export const __testing = {
  resetLoggedListActionErrors() {
    loggedListActionErrors.clear();
  },
};
