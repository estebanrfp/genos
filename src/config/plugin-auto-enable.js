let hasNonEmptyString = function (value) {
    return typeof value === "string" && value.trim().length > 0;
  },
  recordHasKeys = function (value) {
    return isRecord(value) && Object.keys(value).length > 0;
  },
  accountsHaveKeys = function (value, keys) {
    if (!isRecord(value)) {
      return false;
    }
    for (const account of Object.values(value)) {
      if (!isRecord(account)) {
        continue;
      }
      for (const key of keys) {
        if (hasNonEmptyString(account[key])) {
          return true;
        }
      }
    }
    return false;
  },
  resolveChannelConfig = function (cfg, channelId) {
    const channels = cfg.channels;
    const entry = channels?.[channelId];
    return isRecord(entry) ? entry : null;
  },
  isTelegramConfigured = function (cfg, env) {
    if (hasNonEmptyString(env.TELEGRAM_BOT_TOKEN)) {
      return true;
    }
    const entry = resolveChannelConfig(cfg, "telegram");
    if (!entry) {
      return false;
    }
    if (hasNonEmptyString(entry.botToken) || hasNonEmptyString(entry.tokenFile)) {
      return true;
    }
    if (accountsHaveKeys(entry.accounts, ["botToken", "tokenFile"])) {
      return true;
    }
    return recordHasKeys(entry);
  },
  isDiscordConfigured = function (cfg, env) {
    if (hasNonEmptyString(env.DISCORD_BOT_TOKEN)) {
      return true;
    }
    const entry = resolveChannelConfig(cfg, "discord");
    if (!entry) {
      return false;
    }
    if (hasNonEmptyString(entry.token)) {
      return true;
    }
    if (accountsHaveKeys(entry.accounts, ["token"])) {
      return true;
    }
    return recordHasKeys(entry);
  },
  isSlackConfigured = function (cfg, env) {
    if (
      hasNonEmptyString(env.SLACK_BOT_TOKEN) ||
      hasNonEmptyString(env.SLACK_APP_TOKEN) ||
      hasNonEmptyString(env.SLACK_USER_TOKEN)
    ) {
      return true;
    }
    const entry = resolveChannelConfig(cfg, "slack");
    if (!entry) {
      return false;
    }
    if (
      hasNonEmptyString(entry.botToken) ||
      hasNonEmptyString(entry.appToken) ||
      hasNonEmptyString(entry.userToken)
    ) {
      return true;
    }
    if (accountsHaveKeys(entry.accounts, ["botToken", "appToken", "userToken"])) {
      return true;
    }
    return recordHasKeys(entry);
  },
  isSignalConfigured = function (cfg) {
    const entry = resolveChannelConfig(cfg, "signal");
    if (!entry) {
      return false;
    }
    if (
      hasNonEmptyString(entry.account) ||
      hasNonEmptyString(entry.httpUrl) ||
      hasNonEmptyString(entry.httpHost) ||
      typeof entry.httpPort === "number" ||
      hasNonEmptyString(entry.cliPath)
    ) {
      return true;
    }
    if (accountsHaveKeys(entry.accounts, ["account", "httpUrl", "httpHost", "cliPath"])) {
      return true;
    }
    return recordHasKeys(entry);
  },
  isIMessageConfigured = function (cfg) {
    const entry = resolveChannelConfig(cfg, "imessage");
    if (!entry) {
      return false;
    }
    if (hasNonEmptyString(entry.cliPath)) {
      return true;
    }
    return recordHasKeys(entry);
  },
  isWhatsAppConfigured = function (cfg) {
    if (hasAnyWhatsAppAuth(cfg)) {
      return true;
    }
    const entry = resolveChannelConfig(cfg, "whatsapp");
    if (!entry) {
      return false;
    }
    return recordHasKeys(entry);
  },
  isGenericChannelConfigured = function (cfg, channelId) {
    const entry = resolveChannelConfig(cfg, channelId);
    return recordHasKeys(entry);
  },
  collectModelRefs = function (cfg) {
    const refs = [];
    const pushModelRef = (value) => {
      if (typeof value === "string" && value.trim()) {
        refs.push(value.trim());
      }
    };
    const collectFromAgent = (agent) => {
      if (!agent) {
        return;
      }
      const model = agent.model;
      if (typeof model === "string") {
        pushModelRef(model);
      } else if (isRecord(model)) {
        pushModelRef(model.primary);
        const fallbacks = model.fallbacks;
        if (Array.isArray(fallbacks)) {
          for (const entry of fallbacks) {
            pushModelRef(entry);
          }
        }
      }
      const models = agent.models;
      if (isRecord(models)) {
        for (const key of Object.keys(models)) {
          pushModelRef(key);
        }
      }
    };
    const defaults = cfg.agents?.defaults;
    collectFromAgent(defaults);
    const list = cfg.agents?.list;
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (isRecord(entry)) {
          collectFromAgent(entry);
        }
      }
    }
    return refs;
  },
  extractProviderFromModelRef = function (value) {
    const trimmed = value.trim();
    const slash = trimmed.indexOf("/");
    if (slash <= 0) {
      return null;
    }
    return normalizeProviderId(trimmed.slice(0, slash));
  },
  isProviderConfigured = function (cfg, providerId) {
    const normalized = normalizeProviderId(providerId);
    const profiles = cfg.auth?.profiles;
    if (profiles && typeof profiles === "object") {
      for (const profile of Object.values(profiles)) {
        if (!isRecord(profile)) {
          continue;
        }
        const provider = normalizeProviderId(String(profile.provider ?? ""));
        if (provider === normalized) {
          return true;
        }
      }
    }
    const providerConfig = cfg.models?.providers;
    if (providerConfig && typeof providerConfig === "object") {
      for (const key of Object.keys(providerConfig)) {
        if (normalizeProviderId(key) === normalized) {
          return true;
        }
      }
    }
    const modelRefs = collectModelRefs(cfg);
    for (const ref of modelRefs) {
      const provider = extractProviderFromModelRef(ref);
      if (provider && provider === normalized) {
        return true;
      }
    }
    return false;
  },
  resolveConfiguredPlugins = function (cfg, env) {
    const changes = [];
    const channelIds = new Set(CHANNEL_PLUGIN_IDS);
    const configuredChannels = cfg.channels;
    if (configuredChannels && typeof configuredChannels === "object") {
      for (const key of Object.keys(configuredChannels)) {
        if (key === "defaults") {
          continue;
        }
        channelIds.add(key);
      }
    }
    for (const channelId of channelIds) {
      if (!channelId) {
        continue;
      }
      if (isChannelConfigured(cfg, channelId, env)) {
        changes.push({
          pluginId: channelId,
          reason: `${channelId} configured`,
        });
      }
    }
    for (const mapping of PROVIDER_PLUGIN_IDS) {
      if (isProviderConfigured(cfg, mapping.providerId)) {
        changes.push({
          pluginId: mapping.pluginId,
          reason: `${mapping.providerId} auth configured`,
        });
      }
    }
    return changes;
  },
  isPluginExplicitlyDisabled = function (cfg, pluginId) {
    const entry = cfg.plugins?.entries?.[pluginId];
    return entry?.enabled === false;
  },
  isPluginDenied = function (cfg, pluginId) {
    const deny = cfg.plugins?.deny;
    return Array.isArray(deny) && deny.includes(pluginId);
  },
  resolvePreferredOverIds = function (pluginId) {
    const normalized = normalizeChatChannelId(pluginId);
    if (normalized) {
      return getChatChannelMeta(normalized).preferOver ?? [];
    }
    const catalogEntry = getChannelPluginCatalogEntry(pluginId);
    return catalogEntry?.meta.preferOver ?? [];
  },
  shouldSkipPreferredPluginAutoEnable = function (cfg, entry, configured) {
    for (const other of configured) {
      if (other.pluginId === entry.pluginId) {
        continue;
      }
      if (isPluginDenied(cfg, other.pluginId)) {
        continue;
      }
      if (isPluginExplicitlyDisabled(cfg, other.pluginId)) {
        continue;
      }
      const preferOver = resolvePreferredOverIds(other.pluginId);
      if (preferOver.includes(entry.pluginId)) {
        return true;
      }
    }
    return false;
  },
  registerPluginEntry = function (cfg, pluginId) {
    const entries = {
      ...cfg.plugins?.entries,
      [pluginId]: {
        ...cfg.plugins?.entries?.[pluginId],
        enabled: true,
      },
    };
    return {
      ...cfg,
      plugins: {
        ...cfg.plugins,
        entries,
      },
    };
  },
  formatAutoEnableChange = function (entry) {
    let reason = entry.reason.trim();
    const channelId = normalizeChatChannelId(entry.pluginId);
    if (channelId) {
      const label = getChatChannelMeta(channelId).label;
      reason = reason.replace(new RegExp(`^${channelId}\\b`, "i"), label);
    }
    return `${reason}, enabled automatically.`;
  };
