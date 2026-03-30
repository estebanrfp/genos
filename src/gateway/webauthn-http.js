// GenosOS — Esteban & Nyx 🦀🌙
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { auditEvent } from "../infra/audit-log.js";
import {
  loadCredentials,
  saveCredential,
  updateCredentialCounter,
} from "../infra/webauthn-store.js";
import { authorizeGatewayConnect } from "./auth.js";
import {
  readJsonBodyOrError,
  sendGatewayAuthFailure,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { resolveGatewayClientIp } from "./net.js";

const CHALLENGE_TTL_MS = 60_000;
const SESSION_TTL_MS = 30 * 60_000;

/** @type {Map<string, { challenge: string, createdAt: number }>} */
const challengeStore = new Map();

/** @type {Map<string, { credentialId: string, createdAt: number }>} */
const sessionStore = new Map();

/** Purge expired challenges periodically. */
const purgeExpired = () => {
  const now = Date.now();
  for (const [key, entry] of challengeStore) {
    if (now - entry.createdAt > CHALLENGE_TTL_MS) {
      challengeStore.delete(key);
    }
  }
  for (const [key, entry] of sessionStore) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      sessionStore.delete(key);
    }
  }
};

setInterval(purgeExpired, 30_000).unref?.();

/**
 * Verify a WebAuthn session token.
 * @param {string} token
 * @returns {boolean}
 */
export function verifyWebAuthnSession(token) {
  const session = sessionStore.get(token);
  if (!session) {
    return false;
  }
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessionStore.delete(token);
    return false;
  }
  return true;
}

/**
 * Handle WebAuthn HTTP requests.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {{ auth: object, trustedProxies?: string[], rateLimiter?: object, stateDir?: string }} opts
 * @returns {Promise<boolean>}
 */
export async function handleWebAuthnRequest(req, res, opts) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/webauthn/")) {
    return false;
  }

  const route = url.pathname.slice("/api/webauthn/".length);

  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }

  const { auth, trustedProxies = [], rateLimiter, stateDir } = opts;

  // Registration endpoints require gateway token auth
  if (route === "register/options" || route === "register/verify") {
    const token = getBearerToken(req);
    const authResult = await authorizeGatewayConnect({
      auth,
      connectAuth: token ? { token, password: token } : null,
      req,
      trustedProxies,
      rateLimiter,
    });
    if (!authResult.ok) {
      sendGatewayAuthFailure(res, authResult);
      return true;
    }
  }

  try {
    if (route === "register/options") {
      return await handleRegisterOptions(req, res, stateDir);
    }
    if (route === "register/verify") {
      return await handleRegisterVerify(req, res, stateDir);
    }
    if (route === "auth/options") {
      return await handleAuthOptions(req, res, stateDir);
    }
    if (route === "auth/verify") {
      // Rate limit WebAuthn auth verification attempts
      if (rateLimiter) {
        const ip = resolveGatewayClientIp({
          remoteAddr: req.socket?.remoteAddress ?? "",
          forwardedFor: req.headers?.["x-forwarded-for"],
          realIp: req.headers?.["x-real-ip"],
          trustedProxies,
        });
        const rlCheck = rateLimiter.check(ip, "webauthn");
        if (!rlCheck.allowed) {
          sendJson(res, 429, {
            error: {
              message: "Too many attempts",
              type: "rate_limited",
              retryAfterMs: rlCheck.retryAfterMs,
            },
          });
          return true;
        }
      }
      return await handleAuthVerify(req, res, stateDir, { rateLimiter, trustedProxies });
    }
  } catch (err) {
    sendJson(res, 500, { error: { message: String(err?.message ?? err), type: "server_error" } });
    return true;
  }

  sendJson(res, 404, { error: { message: "Not found", type: "not_found" } });
  return true;
}

/**
 * POST /api/webauthn/register/options — generate registration challenge.
 */
