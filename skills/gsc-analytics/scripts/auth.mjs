#!/usr/bin/env node

/**
 * GSC authentication helper — JWT-based OAuth2 for Google Search Console.
 * Reads GOOGLE_SERVICE_ACCOUNT_JSON from env, returns access_token to stdout.
 * @module gsc-analytics/auth
 */

import { createSign } from "node:crypto";

const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
if (!raw) {
  console.error("Missing GOOGLE_SERVICE_ACCOUNT_JSON env var");
  process.exit(1);
}

const sa = JSON.parse(raw);
const now = Math.floor(Date.now() / 1000);

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

const header = encode({ alg: "RS256", typ: "JWT" });
const claims = encode({
  iss: sa.client_email,
  scope: "https://www.googleapis.com/auth/webmasters.readonly",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
});

const sign = createSign("RSA-SHA256");
sign.update(`${header}.${claims}`);
const signature = sign.sign(sa.private_key, "base64url");

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claims}.${signature}`,
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Auth failed (${res.status}): ${text}`);
  process.exit(1);
}

const { access_token } = await res.json();
console.log(access_token);
