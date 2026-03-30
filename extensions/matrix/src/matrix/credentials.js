let credentialsFilename = function (accountId) {
  const normalized = normalizeAccountId(accountId);
  if (normalized === DEFAULT_ACCOUNT_ID) {
    return "credentials.json";
  }
  return `credentials-${normalized}.json`;
};
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "genosos/plugin-sdk/account-id";
import { getMatrixRuntime } from "../runtime.js";
export function resolveMatrixCredentialsDir(env = process.env, stateDir) {
  const resolvedStateDir = stateDir ?? getMatrixRuntime().state.resolveStateDir(env, os.homedir);
  return path.join(resolvedStateDir, "credentials", "matrix");
}
export function resolveMatrixCredentialsPath(env = process.env, accountId) {
  const dir = resolveMatrixCredentialsDir(env);
  return path.join(dir, credentialsFilename(accountId));
}
export function loadMatrixCredentials(env = process.env, accountId) {
  const credPath = resolveMatrixCredentialsPath(env, accountId);
  try {
    if (!fs.existsSync(credPath)) {
      return null;
    }
    const raw = fs.readFileSync(credPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.homeserver !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.accessToken !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
export function saveMatrixCredentials(credentials, env = process.env, accountId) {
  const dir = resolveMatrixCredentialsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const credPath = resolveMatrixCredentialsPath(env, accountId);
  const existing = loadMatrixCredentials(env, accountId);
  const now = new Date().toISOString();
  const toSave = {
    ...credentials,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
  };
  fs.writeFileSync(credPath, JSON.stringify(toSave, null, 2), "utf-8");
}
export function touchMatrixCredentials(env = process.env, accountId) {
  const existing = loadMatrixCredentials(env, accountId);
  if (!existing) {
    return;
  }
  existing.lastUsedAt = new Date().toISOString();
  const credPath = resolveMatrixCredentialsPath(env, accountId);
  fs.writeFileSync(credPath, JSON.stringify(existing, null, 2), "utf-8");
}
export function clearMatrixCredentials(env = process.env, accountId) {
  const credPath = resolveMatrixCredentialsPath(env, accountId);
  try {
    if (fs.existsSync(credPath)) {
      fs.unlinkSync(credPath);
    }
  } catch {}
}
export function credentialsMatchConfig(stored, config) {
  if (!config.userId) {
    return stored.homeserver === config.homeserver;
  }
  return stored.homeserver === config.homeserver && stored.userId === config.userId;
}
