import fs from "node:fs";
import path from "node:path";
import { secureReadFileSync, secureWriteFileSync } from "./secure-io.js";
export function loadJsonFile(pathname) {
  try {
    if (!fs.existsSync(pathname)) {
      return;
    }
    const raw = secureReadFileSync(pathname);
    return JSON.parse(raw);
  } catch {
    return;
  }
}
export function saveJsonFile(pathname, data) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
  }
  secureWriteFileSync(pathname, `${JSON.stringify(data, null, 2)}\n`);
}
