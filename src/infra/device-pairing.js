let normalizeDeviceId = function (deviceId) {
    return deviceId.trim();
  },
  normalizeRole = function (role) {
    const trimmed = role?.trim();
    return trimmed ? trimmed : null;
  },
  mergeRoles = function (...items) {
    const roles = new Set();
    for (const item of items) {
      if (!item) {
        continue;
      }
      if (Array.isArray(item)) {
        for (const role of item) {
          const trimmed = role.trim();
          if (trimmed) {
            roles.add(trimmed);
          }
        }
      } else {
        const trimmed = item.trim();
        if (trimmed) {
          roles.add(trimmed);
        }
      }
    }
    if (roles.size === 0) {
      return;
    }
    return [...roles];
  },
  mergeScopes = function (...items) {
    const scopes = new Set();
    for (const item of items) {
      if (!item) {
        continue;
      }
      for (const scope of item) {
        const trimmed = scope.trim();
        if (trimmed) {
          scopes.add(trimmed);
        }
      }
    }
    if (scopes.size === 0) {
      return;
    }
    return [...scopes];
  },
  scopesAllow = function (requested, allowed) {
    if (requested.length === 0) {
      return true;
    }
    if (allowed.length === 0) {
      return false;
    }
    const allowedSet = new Set(allowed);
    return requested.every((scope) => allowedSet.has(scope));
  },
  newToken = function () {
    return generatePairingToken();
  },
  getPairedDeviceFromState = function (state, deviceId) {
    return state.pairedByDeviceId[normalizeDeviceId(deviceId)] ?? null;
  },
  cloneDeviceTokens = function (device) {
    return device.tokens ? { ...device.tokens } : {};
  },
  buildDeviceAuthToken = function (params) {
    return {
      token: newToken(),
      role: params.role,
      scopes: params.scopes,
      createdAtMs: params.existing?.createdAtMs ?? params.now,
      rotatedAtMs: params.rotatedAtMs,
      revokedAtMs: undefined,
      lastUsedAtMs: params.existing?.lastUsedAtMs,
    };
  },
  resolveDeviceTokenUpdateContext = function (params) {
    const device = getPairedDeviceFromState(params.state, params.deviceId);
    if (!device) {
      return null;
    }
    const role = normalizeRole(params.role);
    if (!role) {
      return null;
    }
    const tokens = cloneDeviceTokens(device);
    const existing = tokens[role];
    return { device, role, tokens, existing };
  };