import { normalizeProviderId } from "../agents/model-selection.js";
import {
  getChannelPluginCatalogEntry,
  listChannelPluginCatalogEntries,
} from "../channels/plugins/catalog.js";
import {
  getChatChannelMeta,
  listChatChannels,
  normalizeChatChannelId,
} from "../channels/registry.js";
import { isRecord } from "../utils.js";
import { hasAnyWhatsAppAuth } from "../web/accounts.js";
import { ensurePluginAllowlisted } from "./plugins-allowlist.js";
const CHANNEL_PLUGIN_IDS = Array.from(
  new Set([
    ...listChatChannels().map((meta) => meta.id),
    ...listChannelPluginCatalogEntries().map((entry) => entry.id),
  ]),
);
const PROVIDER_PLUGIN_IDS = [
  { pluginId: "google-antigravity-auth", providerId: "google-antigravity" },
  { pluginId: "google-gemini-cli-auth", providerId: "google-gemini-cli" },
  { pluginId: "qwen-portal-auth", providerId: "qwen-portal" },
  { pluginId: "copilot-proxy", providerId: "copilot-proxy" },
  { pluginId: "minimax-portal-auth", providerId: "minimax-portal" },
];
export function isChannelConfigured(cfg, channelId, env = process.env) {
  switch (channelId) {
    case "whatsapp":
      return isWhatsAppConfigured(cfg);
    case "telegram":
      return isTelegramConfigured(cfg, env);
    case "discord":
      return isDiscordConfigured(cfg, env);
    case "slack":
      return isSlackConfigured(cfg, env);
    case "signal":
      return isSignalConfigured(cfg);
    case "imessage":
      return isIMessageConfigured(cfg);
    default:
      return isGenericChannelConfigured(cfg, channelId);
  }
}
export function applyPluginAutoEnable(params) {
  const env = params.env ?? process.env;
  const configured = resolveConfiguredPlugins(params.config, env);
  if (configured.length === 0) {
    return { config: params.config, changes: [] };
  }
  let next = params.config;
  const changes = [];
  if (next.plugins?.enabled === false) {
    return { config: next, changes };
  }
  for (const entry of configured) {
    if (isPluginDenied(next, entry.pluginId)) {
      continue;
    }
    if (isPluginExplicitlyDisabled(next, entry.pluginId)) {
      continue;
    }
    if (shouldSkipPreferredPluginAutoEnable(next, entry, configured)) {
      continue;
    }
    const allow = next.plugins?.allow;
    const allowMissing = Array.isArray(allow) && !allow.includes(entry.pluginId);
    const alreadyEnabled = next.plugins?.entries?.[entry.pluginId]?.enabled === true;
    if (alreadyEnabled && !allowMissing) {
      continue;
    }
    next = registerPluginEntry(next, entry.pluginId);
    next = ensurePluginAllowlisted(next, entry.pluginId);
    changes.push(formatAutoEnableChange(entry));
  }
  return { config: next, changes };
}
