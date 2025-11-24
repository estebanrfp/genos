let resolveDeviceAuthPath = function (env = process.env) {
    return path.join(resolveStateDir(env), "identity", DEVICE_AUTH_FILE);
  },
  readStore = function (filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const raw = secureReadFileSync(filePath);
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || typeof parsed.deviceId !== "string") {
        return null;
      }
      if (!parsed.tokens || typeof parsed.tokens !== "object") {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },
  writeStore = function (filePath, store) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    secureWriteFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
  };
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { normalizeDeviceAuthRole, normalizeDeviceAuthScopes } from "../shared/device-auth.js";
import { secureReadFileSync, secureWriteFileSync } from "./secure-io.js";
const DEVICE_AUTH_FILE = "device-auth.json";
export function loadDeviceAuthToken(params) {
  const filePath = resolveDeviceAuthPath(params.env);
  const store = readStore(filePath);
  if (!store) {
    return null;
  }
  if (store.deviceId !== params.deviceId) {
    return null;
  }
  const role = normalizeDeviceAuthRole(params.role);
  const entry = store.tokens[role];
  if (!entry || typeof entry.token !== "string") {
    return null;
  }
  return entry;
}
export function storeDeviceAuthToken(params) {
  const filePath = resolveDeviceAuthPath(params.env);
  const existing = readStore(filePath);
  const role = normalizeDeviceAuthRole(params.role);
  const next = {
    version: 1,
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens
        ? { ...existing.tokens }
        : {},
  };
  const entry = {
    token: params.token,
    role,
    scopes: normalizeDeviceAuthScopes(params.scopes),
    updatedAtMs: Date.now(),
  };
  next.tokens[role] = entry;
  writeStore(filePath, next);
  return entry;
}
export function clearDeviceAuthToken(params) {
  const filePath = resolveDeviceAuthPath(params.env);
  const store = readStore(filePath);
  if (!store || store.deviceId !== params.deviceId) {
    return;
  }
  const role = normalizeDeviceAuthRole(params.role);
  if (!store.tokens[role]) {
    return;
  }
  const next = {
    version: 1,
    deviceId: store.deviceId,
    tokens: { ...store.tokens },
  };
  delete next.tokens[role];
  writeStore(filePath, next);
}
