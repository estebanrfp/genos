let requireConfigBaseHash = function (params, snapshot, respond) {
    if (!snapshot.exists) {
      return true;
    }
    const snapshotHash = resolveConfigSnapshotHash(snapshot);
    if (!snapshotHash) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "config base hash unavailable; re-run config.get and retry",
        ),
      );
      return false;
    }
    const baseHash = resolveBaseHashParam(params);
    if (!baseHash) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "config base hash required; re-run config.get and retry",
        ),
      );
      return false;
    }
    if (baseHash !== snapshotHash) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "config changed since last load; re-run config.get and retry",
        ),
      );
      return false;
    }
    return true;
  },
  parseRawConfigOrRespond = function (params, requestName, respond) {
    const rawValue = params.raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid ${requestName} params: raw (string) required`,
        ),
      );
      return null;
    }
    return rawValue;
  },
  parseValidateConfigFromRawOrRespond = function (params, requestName, snapshot, respond) {
    const rawValue = parseRawConfigOrRespond(params, requestName, respond);
    if (!rawValue) {
      return null;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return null;
    }
    const schema = loadSchemaWithPlugins();
    const restored = restoreRedactedValues(parsedRes.parsed, snapshot.config, schema.uiHints);
    if (!restored.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, restored.humanReadableMessage ?? "invalid config"),
      );
      return null;
    }
    const validated = validateConfigObjectWithPlugins(restored.result);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return null;
    }
    return { config: validated.config, schema };
  },
  resolveConfigRestartRequest = function (params) {
    const { sessionKey, note, restartDelayMs } = parseRestartRequestParams(params);
    const { deliveryContext, threadId } = extractDeliveryInfo(sessionKey);
    return {
      sessionKey,
      note,
      restartDelayMs,
      deliveryContext,
      threadId,
    };
  },
  buildConfigRestartSentinelPayload = function (params) {
    return {
      kind: params.kind,
      status: "ok",
      ts: Date.now(),
      sessionKey: params.sessionKey,
      deliveryContext: params.deliveryContext,
      threadId: params.threadId,
      message: params.note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: params.mode,
        root: CONFIG_PATH,
      },
    };
  },
  loadSchemaWithPlugins = function () {
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const pluginRegistry = loadGenosOSPlugins({
      config: cfg,
      cache: true,
      workspaceDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    });
    return buildConfigSchema({
      plugins: pluginRegistry.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        configUiHints: plugin.configUiHints,
        configSchema: plugin.configJsonSchema,
      })),
      channels: listChannelPlugins().map((entry) => ({
        id: entry.id,
        label: entry.meta.label,
        description: entry.meta.blurb,
        configSchema: entry.configSchema?.schema,
        configUiHints: entry.configSchema?.uiHints,
      })),
    });
  };
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import {
  CONFIG_PATH,
  loadConfig,
  parseConfigJson5,
  readConfigFileSnapshot,
  readConfigFileSnapshotForWrite,
  resolveConfigSnapshotHash,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "../../config/config.js";
import { applyLegacyMigrations } from "../../config/legacy.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import {
  redactConfigObject,
  redactConfigSnapshot,
  restoreRedactedValues,
} from "../../config/redact-snapshot.js";
import { buildConfigSchema } from "../../config/schema.js";
import { extractDeliveryInfo } from "../../config/sessions.js";
import {
  formatDoctorNonInteractiveHint,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { loadGenosOSPlugins } from "../../plugins/loader.js";
import { buildGatewayReloadPlan, diffConfigPaths } from "../config-reload.js";
import {
  ErrorCodes,
  errorShape,
  validateConfigApplyParams,
  validateConfigGetParams,
  validateConfigPatchParams,
  validateConfigSchemaParams,
  validateConfigSetParams,
} from "../protocol/index.js";
import { resolveBaseHashParam } from "./base-hash.js";
import { parseRestartRequestParams } from "./restart-request.js";
import { assertValidParams } from "./validation.js";
async function tryWriteRestartSentinelPayload(payload) {
  try {
    return await writeRestartSentinel(payload);
  } catch {
    return null;
  }
}
export const configHandlers = {
  "config.get": async ({ params, respond }) => {
    if (!assertValidParams(params, validateConfigGetParams, "config.get", respond)) {
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    const schema = loadSchemaWithPlugins();
    respond(true, redactConfigSnapshot(snapshot, schema.uiHints), undefined);
  },
  "config.schema": ({ params, respond }) => {
    if (!assertValidParams(params, validateConfigSchemaParams, "config.schema", respond)) {
      return;
    }
    respond(true, loadSchemaWithPlugins(), undefined);
  },
  "config.set": async ({ params, respond }) => {
    if (!assertValidParams(params, validateConfigSetParams, "config.set", respond)) {
      return;
    }
    const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const parsed = parseValidateConfigFromRawOrRespond(params, "config.set", snapshot, respond);
    if (!parsed) {
      return;
    }
    await writeConfigFile(parsed.config, writeOptions);
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(parsed.config, parsed.schema.uiHints),
      },
      undefined,
    );
  },
  "config.patch": async ({ params, respond }) => {
    if (!assertValidParams(params, validateConfigPatchParams, "config.patch", respond)) {
      return;
    }
    const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config; fix before patching"),
      );
      return;
    }
    const rawValue = params.raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid config.patch params: raw (string) required",
        ),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    if (
      !parsedRes.parsed ||
      typeof parsedRes.parsed !== "object" ||
      Array.isArray(parsedRes.parsed)
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config.patch raw must be an object"),
      );
      return;
    }
    const merged = applyMergePatch(snapshot.config, parsedRes.parsed, {
      mergeObjectArraysById: true,
    });
    const schemaPatch = loadSchemaWithPlugins();
    const restoredMerge = restoreRedactedValues(merged, snapshot.config, schemaPatch.uiHints);
    if (!restoredMerge.ok) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          restoredMerge.humanReadableMessage ?? "invalid config",
        ),
      );
      return;
    }
    const migrated = applyLegacyMigrations(restoredMerge.result);
    const resolved = migrated.next ?? restoredMerge.result;
    const validated = validateConfigObjectWithPlugins(resolved);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    await writeConfigFile(validated.config, writeOptions);
    const changedPaths = diffConfigPaths(snapshot.config, validated.config);
    const reloadPlan = buildGatewayReloadPlan(changedPaths);
    let restart = null;
    let sentinelPath = null;
    let payload = null;
    if (reloadPlan.restartGateway) {
      const { sessionKey, note, restartDelayMs, deliveryContext, threadId } =
        resolveConfigRestartRequest(params);
      payload = buildConfigRestartSentinelPayload({
        kind: "config-patch",
        mode: "config.patch",
        sessionKey,
        deliveryContext,
        threadId,
        note,
      });
      sentinelPath = await tryWriteRestartSentinelPayload(payload);
      restart = scheduleGatewaySigusr1Restart({
        delayMs: restartDelayMs,
        reason: "config.patch",
      });
    }
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(validated.config, schemaPatch.uiHints),
        restart,
        reloadPlan: {
          restartGateway: reloadPlan.restartGateway,
          hotReasons: reloadPlan.hotReasons,
          noopPaths: reloadPlan.noopPaths,
        },
        sentinel: sentinelPath ? { path: sentinelPath, payload } : null,
      },
      undefined,
    );
  },
  "config.apply": async ({ params, respond }) => {
    if (!assertValidParams(params, validateConfigApplyParams, "config.apply", respond)) {
      return;
    }
    const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const parsed = parseValidateConfigFromRawOrRespond(params, "config.apply", snapshot, respond);
    if (!parsed) {
      return;
    }
    await writeConfigFile(parsed.config, writeOptions);
    const changedPaths = diffConfigPaths(snapshot.config, parsed.config);
    const reloadPlan = buildGatewayReloadPlan(changedPaths);
    let restart = null;
    let sentinelPath = null;
    let payload = null;
    if (reloadPlan.restartGateway) {
      const { sessionKey, note, restartDelayMs, deliveryContext, threadId } =
        resolveConfigRestartRequest(params);
      payload = buildConfigRestartSentinelPayload({
        kind: "config-apply",
        mode: "config.apply",
        sessionKey,
        deliveryContext,
        threadId,
        note,
      });
      sentinelPath = await tryWriteRestartSentinelPayload(payload);
      restart = scheduleGatewaySigusr1Restart({
        delayMs: restartDelayMs,
        reason: "config.apply",
      });
    }
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(parsed.config, parsed.schema.uiHints),
        restart,
        reloadPlan: {
          restartGateway: reloadPlan.restartGateway,
          hotReasons: reloadPlan.hotReasons,
          noopPaths: reloadPlan.noopPaths,
        },
        sentinel: sentinelPath ? { path: sentinelPath, payload } : null,
      },
      undefined,
    );
  },
};
