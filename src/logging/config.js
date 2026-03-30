import fs from "node:fs";
import json5 from "json5";
import { resolveConfigPath } from "../config/paths.js";
import { secureReadFileSync } from "../infra/secure-io.js";
export function readLoggingConfig() {
  const configPath = resolveConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return;
    }
    const raw = secureReadFileSync(configPath);
    const parsed = json5.parse(raw);
    const logging = parsed?.logging;
    if (!logging || typeof logging !== "object" || Array.isArray(logging)) {
      return;
    }
    return logging;
  } catch {
    return;
  }
}
