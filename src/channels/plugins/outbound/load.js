let ensureCacheForRegistry = function (registry) {
  if (registry === lastRegistry) {
    return;
  }
  cache.clear();
  lastRegistry = registry;
};
import { getActivePluginRegistry } from "../../../plugins/runtime.js";
const cache = new Map();
let lastRegistry = null;
export async function loadChannelOutboundAdapter(id) {
  const registry = getActivePluginRegistry();
  ensureCacheForRegistry(registry);
  const cached = cache.get(id);
  if (cached) {
    return cached;
  }
  const pluginEntry = registry?.channels.find((entry) => entry.plugin.id === id);
  const outbound = pluginEntry?.plugin.outbound;
  if (outbound) {
    cache.set(id, outbound);
    return outbound;
  }
  return;
}
