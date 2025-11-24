let resolvePath = function (baseDir) {
    const root = baseDir ?? resolveStateDir();
    return path.join(root, "settings", "voicewake.json");
  },
  sanitizeTriggers = function (triggers) {
    const cleaned = (triggers ?? [])
      .map((w) => (typeof w === "string" ? w.trim() : ""))
      .filter((w) => w.length > 0);
    return cleaned.length > 0 ? cleaned : DEFAULT_TRIGGERS;
  };
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "./json-files.js";
const DEFAULT_TRIGGERS = ["genosos", "claude", "computer"];
const withLock = createAsyncLock();
export function defaultVoiceWakeTriggers() {
  return [...DEFAULT_TRIGGERS];
}
export async function loadVoiceWakeConfig(baseDir) {
  const filePath = resolvePath(baseDir);
  const existing = await readJsonFile(filePath);
  if (!existing) {
    return { triggers: defaultVoiceWakeTriggers(), updatedAtMs: 0 };
  }
  return {
    triggers: sanitizeTriggers(existing.triggers),
    updatedAtMs:
      typeof existing.updatedAtMs === "number" && existing.updatedAtMs > 0
        ? existing.updatedAtMs
        : 0,
  };
}
export async function setVoiceWakeTriggers(triggers, baseDir) {
  const sanitized = sanitizeTriggers(triggers);
  const filePath = resolvePath(baseDir);
  return await withLock(async () => {
    const next = {
      triggers: sanitized,
      updatedAtMs: Date.now(),
    };
    await writeJsonAtomic(filePath, next);
    return next;
  });
}
