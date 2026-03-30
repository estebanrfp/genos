import { createSubsystemLogger } from "../logging/subsystem.js";
import { createHookRunner } from "./hooks.js";
const log = createSubsystemLogger("plugins");
let globalHookRunner = null;
let globalRegistry = null;
export function initializeGlobalHookRunner(registry) {
  globalRegistry = registry;
  globalHookRunner = createHookRunner(registry, {
    logger: {
      debug: (msg) => log.debug(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
    },
    catchErrors: true,
  });
  const hookCount = registry.hooks.length;
  if (hookCount > 0) {
    log.info(`hook runner initialized with ${hookCount} registered hooks`);
  }
}
export function getGlobalHookRunner() {
  return globalHookRunner;
}
export function getGlobalPluginRegistry() {
  return globalRegistry;
}
export function hasGlobalHooks(hookName) {
  return globalHookRunner?.hasHooks(hookName) ?? false;
}
export async function runGlobalGatewayStopSafely(params) {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("gateway_stop")) {
    return;
  }
  try {
    await hookRunner.runGatewayStop(params.event, params.ctx);
  } catch (err) {
    if (params.onError) {
      params.onError(err);
      return;
    }
    log.warn(`gateway_stop hook failed: ${String(err)}`);
  }
}
export function resetGlobalHookRunner() {
  globalHookRunner = null;
  globalRegistry = null;
}
