let isSurfaceGroupKey = function (key) {
    return key.includes(":group:") || key.includes(":channel:");
  },
  isLegacyGroupKey = function (key) {
    const trimmed = key.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed.startsWith("group:")) {
      return true;
    }
    const lower = trimmed.toLowerCase();
    if (!lower.includes("@g.us")) {
      return false;
    }
    if (!trimmed.includes(":")) {
      return true;
    }
    if (lower.startsWith("whatsapp:") && !trimmed.includes(":group:")) {
      return true;
    }
    return false;
  },
  canonicalizeSessionKeyForAgent = function (params) {
    const agentId = normalizeAgentId(params.agentId);
    const raw = params.key.trim();
    if (!raw) {
      return raw;
    }
    if (raw.toLowerCase() === "global" || raw.toLowerCase() === "unknown") {
      return raw.toLowerCase();
    }
    const canonicalMain = canonicalizeMainSessionAlias({
      cfg: { session: { scope: params.scope, mainKey: params.mainKey } },
      agentId,
      sessionKey: raw,
    });
    if (canonicalMain !== raw) {
      return canonicalMain.toLowerCase();
    }
    if (raw.toLowerCase().startsWith("agent:")) {
      return raw.toLowerCase();
    }
    if (raw.toLowerCase().startsWith("subagent:")) {
      const rest = raw.slice("subagent:".length);
      return `agent:${agentId}:subagent:${rest}`.toLowerCase();
    }
    if (raw.startsWith("group:")) {
      const id = raw.slice("group:".length).trim();
      if (!id) {
        return raw;
      }
      const channel = id.toLowerCase().includes("@g.us") ? "whatsapp" : "unknown";
      return `agent:${agentId}:${channel}:group:${id}`.toLowerCase();
    }
    if (!raw.includes(":") && raw.toLowerCase().includes("@g.us")) {
      return `agent:${agentId}:whatsapp:group:${raw}`.toLowerCase();
    }
    if (raw.toLowerCase().startsWith("whatsapp:") && raw.toLowerCase().includes("@g.us")) {
      const remainder = raw.slice("whatsapp:".length).trim();
      const cleaned = remainder.replace(/^group:/i, "").trim();
      if (cleaned && !isSurfaceGroupKey(raw)) {
        return `agent:${agentId}:whatsapp:group:${cleaned}`.toLowerCase();
      }
    }
    if (isSurfaceGroupKey(raw)) {
      return `agent:${agentId}:${raw}`.toLowerCase();
    }
    return `agent:${agentId}:${raw}`.toLowerCase();
  },
  pickLatestLegacyDirectEntry = function (store) {
    let best = null;
    let bestUpdated = -1;
    for (const [key, entry] of Object.entries(store)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const normalized = key.trim();
      if (!normalized) {
        continue;
      }
      if (normalized === "global") {
        continue;
      }
      if (normalized.startsWith("agent:")) {
        continue;
      }
      if (normalized.toLowerCase().startsWith("subagent:")) {
        continue;
      }
      if (isLegacyGroupKey(normalized) || isSurfaceGroupKey(normalized)) {
        continue;
      }
      const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : 0;
      if (updatedAt > bestUpdated) {
        bestUpdated = updatedAt;
        best = entry;
      }
    }
    return best;
  },
  normalizeSessionEntry = function (entry) {
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : null;
    if (!sessionId) {
      return null;
    }
    const updatedAt =
      typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : Date.now();
    const normalized = { ...entry, sessionId, updatedAt };
    const rec = normalized;
    if (typeof rec.groupChannel !== "string" && typeof rec.room === "string") {
      rec.groupChannel = rec.room;
    }
    delete rec.room;
    return normalized;
  },
  resolveUpdatedAt = function (entry) {
    return typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
      ? entry.updatedAt
      : 0;
  },
  mergeSessionEntry = function (params) {
    if (!params.existing) {
      return params.incoming;
    }
    const existingUpdated = resolveUpdatedAt(params.existing);
    const incomingUpdated = resolveUpdatedAt(params.incoming);
    if (incomingUpdated > existingUpdated) {
      return params.incoming;
    }
    if (incomingUpdated < existingUpdated) {
      return params.existing;
    }
    return params.preferIncomingOnTie ? params.incoming : params.existing;
  },
  canonicalizeSessionStore = function (params) {
    const canonical = {};
    const meta = new Map();
    const legacyKeys = [];
    for (const [key, entry] of Object.entries(params.store)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const canonicalKey = canonicalizeSessionKeyForAgent({
        key,
        agentId: params.agentId,
        mainKey: params.mainKey,
        scope: params.scope,
      });
      const isCanonical = canonicalKey === key;
      if (!isCanonical) {
        legacyKeys.push(key);
      }
      const existing = canonical[canonicalKey];
      if (!existing) {
        canonical[canonicalKey] = entry;
        meta.set(canonicalKey, { isCanonical, updatedAt: resolveUpdatedAt(entry) });
        continue;
      }
      const existingMeta = meta.get(canonicalKey);
      const incomingUpdated = resolveUpdatedAt(entry);
      const existingUpdated = existingMeta?.updatedAt ?? resolveUpdatedAt(existing);
      if (incomingUpdated > existingUpdated) {
        canonical[canonicalKey] = entry;
        meta.set(canonicalKey, { isCanonical, updatedAt: incomingUpdated });
        continue;
      }
      if (incomingUpdated < existingUpdated) {
        continue;
      }
      if (existingMeta?.isCanonical && !isCanonical) {
        continue;
      }
      if (!existingMeta?.isCanonical && isCanonical) {
        canonical[canonicalKey] = entry;
        meta.set(canonicalKey, { isCanonical, updatedAt: incomingUpdated });
        continue;
      }
    }
    return { store: canonical, legacyKeys };
  },
  listLegacySessionKeys = function (params) {
    const legacy = [];
    for (const key of Object.keys(params.store)) {
      const canonical = canonicalizeSessionKeyForAgent({
        key,
        agentId: params.agentId,
        mainKey: params.mainKey,
        scope: params.scope,
      });
      if (canonical !== key) {
        legacy.push(key);
      }
    }
    return legacy;
  },
  emptyDirOrMissing = function (dir) {
    if (!existsDir(dir)) {
      return true;
    }
    return safeReadDir(dir).length === 0;
  },
  removeDirIfEmpty = function (dir) {
    if (!existsDir(dir)) {
      return;
    }
    if (!emptyDirOrMissing(dir)) {
      return;
    }
    try {
      fs.rmdirSync(dir);
    } catch {}
  },
  resolveSymlinkTarget = function (linkPath) {
    try {
      const target = fs.readlinkSync(linkPath);
      return path.resolve(path.dirname(linkPath), target);
    } catch {
      return null;
    }
  },
  formatStateDirMigration = function (legacyDir, targetDir) {
    return `State dir: ${legacyDir} \u2192 ${targetDir} (legacy path now symlinked)`;
  },
  isDirPath = function (filePath) {
    try {
      return fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  },
  isLegacyTreeSymlinkMirror = function (currentDir, realTargetDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return false;
    }
    if (entries.length === 0) {
      return false;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(entryPath);
      } catch {
        return false;
      }
      if (stat.isSymbolicLink()) {
        const resolvedTarget = resolveSymlinkTarget(entryPath);
        if (!resolvedTarget) {
          return false;
        }
        let resolvedRealTarget;
        try {
          resolvedRealTarget = fs.realpathSync(resolvedTarget);
        } catch {
          return false;
        }
        if (!isWithinDir(realTargetDir, resolvedRealTarget)) {
          return false;
        }
        continue;
      }
      if (stat.isDirectory()) {
        if (!isLegacyTreeSymlinkMirror(entryPath, realTargetDir)) {
          return false;
        }
        continue;
      }
      return false;
    }
    return true;
  },
  isLegacyDirSymlinkMirror = function (legacyDir, targetDir) {
    let realTargetDir;
    try {
      realTargetDir = fs.realpathSync(targetDir);
    } catch {
      return false;
    }
    return isLegacyTreeSymlinkMirror(legacyDir, realTargetDir);
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveOAuthDir, resolveStateDir } from "../config/paths.js";
import { saveSessionStore } from "../config/sessions.js";
import { canonicalizeMainSessionAlias } from "../config/sessions/main-session.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildAgentMainSessionKey,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_MAIN_KEY,
  normalizeAgentId,
} from "../routing/session-key.js";
import { isWithinDir } from "./path-safety.js";
import {
  ensureDir,
  existsDir,
  fileExists,
  isLegacyWhatsAppAuthFile,
  readSessionStoreJson5,
  safeReadDir,
} from "./state-migrations.fs.js";
let autoMigrateChecked = false;
let autoMigrateStateDirChecked = false;
export function resetAutoMigrateLegacyStateForTest() {
  autoMigrateChecked = false;
}
export function resetAutoMigrateLegacyAgentDirForTest() {
  resetAutoMigrateLegacyStateForTest();
}
export function resetAutoMigrateLegacyStateDirForTest() {
  autoMigrateStateDirChecked = false;
}
export async function autoMigrateLegacyStateDir() {
  return { migrated: false, skipped: true, changes: [], warnings: [] };
}
async function _legacyAutoMigrateLegacyStateDir(params) {
  if (autoMigrateStateDirChecked) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }
  autoMigrateStateDirChecked = true;
  const env = params.env ?? process.env;
  if (env.GENOS_STATE_DIR?.trim()) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }
  const targetDir = resolveStateDir(env);
  const legacyDirs = [];
  let legacyDir = legacyDirs.find((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
  const warnings = [];
  const changes = [];
  let legacyStat = null;
  try {
    legacyStat = legacyDir ? fs.lstatSync(legacyDir) : null;
  } catch {
    legacyStat = null;
  }
  if (!legacyStat) {
    return { migrated: false, skipped: false, changes, warnings };
  }
  if (!legacyStat.isDirectory() && !legacyStat.isSymbolicLink()) {
    warnings.push(`Legacy state path is not a directory: ${legacyDir}`);
    return { migrated: false, skipped: false, changes, warnings };
  }
  let symlinkDepth = 0;
  while (legacyStat.isSymbolicLink()) {
    const legacyTarget = legacyDir ? resolveSymlinkTarget(legacyDir) : null;
    if (!legacyTarget) {
      warnings.push(
        `Legacy state dir is a symlink (${legacyDir ?? "unknown"}); could not resolve target.`,
      );
      return { migrated: false, skipped: false, changes, warnings };
    }
    if (path.resolve(legacyTarget) === path.resolve(targetDir)) {
      return { migrated: false, skipped: false, changes, warnings };
    }
    if (legacyDirs.some((dir) => path.resolve(dir) === path.resolve(legacyTarget))) {
      legacyDir = legacyTarget;
      try {
        legacyStat = fs.lstatSync(legacyDir);
      } catch {
        legacyStat = null;
      }
      if (!legacyStat) {
        warnings.push(`Legacy state dir missing after symlink resolution: ${legacyDir}`);
        return { migrated: false, skipped: false, changes, warnings };
      }
      if (!legacyStat.isDirectory() && !legacyStat.isSymbolicLink()) {
        warnings.push(`Legacy state path is not a directory: ${legacyDir}`);
        return { migrated: false, skipped: false, changes, warnings };
      }
      symlinkDepth += 1;
      if (symlinkDepth > 2) {
        warnings.push(`Legacy state dir symlink chain too deep: ${legacyDir}`);
        return { migrated: false, skipped: false, changes, warnings };
      }
      continue;
    }
    warnings.push(
      `Legacy state dir is a symlink (${legacyDir ?? "unknown"} \u2192 ${legacyTarget}); skipping auto-migration.`,
    );
    return { migrated: false, skipped: false, changes, warnings };
  }
  if (isDirPath(targetDir)) {
    if (legacyDir && isLegacyDirSymlinkMirror(legacyDir, targetDir)) {
      return { migrated: false, skipped: false, changes, warnings };
    }
    warnings.push(
      `State dir migration skipped: target already exists (${targetDir}). Remove or merge manually.`,
    );
    return { migrated: false, skipped: false, changes, warnings };
  }
  try {
    if (!legacyDir) {
      throw new Error("Legacy state dir not found");
    }
    fs.renameSync(legacyDir, targetDir);
  } catch (err) {
    warnings.push(
      `Failed to move legacy state dir (${legacyDir ?? "unknown"} \u2192 ${targetDir}): ${String(err)}`,
    );
    return { migrated: false, skipped: false, changes, warnings };
  }
  try {
    if (!legacyDir) {
      throw new Error("Legacy state dir not found");
    }
    fs.symlinkSync(targetDir, legacyDir, "dir");
    changes.push(formatStateDirMigration(legacyDir, targetDir));
  } catch (err) {
    try {
      if (process.platform === "win32") {
        if (!legacyDir) {
          throw new Error("Legacy state dir not found", { cause: err });
        }
        fs.symlinkSync(targetDir, legacyDir, "junction");
        changes.push(formatStateDirMigration(legacyDir, targetDir));
      } else {
        throw err;
      }
    } catch (fallbackErr) {
      try {
        if (!legacyDir) {
          throw new Error("Legacy state dir not found", { cause: fallbackErr });
        }
        fs.renameSync(targetDir, legacyDir);
        warnings.push(
          `State dir migration rolled back (failed to link legacy path): ${String(fallbackErr)}`,
        );
        return { migrated: false, skipped: false, changes: [], warnings };
      } catch (rollbackErr) {
        warnings.push(
          `State dir moved but failed to link legacy path (${legacyDir ?? "unknown"} \u2192 ${targetDir}): ${String(fallbackErr)}`,
        );
        warnings.push(
          `Rollback failed; set GENOS_STATE_DIR=${targetDir} to avoid split state: ${String(rollbackErr)}`,
        );
        changes.push(`State dir: ${legacyDir ?? "unknown"} \u2192 ${targetDir}`);
      }
    }
  }
  return { migrated: changes.length > 0, skipped: false, changes, warnings };
}
export async function detectLegacyStateMigrations(params) {
  const env = params.env ?? process.env;
  const homedir = params.homedir ?? os.homedir;
  const stateDir = resolveStateDir(env, homedir);
  const oauthDir = resolveOAuthDir(env, stateDir);
  const targetAgentId = normalizeAgentId(resolveDefaultAgentId(params.cfg));
  const rawMainKey = params.cfg.session?.mainKey;
  const targetMainKey =
    typeof rawMainKey === "string" && rawMainKey.trim().length > 0
      ? rawMainKey.trim()
      : DEFAULT_MAIN_KEY;
  const targetScope = params.cfg.session?.scope;
  const sessionsLegacyDir = path.join(stateDir, "sessions");
  const sessionsLegacyStorePath = path.join(sessionsLegacyDir, "sessions.json");
  const sessionsTargetDir = path.join(stateDir, "agents", targetAgentId, "sessions");
  const sessionsTargetStorePath = path.join(sessionsTargetDir, "sessions.json");
  const legacySessionEntries = safeReadDir(sessionsLegacyDir);
  const hasLegacySessions =
    fileExists(sessionsLegacyStorePath) ||
    legacySessionEntries.some((e) => e.isFile() && e.name.endsWith(".jsonl"));
  const targetSessionParsed = fileExists(sessionsTargetStorePath)
    ? readSessionStoreJson5(sessionsTargetStorePath)
    : { store: {}, ok: true };
  const legacyKeys = targetSessionParsed.ok
    ? listLegacySessionKeys({
        store: targetSessionParsed.store,
        agentId: targetAgentId,
        mainKey: targetMainKey,
        scope: targetScope,
      })
    : [];
  const legacyAgentDir = path.join(stateDir, "agent");
  const targetAgentDir = path.join(stateDir, "agents", targetAgentId, "agent");
  const hasLegacyAgentDir = existsDir(legacyAgentDir);
  const targetWhatsAppAuthDir = path.join(oauthDir, "whatsapp", DEFAULT_ACCOUNT_ID);
  const hasLegacyWhatsAppAuth =
    fileExists(path.join(oauthDir, "creds.json")) &&
    !fileExists(path.join(targetWhatsAppAuthDir, "creds.json"));
  const legacyTelegramAllowFromPath = path.join(oauthDir, "telegram-allowFrom.json");
  const targetTelegramAllowFromPath = path.join(
    oauthDir,
    `telegram-${DEFAULT_ACCOUNT_ID}-allowFrom.json`,
  );
  const hasLegacyTelegramAllowFrom =
    fileExists(legacyTelegramAllowFromPath) && !fileExists(targetTelegramAllowFromPath);
  const preview = [];
  if (hasLegacySessions) {
    preview.push(`- Sessions: ${sessionsLegacyDir} \u2192 ${sessionsTargetDir}`);
  }
  if (legacyKeys.length > 0) {
    preview.push(`- Sessions: canonicalize legacy keys in ${sessionsTargetStorePath}`);
  }
  if (hasLegacyAgentDir) {
    preview.push(`- Agent dir: ${legacyAgentDir} \u2192 ${targetAgentDir}`);
  }
  if (hasLegacyWhatsAppAuth) {
    preview.push(`- WhatsApp auth: ${oauthDir} \u2192 ${targetWhatsAppAuthDir} (keep oauth.json)`);
  }
  if (hasLegacyTelegramAllowFrom) {
    preview.push(
      `- Telegram pairing allowFrom: ${legacyTelegramAllowFromPath} \u2192 ${targetTelegramAllowFromPath}`,
    );
  }
  return {
    targetAgentId,
    targetMainKey,
    targetScope,
    stateDir,
    oauthDir,
    sessions: {
      legacyDir: sessionsLegacyDir,
      legacyStorePath: sessionsLegacyStorePath,
      targetDir: sessionsTargetDir,
      targetStorePath: sessionsTargetStorePath,
      hasLegacy: hasLegacySessions || legacyKeys.length > 0,
      legacyKeys,
    },
    agentDir: {
      legacyDir: legacyAgentDir,
      targetDir: targetAgentDir,
      hasLegacy: hasLegacyAgentDir,
    },
    whatsappAuth: {
      legacyDir: oauthDir,
      targetDir: targetWhatsAppAuthDir,
      hasLegacy: hasLegacyWhatsAppAuth,
    },
    pairingAllowFrom: {
      legacyTelegramPath: legacyTelegramAllowFromPath,
      targetTelegramPath: targetTelegramAllowFromPath,
      hasLegacyTelegram: hasLegacyTelegramAllowFrom,
    },
    preview,
  };
}
async function migrateLegacySessions(detected, now) {
  const changes = [];
  const warnings = [];
  if (!detected.sessions.hasLegacy) {
    return { changes, warnings };
  }
  ensureDir(detected.sessions.targetDir);
  const legacyParsed = fileExists(detected.sessions.legacyStorePath)
    ? readSessionStoreJson5(detected.sessions.legacyStorePath)
    : { store: {}, ok: true };
  const targetParsed = fileExists(detected.sessions.targetStorePath)
    ? readSessionStoreJson5(detected.sessions.targetStorePath)
    : { store: {}, ok: true };
  const legacyStore = legacyParsed.store;
  const targetStore = targetParsed.store;
  const canonicalizedTarget = canonicalizeSessionStore({
    store: targetStore,
    agentId: detected.targetAgentId,
    mainKey: detected.targetMainKey,
    scope: detected.targetScope,
  });
  const canonicalizedLegacy = canonicalizeSessionStore({
    store: legacyStore,
    agentId: detected.targetAgentId,
    mainKey: detected.targetMainKey,
    scope: detected.targetScope,
  });
  const merged = { ...canonicalizedTarget.store };
  for (const [key, entry] of Object.entries(canonicalizedLegacy.store)) {
    merged[key] = mergeSessionEntry({
      existing: merged[key],
      incoming: entry,
      preferIncomingOnTie: false,
    });
  }
  const mainKey = buildAgentMainSessionKey({
    agentId: detected.targetAgentId,
    mainKey: detected.targetMainKey,
  });
  if (!merged[mainKey]) {
    const latest = pickLatestLegacyDirectEntry(legacyStore);
    if (latest?.sessionId) {
      merged[mainKey] = latest;
      changes.push(`Migrated latest direct-chat session \u2192 ${mainKey}`);
    }
  }
  if (!legacyParsed.ok) {
    warnings.push(
      `Legacy sessions store unreadable; left in place at ${detected.sessions.legacyStorePath}`,
    );
  }
  if (
    (legacyParsed.ok || targetParsed.ok) &&
    (Object.keys(legacyStore).length > 0 || Object.keys(targetStore).length > 0)
  ) {
    const normalized = {};
    for (const [key, entry] of Object.entries(merged)) {
      const normalizedEntry = normalizeSessionEntry(entry);
      if (!normalizedEntry) {
        continue;
      }
      normalized[key] = normalizedEntry;
    }
    await saveSessionStore(detected.sessions.targetStorePath, normalized, {
      skipMaintenance: true,
    });
    changes.push(`Merged sessions store \u2192 ${detected.sessions.targetStorePath}`);
    if (canonicalizedTarget.legacyKeys.length > 0) {
      changes.push(`Canonicalized ${canonicalizedTarget.legacyKeys.length} legacy session key(s)`);
    }
  }
  const entries = safeReadDir(detected.sessions.legacyDir);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === "sessions.json") {
      continue;
    }
    const from = path.join(detected.sessions.legacyDir, entry.name);
    const to = path.join(detected.sessions.targetDir, entry.name);
    if (fileExists(to)) {
      continue;
    }
    try {
      fs.renameSync(from, to);
      changes.push(`Moved ${entry.name} \u2192 agents/${detected.targetAgentId}/sessions`);
    } catch (err) {
      warnings.push(`Failed moving ${from}: ${String(err)}`);
    }
  }
  if (legacyParsed.ok) {
    try {
      if (fileExists(detected.sessions.legacyStorePath)) {
        fs.rmSync(detected.sessions.legacyStorePath, { force: true });
      }
    } catch {}
  }
  removeDirIfEmpty(detected.sessions.legacyDir);
  const legacyLeft = safeReadDir(detected.sessions.legacyDir).filter((e) => e.isFile());
  if (legacyLeft.length > 0) {
    const backupDir = `${detected.sessions.legacyDir}.legacy-${now()}`;
    try {
      fs.renameSync(detected.sessions.legacyDir, backupDir);
      warnings.push(`Left legacy sessions at ${backupDir}`);
    } catch {}
  }
  return { changes, warnings };
}
export async function migrateLegacyAgentDir(detected, now) {
  const changes = [];
  const warnings = [];
  if (!detected.agentDir.hasLegacy) {
    return { changes, warnings };
  }
  ensureDir(detected.agentDir.targetDir);
  const entries = safeReadDir(detected.agentDir.legacyDir);
  for (const entry of entries) {
    const from = path.join(detected.agentDir.legacyDir, entry.name);
    const to = path.join(detected.agentDir.targetDir, entry.name);
    if (fs.existsSync(to)) {
      continue;
    }
    try {
      fs.renameSync(from, to);
      changes.push(`Moved agent file ${entry.name} \u2192 agents/${detected.targetAgentId}/agent`);
    } catch (err) {
      warnings.push(`Failed moving ${from}: ${String(err)}`);
    }
  }
  removeDirIfEmpty(detected.agentDir.legacyDir);
  if (!emptyDirOrMissing(detected.agentDir.legacyDir)) {
    const backupDir = path.join(
      detected.stateDir,
      "agents",
      detected.targetAgentId,
      `agent.legacy-${now()}`,
    );
    try {
      fs.renameSync(detected.agentDir.legacyDir, backupDir);
      warnings.push(`Left legacy agent dir at ${backupDir}`);
    } catch (err) {
      warnings.push(`Failed relocating legacy agent dir: ${String(err)}`);
    }
  }
  return { changes, warnings };
}
async function migrateLegacyWhatsAppAuth(detected) {
  const changes = [];
  const warnings = [];
  if (!detected.whatsappAuth.hasLegacy) {
    return { changes, warnings };
  }
  ensureDir(detected.whatsappAuth.targetDir);
  const entries = safeReadDir(detected.whatsappAuth.legacyDir);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === "oauth.json") {
      continue;
    }
    if (!isLegacyWhatsAppAuthFile(entry.name)) {
      continue;
    }
    const from = path.join(detected.whatsappAuth.legacyDir, entry.name);
    const to = path.join(detected.whatsappAuth.targetDir, entry.name);
    if (fileExists(to)) {
      continue;
    }
    try {
      fs.renameSync(from, to);
      changes.push(`Moved WhatsApp auth ${entry.name} \u2192 whatsapp/default`);
    } catch (err) {
      warnings.push(`Failed moving ${from}: ${String(err)}`);
    }
  }
  return { changes, warnings };
}
async function migrateLegacyTelegramPairingAllowFrom(detected) {
  const changes = [];
  const warnings = [];
  if (!detected.pairingAllowFrom.hasLegacyTelegram) {
    return { changes, warnings };
  }
  const legacyPath = detected.pairingAllowFrom.legacyTelegramPath;
  const targetPath = detected.pairingAllowFrom.targetTelegramPath;
  try {
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(legacyPath, targetPath);
    changes.push(`Copied Telegram pairing allowFrom \u2192 ${targetPath}`);
  } catch (err) {
    warnings.push(`Failed migrating Telegram pairing allowFrom (${legacyPath}): ${String(err)}`);
  }
  return { changes, warnings };
}
export async function runLegacyStateMigrations(params) {
  const now = params.now ?? (() => Date.now());
  const detected = params.detected;
  const sessions = await migrateLegacySessions(detected, now);
  const agentDir = await migrateLegacyAgentDir(detected, now);
  const whatsappAuth = await migrateLegacyWhatsAppAuth(detected);
  const telegramPairingAllowFrom = await migrateLegacyTelegramPairingAllowFrom(detected);
  return {
    changes: [
      ...sessions.changes,
      ...agentDir.changes,
      ...whatsappAuth.changes,
      ...telegramPairingAllowFrom.changes,
    ],
    warnings: [
      ...sessions.warnings,
      ...agentDir.warnings,
      ...whatsappAuth.warnings,
      ...telegramPairingAllowFrom.warnings,
    ],
  };
}
export async function autoMigrateLegacyAgentDir(params) {
  return await autoMigrateLegacyState(params);
}
export async function autoMigrateLegacyState(params) {
  if (autoMigrateChecked) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }
  autoMigrateChecked = true;
  const env = params.env ?? process.env;
  const stateDirResult = await autoMigrateLegacyStateDir({
    env,
    homedir: params.homedir,
    log: params.log,
  });
  if (env.GENOS_AGENT_DIR?.trim() || env.PI_CODING_AGENT_DIR?.trim()) {
    return {
      migrated: stateDirResult.migrated,
      skipped: true,
      changes: stateDirResult.changes,
      warnings: stateDirResult.warnings,
    };
  }
  const detected = await detectLegacyStateMigrations({
    cfg: params.cfg,
    env,
    homedir: params.homedir,
  });
  if (!detected.sessions.hasLegacy && !detected.agentDir.hasLegacy) {
    return {
      migrated: stateDirResult.migrated,
      skipped: false,
      changes: stateDirResult.changes,
      warnings: stateDirResult.warnings,
    };
  }
  const now = params.now ?? (() => Date.now());
  const sessions = await migrateLegacySessions(detected, now);
  const agentDir = await migrateLegacyAgentDir(detected, now);
  const changes = [...stateDirResult.changes, ...sessions.changes, ...agentDir.changes];
  const warnings = [...stateDirResult.warnings, ...sessions.warnings, ...agentDir.warnings];
  const logger = params.log ?? createSubsystemLogger("state-migrations");
  if (changes.length > 0) {
    logger.info(`Auto-migrated legacy state:\n${changes.map((entry) => `- ${entry}`).join("\n")}`);
  }
  if (warnings.length > 0) {
    logger.warn(
      `Legacy state migration warnings:\n${warnings.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }
  return {
    migrated: changes.length > 0,
    skipped: false,
    changes,
    warnings,
  };
}
