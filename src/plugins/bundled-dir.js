import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function resolveBundledPluginsDir() {
  const override = process.env.GENOS_BUNDLED_PLUGINS_DIR?.trim();
  if (override) {
    return override;
  }
  try {
    const execDir = path.dirname(process.execPath);
    const sibling = path.join(execDir, "extensions");
    if (fs.existsSync(sibling)) {
      return sibling;
    }
  } catch {}
  try {
    let cursor = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i += 1) {
      const candidate = path.join(cursor, "extensions");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {}
  return;
}
