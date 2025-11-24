let ensureCacheForRegistry = function (registry) {
  if (registry === lastRegistry) {
    return;
  }
  cache.clear();
  lastRegistry = registry;
};
import { getActivePluginRegistry } from "../../plugins/runtime.js";
const cache = new Map();
let lastRegistry = null;
export async function loadChannelPlugin(id) {
  const registry = getActivePluginRegistry();
  ensureCacheForRegistry(registry);
  const cached = cache.get(id);
  if (cached) {
    return cached;
  }
  const pluginEntry = registry?.channels.find((entry) => entry.plugin.id === id);
  if (pluginEntry) {
    cache.set(id, pluginEntry.plugin);
    return pluginEntry.plugin;
  }
  return;
}
