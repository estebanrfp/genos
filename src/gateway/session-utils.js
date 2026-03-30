let resolveAvatarMime = function (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return AVATAR_MIME_BY_EXT[ext] ?? "application/octet-stream";
  },
  isWorkspaceRelativePath = function (value) {
    if (!value) {
      return false;
    }
    if (value.startsWith("~")) {
      return false;
    }
    if (AVATAR_SCHEME_RE.test(value) && !WINDOWS_ABS_RE.test(value)) {
      return false;
    }
    return true;
  },
  resolveIdentityAvatarUrl = function (cfg, agentId, avatar) {
    if (!avatar) {
      return;
    }
    const trimmed = avatar.trim();
    if (!trimmed) {
      return;
    }
    if (AVATAR_DATA_RE.test(trimmed) || AVATAR_HTTP_RE.test(trimmed)) {
      return trimmed;
    }
    if (!isWorkspaceRelativePath(trimmed)) {
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const workspaceRoot = path.resolve(workspaceDir);
    const resolved = path.resolve(workspaceRoot, trimmed);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return;
    }
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size > AVATAR_MAX_BYTES) {
        return;
      }
      const buffer = fs.readFileSync(resolved);
      const mime = resolveAvatarMime(resolved);
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return;
    }
  },
  formatSessionIdPrefix = function (sessionId, updatedAt) {
    const prefix = sessionId.slice(0, 8);
    if (updatedAt && updatedAt > 0) {
      const d = new Date(updatedAt);
      const date = d.toISOString().slice(0, 10);
      return `${prefix} (${date})`;
    }
    return prefix;
  },
  truncateTitle = function (text, maxLen) {
    if (text.length <= maxLen) {
      return text;
    }
    const cut = text.slice(0, maxLen - 1);
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > maxLen * 0.6) {
      return cut.slice(0, lastSpace) + "\u2026";
    }
    return cut + "\u2026";
  },
  findStoreMatch = function (store, ...candidates) {
    for (const candidate of candidates) {
      if (candidate && store[candidate]) {
        return { entry: store[candidate], key: candidate };
      }
    }
    const loweredSet = new Set(candidates.filter(Boolean).map((c) => c.toLowerCase()));
    for (const key of Object.keys(store)) {
      if (loweredSet.has(key.toLowerCase())) {
        return { entry: store[key], key };
      }
    }
    return;
  },
  isStorePathTemplate = function (store) {
    return typeof store === "string" && store.includes("{agentId}");
  },
  listExistingAgentIdsFromDisk = function () {
    const root = resolveStateDir();
    const agentsDir = path.join(root, "agents");
    try {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => normalizeAgentId(entry.name))
        .filter(Boolean);
    } catch {
      return [];
    }
  },
  listConfiguredAgentIds = function (cfg) {
    const agents = cfg.agents?.list ?? [];
    if (agents.length > 0) {
      const ids = new Set();
      for (const entry of agents) {
        if (entry?.id) {
          ids.add(normalizeAgentId(entry.id));
        }
      }
      const defaultId = normalizeAgentId(resolveDefaultAgentId(cfg));
      ids.add(defaultId);
      const sorted = Array.from(ids).filter(Boolean);
      sorted.sort((a, b) => a.localeCompare(b));
      return sorted.includes(defaultId)
        ? [defaultId, ...sorted.filter((id) => id !== defaultId)]
        : sorted;
    }
    const ids = new Set();
    const defaultId = normalizeAgentId(resolveDefaultAgentId(cfg));
    ids.add(defaultId);
    for (const id of listExistingAgentIdsFromDisk()) {
      ids.add(id);
    }
    const sorted = Array.from(ids).filter(Boolean);
    sorted.sort((a, b) => a.localeCompare(b));
    if (sorted.includes(defaultId)) {
      return [defaultId, ...sorted.filter((id) => id !== defaultId)];
    }
    return sorted;
  },
  canonicalizeSessionKeyForAgent = function (agentId, key) {
    const lowered = key.toLowerCase();
    if (lowered === "global" || lowered === "unknown") {
      return lowered;
    }
    if (lowered.startsWith("agent:")) {
      return lowered;
    }
    return `agent:${normalizeAgentId(agentId)}:${lowered}`;
  },
  resolveDefaultStoreAgentId = function (cfg) {
    return normalizeAgentId(resolveDefaultAgentId(cfg));
  },
  resolveSessionStoreAgentId = function (cfg, canonicalKey) {
    if (canonicalKey === "global" || canonicalKey === "unknown") {
      return resolveDefaultStoreAgentId(cfg);
    }
    const parsed = parseAgentSessionKey(canonicalKey);
    if (parsed?.agentId) {
      return normalizeAgentId(parsed.agentId);
    }
    return resolveDefaultStoreAgentId(cfg);
  },
  mergeSessionEntryIntoCombined = function (params) {
    const { cfg, combined, entry, agentId, canonicalKey } = params;
    const existing = combined[canonicalKey];
    if (existing && (existing.updatedAt ?? 0) > (entry.updatedAt ?? 0)) {
      combined[canonicalKey] = {
        ...entry,
        ...existing,
        spawnedBy: canonicalizeSpawnedByForAgent(
          cfg,
          agentId,
          existing.spawnedBy ?? entry.spawnedBy,
        ),
      };
    } else {
      combined[canonicalKey] = {
        ...existing,
        ...entry,
        spawnedBy: canonicalizeSpawnedByForAgent(
          cfg,
          agentId,
          entry.spawnedBy ?? existing?.spawnedBy,
        ),
      };
    }
  };
