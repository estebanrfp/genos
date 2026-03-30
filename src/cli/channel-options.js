let dedupe = function (values) {
  const seen = new Set();
  const resolved = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    resolved.push(value);
  }
  return resolved;
};
import { listChannelPluginCatalogEntries } from "../channels/plugins/catalog.js";
import { listChannelPlugins } from "../channels/plugins/index.js";
import { CHAT_CHANNEL_ORDER } from "../channels/registry.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { ensurePluginRegistryLoaded } from "./plugin-registry.js";
export function resolveCliChannelOptions() {
  const catalog = listChannelPluginCatalogEntries().map((entry) => entry.id);
  const base = dedupe([...CHAT_CHANNEL_ORDER, ...catalog]);
  if (isTruthyEnvValue(process.env.GENOS_EAGER_CHANNEL_OPTIONS)) {
    ensurePluginRegistryLoaded();
    const pluginIds = listChannelPlugins().map((plugin) => plugin.id);
    return dedupe([...base, ...pluginIds]);
  }
  return base;
}
export function formatCliChannelOptions(extra = []) {
  return [...extra, ...resolveCliChannelOptions()].join("|");
}
