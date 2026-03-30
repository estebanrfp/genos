// GenosOS — Esteban & Nyx 🦀🌙
import { startAuthentication } from "@simplewebauthn/browser";

/** @type {{ credentials: Array, loading: boolean, error: string|null }} */
const panelState = {
  credentials: [],
  loading: false,
  error: null,
};

/**
 * Fetch JSON from a WebAuthn API endpoint.
 * @param {string} path
 * @param {object} [body]
 * @param {string} [token]
 * @returns {Promise<object>}
 */
export async function webauthnFetch(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`/api/webauthn/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

/**
 * Check if WebAuthn/Touch ID is available in this browser.
 * @returns {Promise<boolean>}
 */
export async function isWebAuthnAvailable() {
  if (!window.PublicKeyCredential) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Load credential list via RPC and update panelState.
 * Exported so callers (e.g. connectGateway) can preload credentials on startup,
 * making hasRegisteredCredentials() accurate before tab-lock checks.
 * @param {object} client - WebSocket RPC client from app
 * @param {Function} [requestUpdate] - optional Lit requestUpdate callback
 */
export async function loadWebAuthnCredentials(client, requestUpdate) {
  panelState.loading = true;
  panelState.error = null;
  requestUpdate?.();
  try {
    const res = await client.request("webauthn.credentials.list", {});
    panelState.credentials = res?.credentials ?? [];
  } catch (err) {
    panelState.error = err?.message ?? "Failed to load credentials";
  } finally {
    panelState.loading = false;
    requestUpdate?.();
  }
}

/**
 * Perform a WebAuthn authentication ceremony.
 * Returns the session token on success, null on cancel/failure.
 * @returns {Promise<string|null>}
 */
export async function authenticateWithWebAuthn() {
  try {
    const optionsRes = await webauthnFetch("auth/options");
    if (optionsRes.error) {
      return null;
    }

    const assertion = await startAuthentication({ optionsJSON: optionsRes.options });
    const verifyRes = await webauthnFetch("auth/verify", {
      challengeKey: optionsRes.challengeKey,
      assertion,
    });
    if (verifyRes.error) {
      return null;
    }

    return verifyRes.sessionToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if any WebAuthn credentials are registered (cached from last load).
 * @returns {boolean}
 */
export function hasRegisteredCredentials() {
  return panelState.credentials.length > 0;
}
