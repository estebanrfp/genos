let buildCacheKey = function (params) {
    const workspaceKey = params.workspaceDir ? resolveUserPath(params.workspaceDir) : "";
    return `${workspaceKey}::${JSON.stringify(params.plugins)}`;
  },
  validatePluginConfig = function (params) {
    const schema = params.schema;
    if (!schema) {
      return { ok: true, value: params.value };
    }
    const cacheKey = params.cacheKey ?? JSON.stringify(schema);
    const result = validateJsonSchemaValue({
      schema,
      cacheKey,
      value: params.value ?? {},
    });
    if (result.ok) {
      return { ok: true, value: params.value };
    }
    return { ok: false, errors: result.errors };
  },
  resolvePluginModuleExport = function (moduleExport) {
    const resolved =
      moduleExport && typeof moduleExport === "object" && "default" in moduleExport
        ? moduleExport.default
        : moduleExport;
    if (typeof resolved === "function") {
      return {
        register: resolved,
      };
    }
    if (resolved && typeof resolved === "object") {
      const def = resolved;
      const register = def.register ?? def.activate;
      return { definition: def, register };
    }
    return {};
  },
  createPluginRecord = function (params) {
    return {
      id: params.id,
      name: params.name ?? params.id,
      description: params.description,
      version: params.version,
      source: params.source,
      origin: params.origin,
      workspaceDir: params.workspaceDir,
      enabled: params.enabled,
      status: params.enabled ? "loaded" : "disabled",
      toolNames: [],
      hookNames: [],
      channelIds: [],
      providerIds: [],
      gatewayMethods: [],
      cliCommands: [],
      services: [],
      commands: [],
      httpHandlers: 0,
      hookCount: 0,
      configSchema: params.configSchema,
      configUiHints: undefined,
      configJsonSchema: undefined,
    };
  },
  pushDiagnostics = function (diagnostics, append) {
    diagnostics.push(...append);
  };
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import { clearPluginCommands } from "./commands.js";
import {
  applyTestPluginDefaults,
  normalizePluginsConfig,
  resolveEnableState,
  resolveMemorySlotDecision,
} from "./config-state.js";
import { discoverGenosOSPlugins } from "./discovery.js";
import { initializeGlobalHookRunner } from "./hook-runner-global.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { createPluginRegistry } from "./registry.js";
import { setActivePluginRegistry } from "./runtime.js";
import { createPluginRuntime } from "./runtime/index.js";
import { validateJsonSchemaValue } from "./schema-validator.js";
const registryCache = new Map();
const defaultLogger = () => createSubsystemLogger("plugins");
const SENSITIVE_ENV_KEYS = ["VAULT_PASSPHRASE", "GENOS_GATEWAY_TOKEN"];
const resolvePluginSdkAliasFile = (params) => {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const isProduction = false;
    const isTest = process.env.VITEST || false;
    let cursor = path.dirname(modulePath);
    for (let i = 0; i < 6; i += 1) {
      const srcCandidate = path.join(cursor, "src", "plugin-sdk", params.srcFile);
      const distCandidate = path.join(cursor, "dist", "plugin-sdk", params.distFile);
      const orderedCandidates = isProduction
        ? isTest
          ? [distCandidate, srcCandidate]
          : [distCandidate]
        : [srcCandidate, distCandidate];
      for (const candidate of orderedCandidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {}
  return null;
};
const resolvePluginSdkAlias = () =>
  resolvePluginSdkAliasFile({ srcFile: "index.js", distFile: "index.js" });
const resolvePluginSdkAccountIdAlias = () => {
  return resolvePluginSdkAliasFile({ srcFile: "account-id.js", distFile: "account-id.js" });
};
export function loadGenosOSPlugins(options = {}) {
  const cfg = applyTestPluginDefaults(options.config ?? {}, process.env);
  const logger = options.logger ?? defaultLogger();
  const validateOnly = options.mode === "validate";
  const normalized = normalizePluginsConfig(cfg.plugins);
  const cacheKey = buildCacheKey({
    workspaceDir: options.workspaceDir,
    plugins: normalized,
  });
  const cacheEnabled = options.cache !== false;
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached) {
      setActivePluginRegistry(cached, cacheKey);
      return cached;
    }
  }
  clearPluginCommands();
  const runtime = createPluginRuntime();
  const { registry, createApi } = createPluginRegistry({
    logger,
    runtime,
    coreGatewayHandlers: options.coreGatewayHandlers,
  });
  const discovery = discoverGenosOSPlugins({
    workspaceDir: options.workspaceDir,
    extraPaths: normalized.loadPaths,
  });
  const manifestRegistry = loadPluginManifestRegistry({
    config: cfg,
    workspaceDir: options.workspaceDir,
    cache: options.cache,
    candidates: discovery.candidates,
    diagnostics: discovery.diagnostics,
  });
  pushDiagnostics(registry.diagnostics, manifestRegistry.diagnostics);
  let jitiLoader = null;
  const getJiti = () => {
    if (jitiLoader) {
      return jitiLoader;
    }
    const pluginSdkAlias = resolvePluginSdkAlias();
    const pluginSdkAccountIdAlias = resolvePluginSdkAccountIdAlias();
    jitiLoader = createJiti(import.meta.url, {
      interopDefault: true,
      extensions: [".js", ".mjs", ".cjs", ".json"],
      ...(pluginSdkAlias || pluginSdkAccountIdAlias
        ? {
            alias: {
              ...(pluginSdkAlias ? { "genosos/plugin-sdk": pluginSdkAlias } : {}),
              ...(pluginSdkAccountIdAlias
                ? { "genosos/plugin-sdk/account-id": pluginSdkAccountIdAlias }
                : {}),
            },
          }
        : {}),
    });
    return jitiLoader;
  };
  const manifestByRoot = new Map(
    manifestRegistry.plugins.map((record) => [record.rootDir, record]),
  );
  // Scrub sensitive env vars before loading plugin code
  const savedEnv = new Map();
  for (const key of SENSITIVE_ENV_KEYS) {
    if (key in process.env) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  }

  const seenIds = new Map();
  const memorySlot = normalized.slots.memory;
  let selectedMemoryPluginId = null;
  let memorySlotMatched = false;
  for (const candidate of discovery.candidates) {
    const manifestRecord = manifestByRoot.get(candidate.rootDir);
    if (!manifestRecord) {
      continue;
    }
    const pluginId = manifestRecord.id;
    const existingOrigin = seenIds.get(pluginId);
    if (existingOrigin) {
      const record = createPluginRecord({
        id: pluginId,
        name: manifestRecord.name ?? pluginId,
        description: manifestRecord.description,
        version: manifestRecord.version,
        source: candidate.source,
        origin: candidate.origin,
        workspaceDir: candidate.workspaceDir,
        enabled: false,
        configSchema: Boolean(manifestRecord.configSchema),
      });
      record.status = "disabled";
      record.error = `overridden by ${existingOrigin} plugin`;
      registry.plugins.push(record);
      continue;
    }
    const enableState = resolveEnableState(pluginId, candidate.origin, normalized);
    const entry = normalized.entries[pluginId];
    const record = createPluginRecord({
      id: pluginId,
      name: manifestRecord.name ?? pluginId,
      description: manifestRecord.description,
      version: manifestRecord.version,
      source: candidate.source,
      origin: candidate.origin,
      workspaceDir: candidate.workspaceDir,
      enabled: enableState.enabled,
      configSchema: Boolean(manifestRecord.configSchema),
    });
    record.kind = manifestRecord.kind;
    record.configUiHints = manifestRecord.configUiHints;
    record.configJsonSchema = manifestRecord.configSchema;
    if (!enableState.enabled) {
      record.status = "disabled";
      record.error = enableState.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }
    if (!manifestRecord.configSchema) {
      record.status = "error";
      record.error = "missing config schema";
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }
    let mod = null;
    try {
      mod = getJiti()(candidate.source);
    } catch (err) {
      logger.error(`[plugins] ${record.id} failed to load from ${record.source}: ${String(err)}`);
      record.status = "error";
      record.error = String(err);
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `failed to load plugin: ${String(err)}`,
      });
      continue;
    }
    const resolved = resolvePluginModuleExport(mod);
    const definition = resolved.definition;
    const register = resolved.register;
    if (definition?.id && definition.id !== record.id) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin id mismatch (config uses "${record.id}", export uses "${definition.id}")`,
      });
    }
    record.name = definition?.name ?? record.name;
    record.description = definition?.description ?? record.description;
    record.version = definition?.version ?? record.version;
    const manifestKind = record.kind;
    const exportKind = definition?.kind;
    if (manifestKind && exportKind && exportKind !== manifestKind) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin kind mismatch (manifest uses "${manifestKind}", export uses "${exportKind}")`,
      });
    }
    record.kind = definition?.kind ?? record.kind;
    if (record.kind === "memory" && memorySlot === record.id) {
      memorySlotMatched = true;
    }
    const memoryDecision = resolveMemorySlotDecision({
      id: record.id,
      kind: record.kind,
      slot: memorySlot,
      selectedId: selectedMemoryPluginId,
    });
    if (!memoryDecision.enabled) {
      record.enabled = false;
      record.status = "disabled";
      record.error = memoryDecision.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }
    if (memoryDecision.selected && record.kind === "memory") {
      selectedMemoryPluginId = record.id;
    }
    const validatedConfig = validatePluginConfig({
      schema: manifestRecord.configSchema,
      cacheKey: manifestRecord.schemaCacheKey,
      value: entry?.config,
    });
    if (!validatedConfig.ok) {
      logger.error(`[plugins] ${record.id} invalid config: ${validatedConfig.errors?.join(", ")}`);
      record.status = "error";
      record.error = `invalid config: ${validatedConfig.errors?.join(", ")}`;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }
    if (validateOnly) {
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }
    if (typeof register !== "function") {
      logger.error(`[plugins] ${record.id} missing register/activate export`);
      record.status = "error";
      record.error = "plugin export missing register/activate";
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }
    const api = createApi(record, {
      config: cfg,
      pluginConfig: validatedConfig.value,
    });
    try {
      const result = register(api);
      if (result && typeof result.then === "function") {
        registry.diagnostics.push({
          level: "warn",
          pluginId: record.id,
          source: record.source,
          message: "plugin register returned a promise; async registration is ignored",
        });
      }
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
    } catch (err) {
      logger.error(
        `[plugins] ${record.id} failed during register from ${record.source}: ${String(err)}`,
      );
      record.status = "error";
      record.error = String(err);
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `plugin failed during register: ${String(err)}`,
      });
    }
  }
  // Restore sensitive env vars after plugin loading
  for (const [key, value] of savedEnv) {
    process.env[key] = value;
  }

  if (typeof memorySlot === "string" && !memorySlotMatched) {
    registry.diagnostics.push({
      level: "warn",
      message: `memory slot plugin not found or not marked as memory: ${memorySlot}`,
    });
  }
  if (cacheEnabled) {
    registryCache.set(cacheKey, registry);
  }
  setActivePluginRegistry(registry, cacheKey);
  initializeGlobalHookRunner(registry);
  return registry;
}