import { randomUUID } from "node:crypto";
import { normalizeDeviceAuthScopes } from "../shared/device-auth.js";
import {
  createAsyncLock,
  pruneExpiredPending,
  readJsonFile,
  resolvePairingPaths,
  writeJsonAtomic,
} from "./pairing-files.js";
import { generatePairingToken, verifyPairingToken } from "./pairing-token.js";
const PENDING_TTL_MS = 300000;
const withLock = createAsyncLock();
async function loadState(baseDir) {
  const { pendingPath, pairedPath } = resolvePairingPaths(baseDir, "devices");
  const [pending, paired] = await Promise.all([
    readJsonFile(pendingPath),
    readJsonFile(pairedPath),
  ]);
  const state = {
    pendingById: pending ?? {},
    pairedByDeviceId: paired ?? {},
  };
  pruneExpiredPending(state.pendingById, Date.now(), PENDING_TTL_MS);
  return state;
}
async function persistState(state, baseDir) {
  const { pendingPath, pairedPath } = resolvePairingPaths(baseDir, "devices");
  await Promise.all([
    writeJsonAtomic(pendingPath, state.pendingById),
    writeJsonAtomic(pairedPath, state.pairedByDeviceId),
  ]);
}
export async function listDevicePairing(baseDir) {
  const state = await loadState(baseDir);
  const pending = Object.values(state.pendingById).toSorted((a, b) => b.ts - a.ts);
  const paired = Object.values(state.pairedByDeviceId).toSorted(
    (a, b) => b.approvedAtMs - a.approvedAtMs,
  );
  return { pending, paired };
}
export async function getPairedDevice(deviceId, baseDir) {
  const state = await loadState(baseDir);
  return state.pairedByDeviceId[normalizeDeviceId(deviceId)] ?? null;
}
export async function requestDevicePairing(req, baseDir) {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const deviceId = normalizeDeviceId(req.deviceId);
    if (!deviceId) {
      throw new Error("deviceId required");
    }
    const existing = Object.values(state.pendingById).find((p) => p.deviceId === deviceId);
    if (existing) {
      return { status: "pending", request: existing, created: false };
    }
    const isRepair = Boolean(state.pairedByDeviceId[deviceId]);
    const request = {
      requestId: randomUUID(),
      deviceId,
      publicKey: req.publicKey,
      displayName: req.displayName,
      platform: req.platform,
      clientId: req.clientId,
      clientMode: req.clientMode,
      role: req.role,
      roles: req.role ? [req.role] : undefined,
      scopes: req.scopes,
      remoteIp: req.remoteIp,
      silent: req.silent,
      isRepair,
      ts: Date.now(),
    };
    state.pendingById[request.requestId] = request;
    await persistState(state, baseDir);
    return { status: "pending", request, created: true };
  });
}
export async function approveDevicePairing(requestId, baseDir) {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const pending = state.pendingById[requestId];
    if (!pending) {
      return null;
    }
    const now = Date.now();
    const existing = state.pairedByDeviceId[pending.deviceId];
    const roles = mergeRoles(existing?.roles, existing?.role, pending.roles, pending.role);
    const scopes = mergeScopes(existing?.scopes, pending.scopes);
    const tokens = existing?.tokens ? { ...existing.tokens } : {};
    const roleForToken = normalizeRole(pending.role);
    if (roleForToken) {
      const nextScopes = normalizeDeviceAuthScopes(pending.scopes);
      const existingToken = tokens[roleForToken];
      const now = Date.now();
      tokens[roleForToken] = {
        token: newToken(),
        role: roleForToken,
        scopes: nextScopes,
        createdAtMs: existingToken?.createdAtMs ?? now,
        rotatedAtMs: existingToken ? now : undefined,
        revokedAtMs: undefined,
        lastUsedAtMs: existingToken?.lastUsedAtMs,
      };
    }
    const device = {
      deviceId: pending.deviceId,
      publicKey: pending.publicKey,
      displayName: pending.displayName,
      platform: pending.platform,
      clientId: pending.clientId,
      clientMode: pending.clientMode,
      role: pending.role,
      roles,
      scopes,
      remoteIp: pending.remoteIp,
      tokens,
      createdAtMs: existing?.createdAtMs ?? now,
      approvedAtMs: now,
    };
    delete state.pendingById[requestId];
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, baseDir);
    return { requestId, device };
  });
}
export async function rejectDevicePairing(requestId, baseDir) {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const pending = state.pendingById[requestId];
    if (!pending) {
      return null;
    }
    delete state.pendingById[requestId];
    await persistState(state, baseDir);
    return { requestId, deviceId: pending.deviceId };
  });
}
export async function removePairedDevice(deviceId, baseDir) {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const normalized = normalizeDeviceId(deviceId);
    if (!normalized || !state.pairedByDeviceId[normalized]) {
      return null;
    }
    delete state.pairedByDeviceId[normalized];
    await persistState(state, baseDir);
    return { deviceId: normalized };
  });
}
export async function updatePairedDeviceMetadata(deviceId, patch, baseDir) {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const existing = state.pairedByDeviceId[normalizeDeviceId(deviceId)];
    if (!existing) {
      return;
    }
    const roles = mergeRoles(existing.roles, existing.role, patch.role);
    const scopes = mergeScopes(existing.scopes, patch.scopes);
    state.pairedByDeviceId[deviceId] = {
      ...existing,
      ...patch,
      deviceId: existing.deviceId,
      createdAtMs: existing.createdAtMs,
      approvedAtMs: existing.approvedAtMs,
      role: patch.role ?? existing.role,
      roles,
      scopes,
    };
    await persistState(state, baseDir);
  });
}
export function summarizeDeviceTokens(tokens) {
  if (!tokens) {
    return;
  }
  const summaries = Object.values(tokens)
    .map((token) => ({
      role: token.role,
      scopes: token.scopes,
      createdAtMs: token.createdAtMs,
      rotatedAtMs: token.rotatedAtMs,
      revokedAtMs: token.revokedAtMs,
      lastUsedAtMs: token.lastUsedAtMs,
    }))
    .toSorted((a, b) => a.role.localeCompare(b.role));
  return summaries.length > 0 ? summaries : undefined;
}
export async function verifyDeviceToken(params) {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const device = getPairedDeviceFromState(state, params.deviceId);
    if (!device) {
      return { ok: false, reason: "device-not-paired" };
    }
    const role = normalizeRole(params.role);
    if (!role) {
      return { ok: false, reason: "role-missing" };
    }
    const entry = device.tokens?.[role];
    if (!entry) {
      return { ok: false, reason: "token-missing" };
    }
    if (entry.revokedAtMs) {
      return { ok: false, reason: "token-revoked" };
    }
    if (!verifyPairingToken(params.token, entry.token)) {
      return { ok: false, reason: "token-mismatch" };
    }
    const requestedScopes = normalizeDeviceAuthScopes(params.scopes);
    if (!scopesAllow(requestedScopes, entry.scopes)) {
      return { ok: false, reason: "scope-mismatch" };
    }
    entry.lastUsedAtMs = Date.now();
    device.tokens ??= {};
    device.tokens[role] = entry;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, params.baseDir);
    return { ok: true };
  });
}
export async function ensureDeviceToken(params) {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const requestedScopes = normalizeDeviceAuthScopes(params.scopes);
    const context = resolveDeviceTokenUpdateContext({
      state,
      deviceId: params.deviceId,
      role: params.role,
    });
    if (!context) {
      return null;
    }
    const { device, role, tokens, existing } = context;
    if (existing && !existing.revokedAtMs) {
      if (scopesAllow(requestedScopes, existing.scopes)) {
        return existing;
      }
    }
    const now = Date.now();
    const next = buildDeviceAuthToken({
      role,
      scopes: requestedScopes,
      existing,
      now,
      rotatedAtMs: existing ? now : undefined,
    });
    tokens[role] = next;
    device.tokens = tokens;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, params.baseDir);
    return next;
  });
}
export async function rotateDeviceToken(params) {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const context = resolveDeviceTokenUpdateContext({
      state,
      deviceId: params.deviceId,
      role: params.role,
    });
    if (!context) {
      return null;
    }
    const { device, role, tokens, existing } = context;
    const requestedScopes = normalizeDeviceAuthScopes(
      params.scopes ?? existing?.scopes ?? device.scopes,
    );
    const now = Date.now();
    const next = buildDeviceAuthToken({
      role,
      scopes: requestedScopes,
      existing,
      now,
      rotatedAtMs: now,
    });
    tokens[role] = next;
    device.tokens = tokens;
    if (params.scopes !== undefined) {
      device.scopes = requestedScopes;
    }
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, params.baseDir);
    return next;
  });
}
export async function revokeDeviceToken(params) {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const device = state.pairedByDeviceId[normalizeDeviceId(params.deviceId)];
    if (!device) {
      return null;
    }
    const role = normalizeRole(params.role);
    if (!role) {
      return null;
    }
    if (!device.tokens?.[role]) {
      return null;
    }
    const tokens = { ...device.tokens };
    const entry = { ...tokens[role], revokedAtMs: Date.now() };
    tokens[role] = entry;
    device.tokens = tokens;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, params.baseDir);
    return entry;
  });
}
