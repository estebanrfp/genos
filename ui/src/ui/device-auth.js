let readStore = function () {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) {
        return null;
      }
      if (!parsed.deviceId || typeof parsed.deviceId !== "string") {
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
  writeStore = function (store) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {}
  };
import {
  normalizeDeviceAuthRole,
  normalizeDeviceAuthScopes,
} from "../../../src/shared/device-auth.js";
const STORAGE_KEY = "genosos.device.auth.v1";
export function loadDeviceAuthToken(params) {
  const store = readStore();
  if (!store || store.deviceId !== params.deviceId) {
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
  const role = normalizeDeviceAuthRole(params.role);
  const next = {
    version: 1,
    deviceId: params.deviceId,
    tokens: {},
  };
  const existing = readStore();
  if (existing && existing.deviceId === params.deviceId) {
    next.tokens = { ...existing.tokens };
  }
  const entry = {
    token: params.token,
    role,
    scopes: normalizeDeviceAuthScopes(params.scopes),
    updatedAtMs: Date.now(),
  };
  next.tokens[role] = entry;
  writeStore(next);
  return entry;
}
export function clearDeviceAuthToken(params) {
  const store = readStore();
  if (!store || store.deviceId !== params.deviceId) {
    return;
  }
  const role = normalizeDeviceAuthRole(params.role);
  if (!store.tokens[role]) {
    return;
  }
  const next = { ...store, tokens: { ...store.tokens } };
  delete next.tokens[role];
  writeStore(next);
}