async function handleRegisterOptions(req, res, stateDir) {
  const store = await loadCredentials(stateDir);
  const body = await readJsonBodyOrError(req, res, 4096);
  if (body === undefined) {
    return true;
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "Touch ID";

  const options = await generateRegistrationOptions({
    rpName: store.rpName,
    rpID: store.rpId,
    userName: "owner",
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: store.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
  });

  const challengeKey = `reg:${randomBytes(16).toString("hex")}`;
  challengeStore.set(challengeKey, { challenge: options.challenge, createdAt: Date.now() });

  sendJson(res, 200, { options, challengeKey });
  return true;
}

/**
 * POST /api/webauthn/register/verify — verify attestation + store credential.
 */
async function handleRegisterVerify(req, res, stateDir) {
  const body = await readJsonBodyOrError(req, res, 65_536);
  if (body === undefined) {
    return true;
  }

  const { challengeKey, attestation, displayName } = body;
  if (!challengeKey || !attestation) {
    sendInvalidRequest(res, "Missing challengeKey or attestation");
    return true;
  }

  const stored = challengeStore.get(challengeKey);
  if (!stored || Date.now() - stored.createdAt > CHALLENGE_TTL_MS) {
    challengeStore.delete(challengeKey);
    sendJson(res, 400, { error: { message: "Challenge expired", type: "challenge_expired" } });
    return true;
  }
  challengeStore.delete(challengeKey);

  const store = await loadCredentials(stateDir);

  const verification = await verifyRegistrationResponse({
    response: attestation,
    expectedChallenge: stored.challenge,
    expectedOrigin: resolveExpectedOrigins(),
    expectedRPID: store.rpId,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    sendJson(res, 400, { error: { message: "Verification failed", type: "verification_failed" } });
    return true;
  }

  const { credential } = verification.registrationInfo;

  await saveCredential(
    {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      displayName: typeof displayName === "string" ? displayName.trim() : "Touch ID",
      transports: attestation.response?.transports ?? ["internal"],
    },
    stateDir,
  );

  sendJson(res, 200, { ok: true, credentialId: credential.id });
  return true;
}

/**
 * POST /api/webauthn/auth/options — generate authentication challenge.
 */
async function handleAuthOptions(req, res, stateDir) {
  const store = await loadCredentials(stateDir);
  if (store.credentials.length === 0) {
    sendJson(res, 400, {
      error: { message: "No credentials registered", type: "no_credentials" },
    });
    return true;
  }

  const options = await generateAuthenticationOptions({
    rpID: store.rpId,
    allowCredentials: store.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    userVerification: "required",
  });

  const challengeKey = `auth:${randomBytes(16).toString("hex")}`;
  challengeStore.set(challengeKey, { challenge: options.challenge, createdAt: Date.now() });

  sendJson(res, 200, { options, challengeKey });
  return true;
}

/**
 * POST /api/webauthn/auth/verify — verify assertion + issue session token.
 */
async function handleAuthVerify(req, res, stateDir, rateOpts = {}) {
  const body = await readJsonBodyOrError(req, res, 65_536);
  if (body === undefined) {
    return true;
  }

  const { challengeKey, assertion } = body;
  if (!challengeKey || !assertion) {
    sendInvalidRequest(res, "Missing challengeKey or assertion");
    return true;
  }

  const stored = challengeStore.get(challengeKey);
  if (!stored || Date.now() - stored.createdAt > CHALLENGE_TTL_MS) {
    challengeStore.delete(challengeKey);
    sendJson(res, 400, { error: { message: "Challenge expired", type: "challenge_expired" } });
    return true;
  }
  challengeStore.delete(challengeKey);

  const resolveIp = () =>
    resolveGatewayClientIp({
      remoteAddr: req.socket?.remoteAddress ?? "",
      forwardedFor: req.headers?.["x-forwarded-for"],
      realIp: req.headers?.["x-real-ip"],
      trustedProxies: rateOpts.trustedProxies,
    });

  const store = await loadCredentials(stateDir);
  const matchedCred = store.credentials.find((c) => c.id === assertion.id);
  if (!matchedCred) {
    rateOpts.rateLimiter?.recordFailure(resolveIp(), "webauthn");
    sendJson(res, 400, { error: { message: "Unknown credential", type: "unknown_credential" } });
    return true;
  }

  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: stored.challenge,
    expectedOrigin: resolveExpectedOrigins(),
    expectedRPID: store.rpId,
    credential: {
      id: matchedCred.id,
      publicKey: Buffer.from(matchedCred.publicKey, "base64url"),
      counter: matchedCred.counter,
      transports: matchedCred.transports,
    },
    requireUserVerification: true,
  });

  if (!verification.verified) {
    rateOpts.rateLimiter?.recordFailure(resolveIp(), "webauthn");
    auditEvent("webauthn.auth.failure", {
      credentialId: matchedCred.id,
      reason: "verification_failed",
    });
    sendJson(res, 400, { error: { message: "Verification failed", type: "verification_failed" } });
    return true;
  }

  await updateCredentialCounter(
    matchedCred.id,
    verification.authenticationInfo.newCounter,
    stateDir,
  );

  const sessionToken = randomBytes(32).toString("hex");
  sessionStore.set(sessionToken, { credentialId: matchedCred.id, createdAt: Date.now() });

  auditEvent("webauthn.auth.success", { credentialId: matchedCred.id });
  sendJson(res, 200, { ok: true, sessionToken });
  return true;
}

/**
 * Resolve expected WebAuthn origins for localhost.
 * @returns {string[]}
 */
function resolveExpectedOrigins() {
  return [
    "http://localhost:18789",
    "http://127.0.0.1:18789",
    "https://localhost:18789",
    "https://127.0.0.1:18789",
  ];
}
