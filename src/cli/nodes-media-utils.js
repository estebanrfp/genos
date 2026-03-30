import { randomUUID } from "node:crypto";
import * as os from "node:os";
export function asRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
}
export function asString(value) {
  return typeof value === "string" ? value : undefined;
}
export function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function asBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}
export function resolveTempPathParts(opts) {
  return {
    tmpDir: opts.tmpDir ?? os.tmpdir(),
    id: opts.id ?? randomUUID(),
    ext: opts.ext.startsWith(".") ? opts.ext : `.${opts.ext}`,
  };
}
