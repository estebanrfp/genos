/**
 * Read a workspace file, transparently decrypting NYXENC1 content.
 * @param {string} absPath
 * @returns {Promise<string>}
 */
async function readWorkspaceFile(absPath) {
  const raw = await fs.readFile(absPath, "utf-8");
  if (!raw.startsWith("NYXENC1\n")) {
    return raw;
  }
  try {
    const { decryptContent } = await import("../infra/memory-encryption.js");
    const { resolvePassphrase } = await import("../infra/crypto-utils.js");
    return decryptContent(raw, resolvePassphrase());
  } catch {
    return raw;
  }
}

let stripFrontMatter = function (content) {
    if (!content.startsWith("---")) {
      return content;
    }
    const endIndex = content.indexOf("\n---", 3);
    if (endIndex === -1) {
      return content;
    }
    const start = endIndex + "\n---".length;
    let trimmed = content.slice(start);
    trimmed = trimmed.replace(/^\s+/, "");
    return trimmed;
  },
  resolveWorkspaceStatePath = function (dir) {
    return path.join(dir, WORKSPACE_STATE_DIRNAME, WORKSPACE_STATE_FILENAME);
  },
  parseWorkspaceOnboardingState = function (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return {
        version: WORKSPACE_STATE_VERSION,
        bootstrapSeededAt:
          typeof parsed.bootstrapSeededAt === "string" ? parsed.bootstrapSeededAt : undefined,
        onboardingCompletedAt:
          typeof parsed.onboardingCompletedAt === "string"
            ? parsed.onboardingCompletedAt
            : undefined,
      };
    } catch {
      return null;
    }
  };
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { resolveWorkspaceTemplateDir } from "./workspace-templates.js";
export function resolveDefaultAgentWorkspaceDir(env = process.env, homedir = os.homedir) {
  const home = resolveRequiredHomeDir(env, homedir);
  const profile = env.GENOS_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(home, ".genosv1", `workspace-${profile}`);
  }
  return path.join(home, ".genosv1", "workspace");
}
export const DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
export const DEFAULT_SOUL_FILENAME = "SOUL.md";
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md";
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md";
export const DEFAULT_USER_FILENAME = "USER.md";
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md";
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
export const DEFAULT_SECURITY_FILENAME = "SECURITY.md";
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md";
export const DEFAULT_MEMORY_ALT_FILENAME = "memory.md";
const WORKSPACE_STATE_DIRNAME = ".genosv1";
const WORKSPACE_STATE_FILENAME = "workspace-state.json";
const WORKSPACE_STATE_VERSION = 1;
const workspaceTemplateCache = new Map();
let gitAvailabilityPromise = null;
async function loadTemplate(name) {
  const cached = workspaceTemplateCache.get(name);
  if (cached) {
    return cached;
  }
  const pending = (async () => {
    const templateDir = await resolveWorkspaceTemplateDir();
    const templatePath = path.join(templateDir, name);
    try {
      const content = await fs.readFile(templatePath, "utf-8");
      return stripFrontMatter(content);
    } catch {
      throw new Error(
        `Missing workspace template: ${name} (${templatePath}). Ensure docs/reference/templates are packaged.`,
      );
    }
  })();
  workspaceTemplateCache.set(name, pending);
  try {
    return await pending;
  } catch (error) {
    workspaceTemplateCache.delete(name);
    throw error;
  }
}
const VALID_BOOTSTRAP_NAMES = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_SECURITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
]);

