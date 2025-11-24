import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
export async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export async function writeJsonAtomic(filePath, value, options) {
  const mode = options?.mode ?? 384;
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  try {
    await fs.chmod(tmp, mode);
  } catch {}
  await fs.rename(tmp, filePath);
  try {
    await fs.chmod(filePath, mode);
  } catch {}
}
export function createAsyncLock() {
  let lock = Promise.resolve();
  return async function withLock(fn) {
    const prev = lock;
    let release;
    lock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release?.();
    }
  };
}
