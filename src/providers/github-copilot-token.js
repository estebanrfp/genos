let resolveCopilotTokenCachePath = function (env = process.env) {
    return path.join(resolveStateDir(env), "credentials", "github-copilot.token.json");
  },
  isTokenUsable = function (cache, now = Date.now()) {
    return cache.expiresAt - now > 300000;
  },
  parseCopilotTokenResponse = function (value) {
    if (!value || typeof value !== "object") {
      throw new Error("Unexpected response from GitHub Copilot token endpoint");
    }
    const asRecord = value;
    const token = asRecord.token;
    const expiresAt = asRecord.expires_at;
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new Error("Copilot token response missing token");
    }
    let expiresAtMs;
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
      expiresAtMs = expiresAt > 10000000000 ? expiresAt : expiresAt * 1000;
    } else if (typeof expiresAt === "string" && expiresAt.trim().length > 0) {
      const parsed = Number.parseInt(expiresAt, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error("Copilot token response has invalid expires_at");
      }
      expiresAtMs = parsed > 10000000000 ? parsed : parsed * 1000;
    } else {
      throw new Error("Copilot token response missing expires_at");
    }
    return { token, expiresAt: expiresAtMs };
  };
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
export const DEFAULT_COPILOT_API_BASE_URL = "https://api.individual.githubcopilot.com";
export function deriveCopilotApiBaseUrlFromToken(token) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) {
    return null;
  }
  const host = proxyEp.replace(/^https?:\/\//, "").replace(/^proxy\./i, "api.");
  if (!host) {
    return null;
  }
  return `https://${host}`;
}
export async function resolveCopilotApiToken(params) {
  const env = params.env ?? process.env;
  const cachePath = params.cachePath?.trim() || resolveCopilotTokenCachePath(env);
  const loadJsonFileFn = params.loadJsonFileImpl ?? loadJsonFile;
  const saveJsonFileFn = params.saveJsonFileImpl ?? saveJsonFile;
  const cached = loadJsonFileFn(cachePath);
  if (cached && typeof cached.token === "string" && typeof cached.expiresAt === "number") {
    if (isTokenUsable(cached)) {
      return {
        token: cached.token,
        expiresAt: cached.expiresAt,
        source: `cache:${cachePath}`,
        baseUrl: deriveCopilotApiBaseUrlFromToken(cached.token) ?? DEFAULT_COPILOT_API_BASE_URL,
      };
    }
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const res = await fetchImpl(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.githubToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Copilot token exchange failed: HTTP ${res.status}`);
  }
  const json = parseCopilotTokenResponse(await res.json());
  const payload = {
    token: json.token,
    expiresAt: json.expiresAt,
    updatedAt: Date.now(),
  };
  saveJsonFileFn(cachePath, payload);
  return {
    token: payload.token,
    expiresAt: payload.expiresAt,
    source: `fetched:${COPILOT_TOKEN_URL}`,
    baseUrl: deriveCopilotApiBaseUrlFromToken(payload.token) ?? DEFAULT_COPILOT_API_BASE_URL,
  };
}
