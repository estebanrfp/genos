let resolveAgentSessionsDir = function (
    agentId,
    env = process.env,
    homedir = () => resolveRequiredHomeDir(env, os.homedir),
  ) {
    const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
    try {
      const cfg = loadConfig();
      const entry = cfg?.agents?.list?.find((e) => normalizeAgentId(e?.id) === id);
      const agentDir = entry?.agentDir?.trim();
      if (agentDir) {
        return path.join(path.dirname(agentDir), "sessions");
      }
    } catch {}
    const root = resolveStateDir(env, homedir);
    return path.join(root, "agents", id, "sessions");
  },
  resolveSessionsDir = function (opts) {
    const sessionsDir = opts?.sessionsDir?.trim();
    if (sessionsDir) {
      return path.resolve(sessionsDir);
    }
    return resolveAgentSessionsDir(opts?.agentId);
  },
  resolvePathFromAgentSessionsDir = function (agentSessionsDir, candidateAbsPath) {
    const agentBase = path.resolve(agentSessionsDir);
    const relative = path.relative(agentBase, candidateAbsPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return;
    }
    return path.resolve(agentBase, relative);
  },
  resolveSiblingAgentSessionsDir = function (baseSessionsDir, agentId) {
    const resolvedBase = path.resolve(baseSessionsDir);
    if (path.basename(resolvedBase) !== "sessions") {
      return;
    }
    const baseAgentDir = path.dirname(resolvedBase);
    const baseAgentsDir = path.dirname(baseAgentDir);
    if (path.basename(baseAgentsDir) !== "agents") {
      return;
    }
    const rootDir = path.dirname(baseAgentsDir);
    return path.join(rootDir, "agents", normalizeAgentId(agentId), "sessions");
  },
  extractAgentIdFromAbsoluteSessionPath = function (candidateAbsPath) {
    const normalized = path.normalize(path.resolve(candidateAbsPath));
    const parts = normalized.split(path.sep).filter(Boolean);
    const sessionsIndex = parts.lastIndexOf("sessions");
    if (sessionsIndex < 2 || parts[sessionsIndex - 2] !== "agents") {
      return;
    }
    const agentId = parts[sessionsIndex - 1];
    return agentId || undefined;
  },
  resolvePathWithinSessionsDir = function (sessionsDir, candidate, opts) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      throw new Error("Session file path must not be empty");
    }
    const resolvedBase = path.resolve(sessionsDir);
    const normalized = path.isAbsolute(trimmed) ? path.relative(resolvedBase, trimmed) : trimmed;
    if (normalized.startsWith("..") && path.isAbsolute(trimmed)) {
      const tryAgentFallback = (agentId) => {
        const normalizedAgentId = normalizeAgentId(agentId);
        const siblingSessionsDir = resolveSiblingAgentSessionsDir(resolvedBase, normalizedAgentId);
        if (siblingSessionsDir) {
          const siblingResolved = resolvePathFromAgentSessionsDir(siblingSessionsDir, trimmed);
          if (siblingResolved) {
            return siblingResolved;
          }
        }
        return resolvePathFromAgentSessionsDir(resolveAgentSessionsDir(normalizedAgentId), trimmed);
      };
      const explicitAgentId = opts?.agentId?.trim();
      if (explicitAgentId) {
        const resolvedFromAgent = tryAgentFallback(explicitAgentId);
        if (resolvedFromAgent) {
          return resolvedFromAgent;
        }
      }
      const extractedAgentId = extractAgentIdFromAbsoluteSessionPath(trimmed);
      if (extractedAgentId) {
        const resolvedFromPath = tryAgentFallback(extractedAgentId);
        if (resolvedFromPath) {
          return resolvedFromPath;
        }
        return path.resolve(trimmed);
      }
    }
    if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw new Error("Session file path must be within sessions directory");
    }
    return path.resolve(resolvedBase, normalized);
  };
import os from "node:os";
import path from "node:path";
import { expandHomePrefix, resolveRequiredHomeDir } from "../../infra/home-dir.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import { loadConfig } from "../io.js";
import { resolveStateDir } from "../paths.js";
export function resolveSessionTranscriptsDir(
  env = process.env,
  homedir = () => resolveRequiredHomeDir(env, os.homedir),
) {
  return resolveAgentSessionsDir(DEFAULT_AGENT_ID, env, homedir);
}
export function resolveSessionTranscriptsDirForAgent(
  agentId,
  env = process.env,
  homedir = () => resolveRequiredHomeDir(env, os.homedir),
) {
  return resolveAgentSessionsDir(agentId, env, homedir);
}
export function resolveDefaultSessionStorePath(agentId) {
  return path.join(resolveAgentSessionsDir(agentId), "sessions.json");
}
export function resolveSessionFilePathOptions(params) {
  const agentId = params.agentId?.trim();
  const storePath = params.storePath?.trim();
  if (storePath) {
    const sessionsDir = path.dirname(path.resolve(storePath));
    return agentId ? { sessionsDir, agentId } : { sessionsDir };
  }
  if (agentId) {
    return { agentId };
  }
  return;
}
export const SAFE_SESSION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
export function validateSessionId(sessionId) {
  const trimmed = sessionId.trim();
  if (!SAFE_SESSION_ID_RE.test(trimmed)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  return trimmed;
}
export function resolveSessionTranscriptPathInDir(sessionId, sessionsDir, topicId) {
  const safeSessionId = validateSessionId(sessionId);
  const safeTopicId =
    typeof topicId === "string"
      ? encodeURIComponent(topicId)
      : typeof topicId === "number"
        ? String(topicId)
        : undefined;
  const fileName =
    safeTopicId !== undefined
      ? `${safeSessionId}-topic-${safeTopicId}.jsonl`
      : `${safeSessionId}.jsonl`;
  return resolvePathWithinSessionsDir(sessionsDir, fileName);
}
export function resolveSessionTranscriptPath(sessionId, agentId, topicId) {
  return resolveSessionTranscriptPathInDir(sessionId, resolveAgentSessionsDir(agentId), topicId);
}
export function resolveSessionFilePath(sessionId, entry, opts) {
  const sessionsDir = resolveSessionsDir(opts);
  const candidate = entry?.sessionFile?.trim();
  if (candidate) {
    return resolvePathWithinSessionsDir(sessionsDir, candidate, { agentId: opts?.agentId });
  }
  return resolveSessionTranscriptPathInDir(sessionId, sessionsDir);
}
export function resolveStorePath(store, opts) {
  const agentId = normalizeAgentId(opts?.agentId ?? DEFAULT_AGENT_ID);
  if (!store) {
    return resolveDefaultSessionStorePath(agentId);
  }
  if (store.includes("{agentId}")) {
    const expanded = store.replaceAll("{agentId}", agentId);
    if (expanded.startsWith("~")) {
      return path.resolve(
        expandHomePrefix(expanded, {
          home: resolveRequiredHomeDir(process.env, os.homedir),
          env: process.env,
          homedir: os.homedir,
        }),
      );
    }
    return path.resolve(expanded);
  }
  if (store.startsWith("~")) {
    return path.resolve(
      expandHomePrefix(store, {
        home: resolveRequiredHomeDir(process.env, os.homedir),
        env: process.env,
        homedir: os.homedir,
      }),
    );
  }
  return path.resolve(store);
}