import fs from "node:fs";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { lookupContextTokens } from "../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import {
  parseModelRef,
  resolveConfiguredModelRef,
  resolveDefaultModelForAgent,
} from "../agents/model-selection.js";
import { isSubagentSessionRunActive } from "../agents/subagent-registry.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  buildGroupDisplayName,
  canonicalizeMainSessionAlias,
  loadSessionStore,
  resolveAgentMainSessionKey,
  resolveFreshSessionTotalTokens,
  resolveMainSessionKey,
  resolveStorePath,
} from "../config/sessions.js";
import {
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { isCronRunSessionKey } from "../sessions/session-key-utils.js";
import { normalizeSessionDeliveryFields } from "../utils/delivery-context.js";
import { readSessionTitleFieldsFromTranscript } from "./session-utils.fs.js";
export {
  archiveFileOnDisk,
  archiveSessionTranscripts,
  capArrayByJsonBytes,
  readFirstUserMessageFromTranscript,
  readLastMessagePreviewFromTranscript,
  readSessionTitleFieldsFromTranscript,
  readSessionPreviewItemsFromTranscript,
  readSessionMessages,
  resolveSessionTranscriptCandidates,
} from "./session-utils.fs.js";
const DERIVED_TITLE_MAX_LEN = 60;
const AVATAR_MAX_BYTES = 2097152;
const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const AVATAR_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;
const AVATAR_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};
export function deriveSessionTitle(entry, firstUserMessage) {
  if (!entry) {
    return;
  }
  if (entry.displayName?.trim()) {
    return entry.displayName.trim();
  }
  if (entry.subject?.trim()) {
    return entry.subject.trim();
  }
  if (firstUserMessage?.trim()) {
    const normalized = firstUserMessage.replace(/\s+/g, " ").trim();
    return truncateTitle(normalized, DERIVED_TITLE_MAX_LEN);
  }
  if (entry.sessionId) {
    return formatSessionIdPrefix(entry.sessionId, entry.updatedAt);
  }
  return;
}
export function loadSessionEntry(sessionKey) {
  const cfg = loadConfig();
  const sessionCfg = cfg.session;
  const canonicalKey = resolveSessionStoreKey({ cfg, sessionKey });
  const agentId = resolveSessionStoreAgentId(cfg, canonicalKey);
  const storePath = resolveStorePath(sessionCfg?.store, { agentId });
  const store = loadSessionStore(storePath);
  const match = findStoreMatch(store, canonicalKey, sessionKey.trim());
  const legacyKey = match?.key !== canonicalKey ? match?.key : undefined;
  return { cfg, storePath, store, entry: match?.entry, canonicalKey, legacyKey };
}
export function findStoreKeysIgnoreCase(store, targetKey) {
  const lowered = targetKey.toLowerCase();
  const matches = [];
  for (const key of Object.keys(store)) {
    if (key.toLowerCase() === lowered) {
      matches.push(key);
    }
  }
  return matches;
}
export function pruneLegacyStoreKeys(params) {
  const keysToDelete = new Set();
  for (const candidate of params.candidates) {
    const trimmed = String(candidate ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed !== params.canonicalKey) {
      keysToDelete.add(trimmed);
    }
    for (const match of findStoreKeysIgnoreCase(params.store, trimmed)) {
      if (match !== params.canonicalKey) {
        keysToDelete.add(match);
      }
    }
  }
  for (const key of keysToDelete) {
    delete params.store[key];
  }
}
export function classifySessionKey(key, entry) {
  if (key === "global") {
    return "global";
  }
  if (key === "unknown") {
    return "unknown";
  }
  if (entry?.chatType === "group" || entry?.chatType === "channel") {
    return "group";
  }
  if (key.includes(":group:") || key.includes(":channel:")) {
    return "group";
  }
  return "direct";
}
export function parseGroupKey(key) {
  const agentParsed = parseAgentSessionKey(key);
  const rawKey = agentParsed?.rest ?? key;
  const parts = rawKey.split(":").filter(Boolean);
  if (parts.length >= 3) {
    const [channel, kind, ...rest] = parts;
    if (kind === "group" || kind === "channel") {
      const id = rest.join(":");
      return { channel, kind, id };
    }
  }
  return null;
}
export function listAgentsForGateway(cfg) {
  const defaultId = normalizeAgentId(resolveDefaultAgentId(cfg));
  const mainKey = normalizeMainKey(cfg.session?.mainKey);
  const scope = cfg.session?.scope ?? "per-sender";
  const configuredById = new Map();
  for (const entry of cfg.agents?.list ?? []) {
    if (!entry?.id) {
      continue;
    }
    const identity = entry.identity
      ? {
          name: entry.identity.name?.trim() || undefined,
          theme: entry.identity.theme?.trim() || undefined,
          emoji: entry.identity.emoji?.trim() || undefined,
          avatar: entry.identity.avatar?.trim() || undefined,
          avatarUrl: resolveIdentityAvatarUrl(
            cfg,
            normalizeAgentId(entry.id),
            entry.identity.avatar?.trim(),
          ),
        }
      : undefined;
    configuredById.set(normalizeAgentId(entry.id), {
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined,
      identity,
    });
  }
  const explicitIds = new Set(
    (cfg.agents?.list ?? [])
      .map((entry) => (entry?.id ? normalizeAgentId(entry.id) : ""))
      .filter(Boolean),
  );
  const allowedIds = explicitIds.size > 0 ? new Set([...explicitIds, defaultId]) : null;
  let agentIds = listConfiguredAgentIds(cfg).filter((id) =>
    allowedIds ? allowedIds.has(id) : true,
  );
  // Note: mainKey is a session suffix (e.g., "main"), NOT an agent ID — don't add it as an agent
  const agents = agentIds.map((id) => {
    const meta = configuredById.get(id);
    return {
      id,
      name: meta?.name,
      identity: meta?.identity,
    };
  });
  return { defaultId, mainKey, scope, agents };
}
export function resolveSessionStoreKey(params) {
  const raw = params.sessionKey.trim();
  if (!raw) {
    return raw;
  }
  const rawLower = raw.toLowerCase();
  if (rawLower === "global" || rawLower === "unknown") {
    return rawLower;
  }
  const parsed = parseAgentSessionKey(raw);
  if (parsed) {
    const agentId = normalizeAgentId(parsed.agentId);
    const lowered = raw.toLowerCase();
    const canonical = canonicalizeMainSessionAlias({
      cfg: params.cfg,
      agentId,
      sessionKey: lowered,
    });
    if (canonical !== lowered) {
      return canonical;
    }
    return lowered;
  }
  const lowered = raw.toLowerCase();
  const rawMainKey = normalizeMainKey(params.cfg.session?.mainKey);
  if (lowered === "main" || lowered === rawMainKey) {
    return resolveMainSessionKey(params.cfg);
  }
  const agentId = resolveDefaultStoreAgentId(params.cfg);
  return canonicalizeSessionKeyForAgent(agentId, lowered);
}
export function canonicalizeSpawnedByForAgent(cfg, agentId, spawnedBy) {
  const raw = spawnedBy?.trim();
  if (!raw) {
    return;
  }
  const lower = raw.toLowerCase();
  if (lower === "global" || lower === "unknown") {
    return lower;
  }
  let result;
  if (raw.toLowerCase().startsWith("agent:")) {
    result = raw.toLowerCase();
  } else {
    result = `agent:${normalizeAgentId(agentId)}:${lower}`;
  }
  const parsed = parseAgentSessionKey(result);
  const resolvedAgent = parsed?.agentId ? normalizeAgentId(parsed.agentId) : agentId;
  return canonicalizeMainSessionAlias({ cfg, agentId: resolvedAgent, sessionKey: result });
}
export function resolveGatewaySessionStoreTarget(params) {
  const key = params.key.trim();
  const canonicalKey = resolveSessionStoreKey({
    cfg: params.cfg,
    sessionKey: key,
  });
  const agentId = resolveSessionStoreAgentId(params.cfg, canonicalKey);
  const storeConfig = params.cfg.session?.store;
  const storePath = resolveStorePath(storeConfig, { agentId });
  if (canonicalKey === "global" || canonicalKey === "unknown") {
    const storeKeys = key && key !== canonicalKey ? [canonicalKey, key] : [key];
    return { agentId, storePath, canonicalKey, storeKeys };
  }
  const storeKeys = new Set();
  storeKeys.add(canonicalKey);
  if (key && key !== canonicalKey) {
    storeKeys.add(key);
  }
  if (params.scanLegacyKeys !== false) {
    const scanTargets = new Set(storeKeys);
    const agentMainKey = resolveAgentMainSessionKey({ cfg: params.cfg, agentId });
    if (canonicalKey === agentMainKey) {
      scanTargets.add(`agent:${agentId}:main`);
    }
    const store = params.store ?? loadSessionStore(storePath);
    for (const seed of scanTargets) {
      for (const legacyKey of findStoreKeysIgnoreCase(store, seed)) {
        storeKeys.add(legacyKey);
      }
    }
  }
  return {
    agentId,
    storePath,
    canonicalKey,
    storeKeys: Array.from(storeKeys),
  };
}
export function loadCombinedSessionStoreForGateway(cfg) {
  const storeConfig = cfg.session?.store;
  if (storeConfig && !isStorePathTemplate(storeConfig)) {
    const storePath = resolveStorePath(storeConfig);
    const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
    const store = loadSessionStore(storePath);
    const combined = {};
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = canonicalizeSessionKeyForAgent(defaultAgentId, key);
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId: defaultAgentId,
        canonicalKey,
      });
    }
    return { storePath, store: combined };
  }
  const agentIds = listConfiguredAgentIds(cfg);
  const combined = {};
  for (const agentId of agentIds) {
    const storePath = resolveStorePath(storeConfig, { agentId });
    const store = loadSessionStore(storePath);
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = canonicalizeSessionKeyForAgent(agentId, key);
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId,
        canonicalKey,
      });
    }
  }
  const storePath =
    typeof storeConfig === "string" && storeConfig.trim() ? storeConfig.trim() : "(multiple)";
  return { storePath, store: combined };
}
export function getSessionDefaults(cfg) {
  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const contextTokens =
    cfg.agents?.defaults?.contextTokens ??
    lookupContextTokens(resolved.model) ??
    DEFAULT_CONTEXT_TOKENS;
  return {
    modelProvider: resolved.provider ?? null,
    model: resolved.model ?? null,
    contextTokens: contextTokens ?? null,
  };
}
export function resolveSessionModelRef(cfg, entry, agentId) {
  const resolved = agentId
    ? resolveDefaultModelForAgent({ cfg, agentId })
    : resolveConfiguredModelRef({
        cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      });
  let provider = resolved.provider;
  let model = resolved.model;
  // Explicit override takes precedence (set by user via "cambia a opus" or UI dropdown)
  const storedModelOverride = entry?.modelOverride?.trim();
  if (storedModelOverride) {
    const overrideProvider = entry?.providerOverride?.trim() || provider || DEFAULT_PROVIDER;
    const parsedOverride = parseModelRef(storedModelOverride, overrideProvider);
    if (parsedOverride) {
      provider = parsedOverride.provider;
      model = parsedOverride.model;
    } else {
      provider = overrideProvider;
      model = storedModelOverride;
    }
    return { provider, model };
  }
  // Fall back to last-run model
  const runtimeModel = entry?.model?.trim();
  const runtimeProvider = entry?.modelProvider?.trim();
  if (runtimeModel) {
    const parsedRuntime = parseModelRef(
      runtimeModel,
      runtimeProvider || provider || DEFAULT_PROVIDER,
    );
    if (parsedRuntime) {
      provider = parsedRuntime.provider;
      model = parsedRuntime.model;
    } else {
      provider = runtimeProvider || provider;
      model = runtimeModel;
    }
  }
  return { provider, model };
}
export function listSessionsFromStore(params) {
  const { cfg, storePath, store, opts, activeRunSessionKeys } = params;
  const now = Date.now();
  const includeGlobal = opts.includeGlobal === true;
  const includeUnknown = opts.includeUnknown === true;
  const includeDerivedTitles = opts.includeDerivedTitles === true;
  const includeLastMessage = opts.includeLastMessage === true;
  const spawnedBy = typeof opts.spawnedBy === "string" ? opts.spawnedBy : "";
  const label = typeof opts.label === "string" ? opts.label.trim() : "";
  const agentId = typeof opts.agentId === "string" ? normalizeAgentId(opts.agentId) : "";
  const search = typeof opts.search === "string" ? opts.search.trim().toLowerCase() : "";
  const activeMinutes =
    typeof opts.activeMinutes === "number" && Number.isFinite(opts.activeMinutes)
      ? Math.max(1, Math.floor(opts.activeMinutes))
      : undefined;
  let sessions = Object.entries(store)
    .filter(([key]) => {
      if (isCronRunSessionKey(key)) {
        return false;
      }
      if (!includeGlobal && key === "global") {
        return false;
      }
      if (!includeUnknown && key === "unknown") {
        return false;
      }
      if (agentId) {
        if (key === "global" || key === "unknown") {
          return false;
        }
        const parsed = parseAgentSessionKey(key);
        if (!parsed) {
          return false;
        }
        return normalizeAgentId(parsed.agentId) === agentId;
      }
      return true;
    })
    .filter(([key, entry]) => {
      if (!spawnedBy) {
        return true;
      }
      if (key === "unknown" || key === "global") {
        return false;
      }
      return entry?.spawnedBy === spawnedBy;
    })
    .filter(([, entry]) => {
      if (!label) {
        return true;
      }
      return entry?.label === label;
    })
    .map(([key, entry]) => {
      const updatedAt = entry?.updatedAt ?? null;
      const createdAt = entry?.createdAt ?? updatedAt;
      const total = resolveFreshSessionTotalTokens(entry);
      const totalTokensFresh =
        typeof entry?.totalTokens === "number" ? entry?.totalTokensFresh !== false : false;
      const parsed = parseGroupKey(key);
      const channel = entry?.channel ?? parsed?.channel;
      const subject = entry?.subject;
      const groupChannel = entry?.groupChannel;
      const space = entry?.space;
      const id = parsed?.id;
      const origin = entry?.origin;
      const originLabel = origin?.label;
      const parsedAgent = parseAgentSessionKey(key);
      const isMainSession = (parsedAgent?.rest ?? key) === "main";
      const isDirectDm = key.includes(":direct:");
      const displayName = isMainSession
        ? undefined
        : (entry?.displayName ??
          (channel
            ? buildGroupDisplayName({
                provider: channel,
                subject,
                groupChannel,
                space,
                id,
                key,
              })
            : undefined) ??
          entry?.label ??
          (isDirectDm ? undefined : originLabel));
      const deliveryFields = normalizeSessionDeliveryFields(entry);
      const sessionAgentId = normalizeAgentId(parsedAgent?.agentId ?? resolveDefaultAgentId(cfg));
      const resolvedModel = resolveSessionModelRef(cfg, entry, sessionAgentId);
      const modelProvider = resolvedModel.provider ?? DEFAULT_PROVIDER;
      const model = resolvedModel.model ?? DEFAULT_MODEL;
      return {
        key,
        entry,
        kind: classifySessionKey(key, entry),
        label: entry?.label,
        displayName,
        channel,
        subject,
        groupChannel,
        space,
        chatType: entry?.chatType,
        origin,
        createdAt,
        updatedAt,
        sessionId: entry?.sessionId,
        systemSent: entry?.systemSent,
        abortedLastRun: entry?.abortedLastRun,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        elevatedLevel: entry?.elevatedLevel,
        sendPolicy: entry?.sendPolicy,
        inputTokens: entry?.inputTokens,
        outputTokens: entry?.outputTokens,
        totalTokens: total,
        totalTokensFresh,
        responseUsage: entry?.responseUsage,
        modelProvider,
        model,
        routingTier: entry?.routingTier,
        contextTokens: entry?.contextTokens,
        deliveryContext: deliveryFields.deliveryContext,
        lastChannel: deliveryFields.lastChannel ?? entry?.lastChannel,
        lastTo: deliveryFields.lastTo ?? entry?.lastTo,
        lastAccountId: deliveryFields.lastAccountId ?? entry?.lastAccountId,
        running: key.includes(":subagent:")
          ? isSubagentSessionRunActive(key)
          : activeRunSessionKeys?.has(key) || entry?.initializing === true || undefined,
      };
    })
    .toSorted((a, b) => (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0));
  if (search) {
    sessions = sessions.filter((s) => {
      const fields = [s.displayName, s.label, s.subject, s.sessionId, s.key];
      return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(search));
    });
  }
  if (activeMinutes !== undefined) {
    const cutoff = now - activeMinutes * 60000;
    sessions = sessions.filter((s) => (s.updatedAt ?? 0) >= cutoff);
  }
  if (typeof opts.limit === "number" && Number.isFinite(opts.limit)) {
    const limit = Math.max(1, Math.floor(opts.limit));
    sessions = sessions.slice(0, limit);
  }
  const finalSessions = sessions.map((s) => {
    const { entry, ...rest } = s;
    let derivedTitle;
    let lastMessagePreview;
    if (entry?.sessionId) {
      if (includeDerivedTitles || includeLastMessage) {
        const parsed = parseAgentSessionKey(s.key);
        const agentId =
          parsed && parsed.agentId ? normalizeAgentId(parsed.agentId) : resolveDefaultAgentId(cfg);
        const fields = readSessionTitleFieldsFromTranscript(
          entry.sessionId,
          storePath,
          entry.sessionFile,
          agentId,
        );
        if (includeDerivedTitles) {
          derivedTitle = deriveSessionTitle(entry, fields.firstUserMessage);
        }
        if (includeLastMessage && fields.lastMessagePreview) {
          lastMessagePreview = fields.lastMessagePreview;
        }
      }
    }
    return { ...rest, derivedTitle, lastMessagePreview };
  });
  return {
    ts: now,
    path: storePath,
    count: finalSessions.length,
    defaults: getSessionDefaults(cfg),
    sessions: finalSessions,
  };
}