async function writeFileIfMissing(filePath, content) {
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
    return true;
  } catch (err) {
    const anyErr = err;
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
    return false;
  }
}
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function readWorkspaceOnboardingState(statePath) {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return (
      parseWorkspaceOnboardingState(raw) ?? {
        version: WORKSPACE_STATE_VERSION,
      }
    );
  } catch (err) {
    const anyErr = err;
    if (anyErr.code !== "ENOENT") {
      throw err;
    }
    return {
      version: WORKSPACE_STATE_VERSION,
    };
  }
}
async function readWorkspaceOnboardingStateForDir(dir) {
  const statePath = resolveWorkspaceStatePath(resolveUserPath(dir));
  return await readWorkspaceOnboardingState(statePath);
}
export async function isWorkspaceOnboardingCompleted(dir) {
  const state = await readWorkspaceOnboardingStateForDir(dir);
  return (
    typeof state.onboardingCompletedAt === "string" && state.onboardingCompletedAt.trim().length > 0
  );
}
async function writeWorkspaceOnboardingState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, payload, { encoding: "utf-8" });
    await fs.rename(tmpPath, statePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
async function hasGitRepo(dir) {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}
async function isGitAvailable() {
  if (gitAvailabilityPromise) {
    return gitAvailabilityPromise;
  }
  gitAvailabilityPromise = (async () => {
    try {
      const result = await runCommandWithTimeout(["git", "--version"], { timeoutMs: 2000 });
      return result.code === 0;
    } catch {
      return false;
    }
  })();
  return gitAvailabilityPromise;
}
async function ensureGitRepo(dir, isBrandNewWorkspace) {
  if (!isBrandNewWorkspace) {
    return;
  }
  if (await hasGitRepo(dir)) {
    return;
  }
  if (!(await isGitAvailable())) {
    return;
  }
  try {
    await runCommandWithTimeout(["git", "init"], { cwd: dir, timeoutMs: 1e4 });
  } catch {}
}
export async function ensureAgentWorkspace(params) {
  const rawDir = params?.dir?.trim() ? params.dir.trim() : DEFAULT_AGENT_WORKSPACE_DIR;
  const dir = resolveUserPath(rawDir);
  await fs.mkdir(dir, { recursive: true });
  if (!params?.ensureBootstrapFiles) {
    return { dir };
  }
  const agentsPath = path.join(dir, DEFAULT_AGENTS_FILENAME);
  const soulPath = path.join(dir, DEFAULT_SOUL_FILENAME);
  const toolsPath = path.join(dir, DEFAULT_TOOLS_FILENAME);
  const identityPath = path.join(dir, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(dir, DEFAULT_USER_FILENAME);
  const heartbeatPath = path.join(dir, DEFAULT_HEARTBEAT_FILENAME);
  const securityPath = path.join(dir, DEFAULT_SECURITY_FILENAME);
  const bootstrapPath = path.join(dir, DEFAULT_BOOTSTRAP_FILENAME);
  const statePath = resolveWorkspaceStatePath(dir);
  const isBrandNewWorkspace = await (async () => {
    const paths = [
      agentsPath,
      soulPath,
      toolsPath,
      identityPath,
      userPath,
      heartbeatPath,
      securityPath,
    ];
    const existing = await Promise.all(
      paths.map(async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return existing.every((v) => !v);
  })();
  const agentsTemplate = await loadTemplate(DEFAULT_AGENTS_FILENAME);
  const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME);
  const toolsTemplate = await loadTemplate(DEFAULT_TOOLS_FILENAME);
  const identityTemplate = await loadTemplate(DEFAULT_IDENTITY_FILENAME);
  const userTemplate = await loadTemplate(DEFAULT_USER_FILENAME);
  const heartbeatTemplate = await loadTemplate(DEFAULT_HEARTBEAT_FILENAME);
  const securityTemplate = await loadTemplate(DEFAULT_SECURITY_FILENAME);
  await writeFileIfMissing(agentsPath, agentsTemplate);
  await writeFileIfMissing(soulPath, soulTemplate);
  await writeFileIfMissing(toolsPath, toolsTemplate);
  await writeFileIfMissing(identityPath, identityTemplate);
  await writeFileIfMissing(userPath, userTemplate);
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate);
  await writeFileIfMissing(securityPath, securityTemplate);
  let state = await readWorkspaceOnboardingState(statePath);
  let stateDirty = false;
  const markState = (next) => {
    state = { ...state, ...next };
    stateDirty = true;
  };
  const nowIso = () => new Date().toISOString();
  let bootstrapExists = await fileExists(bootstrapPath);
  if (!state.bootstrapSeededAt && bootstrapExists) {
    markState({ bootstrapSeededAt: nowIso() });
  }
  if (!state.onboardingCompletedAt && state.bootstrapSeededAt && !bootstrapExists) {
    markState({ onboardingCompletedAt: nowIso() });
  }
  if (!state.bootstrapSeededAt && !state.onboardingCompletedAt && !bootstrapExists) {
    const [identityContent, userContent] = await Promise.all([
      fs.readFile(identityPath, "utf-8"),
      fs.readFile(userPath, "utf-8"),
    ]);
    const legacyOnboardingCompleted =
      identityContent !== identityTemplate || userContent !== userTemplate;
    if (legacyOnboardingCompleted) {
      markState({ onboardingCompletedAt: nowIso() });
    } else {
      const bootstrapTemplate = await loadTemplate(DEFAULT_BOOTSTRAP_FILENAME);
      const wroteBootstrap = await writeFileIfMissing(bootstrapPath, bootstrapTemplate);
      if (!wroteBootstrap) {
        bootstrapExists = await fileExists(bootstrapPath);
      } else {
        bootstrapExists = true;
      }
      if (bootstrapExists && !state.bootstrapSeededAt) {
        markState({ bootstrapSeededAt: nowIso() });
      }
    }
  }
  if (stateDirty) {
    await writeWorkspaceOnboardingState(statePath, state);
  }
  await ensureGitRepo(dir, isBrandNewWorkspace);
  return {
    dir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    heartbeatPath,
    securityPath,
    bootstrapPath,
  };
}
async function resolveMemoryBootstrapEntries(resolvedDir) {
  const candidates = [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME];
  const entries = [];
  for (const name of candidates) {
    const filePath = path.join(resolvedDir, name);
    try {
      await fs.access(filePath);
      entries.push({ name, filePath });
    } catch {}
  }
  if (entries.length <= 1) {
    return entries;
  }
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    let key = entry.filePath;
    try {
      key = await fs.realpath(entry.filePath);
    } catch {}
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}
export async function loadWorkspaceBootstrapFiles(dir) {
  const resolvedDir = resolveUserPath(dir);
  const entries = [
    {
      name: DEFAULT_AGENTS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_AGENTS_FILENAME),
    },
    {
      name: DEFAULT_SOUL_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME),
    },
    {
      name: DEFAULT_TOOLS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_TOOLS_FILENAME),
    },
    {
      name: DEFAULT_IDENTITY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME),
    },
    {
      name: DEFAULT_USER_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_USER_FILENAME),
    },
    {
      name: DEFAULT_HEARTBEAT_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME),
    },
    {
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME),
    },
    {
      name: DEFAULT_SECURITY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_SECURITY_FILENAME),
    },
  ];
  entries.push(...(await resolveMemoryBootstrapEntries(resolvedDir)));
  const result = [];
  for (const entry of entries) {
    try {
      const content = await readWorkspaceFile(entry.filePath);
      result.push({
        name: entry.name,
        path: entry.filePath,
        content,
        missing: false,
      });
    } catch {
      result.push({ name: entry.name, path: entry.filePath, missing: true });
    }
  }
  return result;
}
const MINIMAL_BOOTSTRAP_ALLOWLIST = new Set([DEFAULT_AGENTS_FILENAME, DEFAULT_SECURITY_FILENAME]);
export function filterBootstrapFilesForSession(files, sessionKey) {
  if (!sessionKey || (!isSubagentSessionKey(sessionKey) && !isCronSessionKey(sessionKey))) {
    return files;
  }
  return files.filter((file) => MINIMAL_BOOTSTRAP_ALLOWLIST.has(file.name));
}
export async function loadExtraBootstrapFiles(dir, extraPatterns) {
  if (!extraPatterns.length) {
    return [];
  }
  const resolvedDir = resolveUserPath(dir);
  let realResolvedDir = resolvedDir;
  try {
    realResolvedDir = await fs.realpath(resolvedDir);
  } catch {}
  const resolvedPaths = new Set();
  for (const pattern of extraPatterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("{")) {
      try {
        const matches = fs.glob(pattern, { cwd: resolvedDir });
        for await (const m of matches) {
          resolvedPaths.add(m);
        }
      } catch {
        resolvedPaths.add(pattern);
      }
    } else {
      resolvedPaths.add(pattern);
    }
  }
  const result = [];
  for (const relPath of resolvedPaths) {
    const filePath = path.resolve(resolvedDir, relPath);
    if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
      continue;
    }
    try {
      const realFilePath = await fs.realpath(filePath);
      if (
        !realFilePath.startsWith(realResolvedDir + path.sep) &&
        realFilePath !== realResolvedDir
      ) {
        continue;
      }
      const baseName = path.basename(relPath);
      if (!VALID_BOOTSTRAP_NAMES.has(baseName)) {
        continue;
      }
      const content = await readWorkspaceFile(realFilePath);
      result.push({
        name: baseName,
        path: filePath,
        content,
        missing: false,
      });
    } catch {}
  }
  return result;
}
