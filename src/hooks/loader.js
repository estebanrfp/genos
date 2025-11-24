import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveHookConfig } from "./config.js";
import { shouldIncludeHook } from "./config.js";
import { registerInternalHook } from "./internal-hooks.js";
import { loadWorkspaceHookEntries } from "./workspace.js";
const log = createSubsystemLogger("hooks:loader");
export async function loadInternalHooks(cfg, workspaceDir, opts) {
  if (!cfg.hooks?.internal?.enabled) {
    return 0;
  }
  let loadedCount = 0;
  try {
    const hookEntries = loadWorkspaceHookEntries(workspaceDir, {
      config: cfg,
      managedHooksDir: opts?.managedHooksDir,
      bundledHooksDir: opts?.bundledHooksDir,
    });
    const eligible = hookEntries.filter((entry) => shouldIncludeHook({ entry, config: cfg }));
    for (const entry of eligible) {
      const hookConfig = resolveHookConfig(cfg, entry.hook.name);
      if (hookConfig?.enabled === false) {
        continue;
      }
      try {
        const url = pathToFileURL(entry.hook.handlerPath).href;
        const cacheBustedUrl = `${url}?t=${Date.now()}`;
        const mod = await import(cacheBustedUrl);
        const exportName = entry.metadata?.export ?? "default";
        const handler = mod[exportName];
        if (typeof handler !== "function") {
          log.error(`Handler '${exportName}' from ${entry.hook.name} is not a function`);
          continue;
        }
        const events = entry.metadata?.events ?? [];
        if (events.length === 0) {
          log.warn(`Hook '${entry.hook.name}' has no events defined in metadata`);
          continue;
        }
        for (const event of events) {
          registerInternalHook(event, handler);
        }
        log.info(
          `Registered hook: ${entry.hook.name} -> ${events.join(", ")}${exportName !== "default" ? ` (export: ${exportName})` : ""}`,
        );
        loadedCount++;
      } catch (err) {
        log.error(
          `Failed to load hook ${entry.hook.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    log.error(
      `Failed to load directory-based hooks: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const handlers = cfg.hooks.internal.handlers ?? [];
  for (const handlerConfig of handlers) {
    try {
      const rawModule = handlerConfig.module.trim();
      if (!rawModule) {
        log.error("Handler module path is empty");
        continue;
      }
      if (path.isAbsolute(rawModule)) {
        log.error(
          `Handler module path must be workspace-relative (got absolute path): ${rawModule}`,
        );
        continue;
      }
      const baseDir = path.resolve(workspaceDir);
      const modulePath = path.resolve(baseDir, rawModule);
      const rel = path.relative(baseDir, modulePath);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        log.error(`Handler module path must stay within workspaceDir: ${rawModule}`);
        continue;
      }
      const url = pathToFileURL(modulePath).href;
      const cacheBustedUrl = `${url}?t=${Date.now()}`;
      const mod = await import(cacheBustedUrl);
      const exportName = handlerConfig.export ?? "default";
      const handler = mod[exportName];
      if (typeof handler !== "function") {
        log.error(`Handler '${exportName}' from ${modulePath} is not a function`);
        continue;
      }
      registerInternalHook(handlerConfig.event, handler);
      log.info(
        `Registered hook (legacy): ${handlerConfig.event} -> ${modulePath}${exportName !== "default" ? `#${exportName}` : ""}`,
      );
      loadedCount++;
    } catch (err) {
      log.error(
        `Failed to load hook handler from ${handlerConfig.module}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return loadedCount;
}
