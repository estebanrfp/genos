let cloneSchema = function (value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  },
  asSchemaObject = function (value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  },
  isObjectSchema = function (schema) {
    const type = schema.type;
    if (type === "object") {
      return true;
    }
    if (Array.isArray(type) && type.includes("object")) {
      return true;
    }
    return Boolean(schema.properties || schema.additionalProperties);
  },
  mergeObjectSchema = function (base, extension) {
    const mergedRequired = new Set([...(base.required ?? []), ...(extension.required ?? [])]);
    const merged = {
      ...base,
      ...extension,
      properties: {
        ...base.properties,
        ...extension.properties,
      },
    };
    if (mergedRequired.size > 0) {
      merged.required = Array.from(mergedRequired);
    }
    const additional = extension.additionalProperties ?? base.additionalProperties;
    if (additional !== undefined) {
      merged.additionalProperties = additional;
    }
    return merged;
  },
  collectExtensionHintKeys = function (hints, plugins, channels) {
    const pluginPrefixes = plugins
      .map((plugin) => plugin.id.trim())
      .filter(Boolean)
      .map((id) => `plugins.entries.${id}`);
    const channelPrefixes = channels
      .map((channel) => channel.id.trim())
      .filter(Boolean)
      .map((id) => `channels.${id}`);
    const prefixes = [...pluginPrefixes, ...channelPrefixes];
    return new Set(
      Object.keys(hints).filter((key) =>
        prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)),
      ),
    );
  },
  applyPluginHints = function (hints, plugins) {
    const next = { ...hints };
    for (const plugin of plugins) {
      const id = plugin.id.trim();
      if (!id) {
        continue;
      }
      const name = (plugin.name ?? id).trim() || id;
      const basePath = `plugins.entries.${id}`;
      next[basePath] = {
        ...next[basePath],
        label: name,
        help: plugin.description
          ? `${plugin.description} (plugin: ${id})`
          : `Plugin entry for ${id}.`,
      };
      next[`${basePath}.enabled`] = {
        ...next[`${basePath}.enabled`],
        label: `Enable ${name}`,
      };
      next[`${basePath}.config`] = {
        ...next[`${basePath}.config`],
        label: `${name} Config`,
        help: `Plugin-defined config payload for ${id}.`,
      };
      const uiHints = plugin.configUiHints ?? {};
      for (const [relPathRaw, hint] of Object.entries(uiHints)) {
        const relPath = relPathRaw.trim().replace(/^\./, "");
        if (!relPath) {
          continue;
        }
        const key = `${basePath}.config.${relPath}`;
        next[key] = {
          ...next[key],
          ...hint,
        };
      }
    }
    return next;
  },
  applyChannelHints = function (hints, channels) {
    const next = { ...hints };
    for (const channel of channels) {
      const id = channel.id.trim();
      if (!id) {
        continue;
      }
      const basePath = `channels.${id}`;
      const current = next[basePath] ?? {};
      const label = channel.label?.trim();
      const help = channel.description?.trim();
      next[basePath] = {
        ...current,
        ...(label ? { label } : {}),
        ...(help ? { help } : {}),
      };
      const uiHints = channel.configUiHints ?? {};
      for (const [relPathRaw, hint] of Object.entries(uiHints)) {
        const relPath = relPathRaw.trim().replace(/^\./, "");
        if (!relPath) {
          continue;
        }
        const key = `${basePath}.${relPath}`;
        next[key] = {
          ...next[key],
          ...hint,
        };
      }
    }
    return next;
  },
  listHeartbeatTargetChannels = function (channels) {
    const seen = new Set();
    const ordered = [];
    for (const id of CHANNEL_IDS) {
      const normalized = id.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      ordered.push(normalized);
    }
    for (const channel of channels) {
      const normalized = channel.id.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      ordered.push(normalized);
    }
    return ordered;
  },
  applyHeartbeatTargetHints = function (hints, channels) {
    const next = { ...hints };
    const channelList = listHeartbeatTargetChannels(channels);
    const channelHelp = channelList.length ? ` Known channels: ${channelList.join(", ")}.` : "";
    const help = `Delivery target ("last", "none", or a channel id).${channelHelp}`;
    const paths = ["agents.defaults.heartbeat.target", "agents.list.*.heartbeat.target"];
    for (const path of paths) {
      const current = next[path] ?? {};
      next[path] = {
        ...current,
        help: current.help ?? help,
        placeholder: current.placeholder ?? "last",
      };
    }
    return next;
  },
  applyPluginSchemas = function (schema, plugins) {
    const next = cloneSchema(schema);
    const root = asSchemaObject(next);
    const pluginsNode = asSchemaObject(root?.properties?.plugins);
    const entriesNode = asSchemaObject(pluginsNode?.properties?.entries);
    if (!entriesNode) {
      return next;
    }
    const entryBase = asSchemaObject(entriesNode.additionalProperties);
    const entryProperties = entriesNode.properties ?? {};
    entriesNode.properties = entryProperties;
    for (const plugin of plugins) {
      if (!plugin.configSchema) {
        continue;
      }
      const entrySchema = entryBase ? cloneSchema(entryBase) : { type: "object" };
      const entryObject = asSchemaObject(entrySchema) ?? { type: "object" };
      const baseConfigSchema = asSchemaObject(entryObject.properties?.config);
      const pluginSchema = asSchemaObject(plugin.configSchema);
      const nextConfigSchema =
        baseConfigSchema &&
        pluginSchema &&
        isObjectSchema(baseConfigSchema) &&
        isObjectSchema(pluginSchema)
          ? mergeObjectSchema(baseConfigSchema, pluginSchema)
          : cloneSchema(plugin.configSchema);
      entryObject.properties = {
        ...entryObject.properties,
        config: nextConfigSchema,
      };
      entryProperties[plugin.id] = entryObject;
    }
    return next;
  },
  applyChannelSchemas = function (schema, channels) {
    const next = cloneSchema(schema);
    const root = asSchemaObject(next);
    const channelsNode = asSchemaObject(root?.properties?.channels);
    if (!channelsNode) {
      return next;
    }
    const channelProps = channelsNode.properties ?? {};
    channelsNode.properties = channelProps;
    for (const channel of channels) {
      if (!channel.configSchema) {
        continue;
      }
      const existing = asSchemaObject(channelProps[channel.id]);
      const incoming = asSchemaObject(channel.configSchema);
      if (existing && incoming && isObjectSchema(existing) && isObjectSchema(incoming)) {
        channelProps[channel.id] = mergeObjectSchema(existing, incoming);
      } else {
        channelProps[channel.id] = cloneSchema(channel.configSchema);
      }
    }
    return next;
  },
  stripChannelSchema = function (schema) {
    const next = cloneSchema(schema);
    const root = asSchemaObject(next);
    if (!root || !root.properties) {
      return next;
    }
    delete root.properties.$schema;
    if (Array.isArray(root.required)) {
      root.required = root.required.filter((key) => key !== "$schema");
    }
    const channelsNode = asSchemaObject(root.properties.channels);
    if (channelsNode) {
      channelsNode.properties = {};
      channelsNode.required = [];
      channelsNode.additionalProperties = true;
    }
    return next;
  },
  buildBaseConfigSchema = function () {
    if (cachedBase) {
      return cachedBase;
    }
    const schema = GenosOSSchema.toJSONSchema({
      target: "draft-07",
      unrepresentable: "any",
    });
    schema.title = "GenosOSConfig";
    const hints = mapSensitivePaths(GenosOSSchema, "", buildBaseHints());
    const next = {
      schema: stripChannelSchema(schema),
      uiHints: hints,
      version: VERSION,
      generatedAt: new Date().toISOString(),
    };
    cachedBase = next;
    return next;
  };
import { CHANNEL_IDS } from "../channels/registry.js";
import { VERSION } from "../version.js";
import { applySensitiveHints, buildBaseHints, mapSensitivePaths } from "./schema.hints.js";
import { GenosOSSchema } from "./zod-schema.js";
let cachedBase = null;
export function buildConfigSchema(params) {
  const base = buildBaseConfigSchema();
  const plugins = params?.plugins ?? [];
  const channels = params?.channels ?? [];
  if (plugins.length === 0 && channels.length === 0) {
    return base;
  }
  const mergedWithoutSensitiveHints = applyHeartbeatTargetHints(
    applyChannelHints(applyPluginHints(base.uiHints, plugins), channels),
    channels,
  );
  const extensionHintKeys = collectExtensionHintKeys(
    mergedWithoutSensitiveHints,
    plugins,
    channels,
  );
  const mergedHints = applySensitiveHints(mergedWithoutSensitiveHints, extensionHintKeys);
  const mergedSchema = applyChannelSchemas(applyPluginSchemas(base.schema, plugins), channels);
  return {
    ...base,
    schema: mergedSchema,
    uiHints: mergedHints,
  };
}
