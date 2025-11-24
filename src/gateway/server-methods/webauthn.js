// GenosOS — Esteban & Nyx 🦀🌙
import { randomUUID } from "node:crypto";
import { listCredentials, removeCredential, renameCredential } from "../../infra/webauthn-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

// ── Pending WebAuthn registrations (agent → UI → agent) ──────────────────────
const pendingRegistrations = new Map();

/**
 * Create a pending registration record with a promise that resolves on completion.
 * @param {string} displayName
 * @param {number} [timeoutMs=60000]
 * @returns {{ id: string, displayName: string, createdAtMs: number, expiresAtMs: number, promise: Promise<object> }}
 */
const createPending = (displayName, timeoutMs = 60_000) => {
  const id = randomUUID();
  const now = Date.now();
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => {
    resolve({ ok: false, error: "timeout" });
    pendingRegistrations.delete(id);
  }, timeoutMs);
  pendingRegistrations.set(id, { resolve, timer, promise });
  return { id, displayName, createdAtMs: now, expiresAtMs: now + timeoutMs, promise };
};

/**
 * Resolve a pending registration by id.
 * @param {string} id
 * @param {object} result
 * @returns {boolean}
 */
const resolvePending = (id, result) => {
  const entry = pendingRegistrations.get(id);
  if (!entry) {
    return false;
  }
  clearTimeout(entry.timer);
  entry.resolve(result);
  pendingRegistrations.delete(id);
  return true;
};

export const webauthnHandlers = {
  "webauthn.credentials.list": async ({ respond }) => {
    try {
      const credentials = await listCredentials();
      respond(true, { credentials }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err?.message ?? "Failed to list credentials"),
      );
    }
  },

  "webauthn.credential.remove": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing credential id"));
      return;
    }
    try {
      const removed = await removeCredential(id);
      respond(true, { ok: removed }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err?.message ?? "Failed to remove credential"),
      );
    }
  },

  "webauthn.credential.rename": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    const displayName = typeof params.displayName === "string" ? params.displayName.trim() : "";
    if (!id || !displayName) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Missing credential id or displayName"),
      );
      return;
    }
    try {
      const renamed = await renameCredential(id, displayName);
      respond(true, { ok: renamed }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err?.message ?? "Failed to rename credential"),
      );
    }
  },

  "webauthn.register.initiate": async ({ params, respond, context }) => {
    const displayName =
      typeof params?.displayName === "string" ? params.displayName.trim() : "Touch ID";
    const pending = createPending(displayName);
    context.broadcast(
      "webauthn.registration.requested",
      {
        id: pending.id,
        displayName: pending.displayName,
        createdAtMs: pending.createdAtMs,
        expiresAtMs: pending.expiresAtMs,
      },
      { dropIfSlow: true },
    );
    const result = await pending.promise;
    respond(true, result, undefined);
  },

  "webauthn.register.complete": async ({ params, respond, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing registration id"));
      return;
    }
    const success = params.success === true;
    const credentialId = typeof params.credentialId === "string" ? params.credentialId : undefined;
    const error = typeof params.error === "string" ? params.error : undefined;
    const result = success
      ? { ok: true, ...(credentialId ? { credentialId } : {}) }
      : { ok: false, ...(error ? { error } : {}) };
    const resolved = resolvePending(id, result);
    if (resolved) {
      context.broadcast("webauthn.registration.completed", { id, success }, { dropIfSlow: true });
    }
    respond(true, { ok: resolved }, undefined);
  },
};
