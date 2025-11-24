import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import { expandHomePrefix } from "../infra/home-dir.js";
import { isEncrypted, decryptContent, encryptContent } from "../infra/memory-encryption.js";
import { getPassphraseOrNull } from "../infra/secure-io.js";
import { CONFIG_DIR } from "../utils.js";
export const DEFAULT_CRON_DIR = path.join(CONFIG_DIR, "cron");
export const DEFAULT_CRON_STORE_PATH = path.join(DEFAULT_CRON_DIR, "jobs.json");
export function resolveCronStorePath(storePath) {
  if (storePath?.trim()) {
    const raw = storePath.trim();
    if (raw.startsWith("~")) {
      return path.resolve(expandHomePrefix(raw));
    }
    return path.resolve(raw);
  }
  return DEFAULT_CRON_STORE_PATH;
}

export async function loadCronStore(storePath) {
  try {
    let raw = await fs.readFile(storePath, "utf-8");
    if (isEncrypted(raw)) {
      const pw = getPassphraseOrNull();
      if (pw) {
        raw = decryptContent(raw, pw);
      }
    }
    let parsed;
    try {
      parsed = JSON5.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse cron store at ${storePath}: ${String(err)}`, {
        cause: err,
      });
    }
    const parsedRecord =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const jobs = Array.isArray(parsedRecord.jobs) ? parsedRecord.jobs : [];
    return {
      version: 1,
      jobs: jobs.filter(Boolean),
    };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { version: 1, jobs: [] };
    }
    throw err;
  }
}
export async function saveCronStore(storePath, store) {
  const json = JSON.stringify(store, null, 2);
  const pw = getPassphraseOrNull();
  const output = pw ? encryptContent(json, pw) : json;
  const dir = path.dirname(storePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(storePath, output, "utf-8");
  try {
    await fs.writeFile(`${storePath}.bak`, output, "utf-8");
  } catch {}
}
