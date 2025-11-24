let resolveAgentWorkspaceFileOrRespondError = function (params, respond) {
    const cfg = loadConfig();
    const rawAgentId = params.agentId;
    const agentId = resolveAgentIdOrError(
      typeof rawAgentId === "string" || typeof rawAgentId === "number" ? String(rawAgentId) : "",
      cfg,
    );
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return null;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const rawName = params.name;
    const name = (
      typeof rawName === "string" || typeof rawName === "number" ? String(rawName) : ""
    ).trim();
    if (!isAllowedWorkspacePath(workspaceDir, name)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unsupported file "${name}"`),
      );
      return null;
    }
    return { cfg, agentId, workspaceDir, name };
  },
  resolveAgentIdOrError = function (agentIdRaw, cfg) {
    const agentId = normalizeAgentId(agentIdRaw);
    const allowed = new Set(listAgentIds(cfg));
    if (!allowed.has(agentId)) {
      return null;
    }
    return agentId;
  },
  sanitizeIdentityLine = function (value) {
    return value.replace(/\s+/g, " ").trim();
  },
  resolveOptionalStringParam = function (value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgentDirId } from "../../agents/agent-dir-id.js";
import {
  listAgentIds,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
} from "../../agents/agent-scope.js";
import {
  inferToolProfile,
  applyToolProfile,
  parseAgentTemplate,
  applyTemplateConfig,
} from "../../agents/auto-config.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SECURITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  isWorkspaceOnboardingCompleted,
} from "../../agents/workspace.js";
import { movePathToTrash } from "../../browser/trash.js";
import {
  applyAgentConfig,
  findAgentEntryIndex,
  listAgentEntries,
  pruneAgentConfig,
  renameAgentConfig,
  wireAgentCommunication,
} from "../../commands/agents.config.js";
import { loadConfig, writeConfigFile, resolveStateDir } from "../../config/config.js";
import { migrateSessionStore } from "../../config/sessions/store-migrate.js";
import { updateSessionStore } from "../../config/sessions/store.js";
import { decryptContent, encryptContent } from "../../infra/memory-encryption.js";
import { getPassphraseOrNull } from "../../infra/secure-io.js";
import { loadCredentials } from "../../infra/webauthn-store.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import { resolveUserPath } from "../../utils.js";
import { callGateway } from "../call.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentsCreateParams,
  validateAgentsDeleteParams,
  validateAgentsFilesGetParams,
  validateAgentsFilesListParams,
  validateAgentsFilesDeleteParams,
  validateAgentsFilesEditParams,
  validateAgentsFilesSetParams,
  validateAgentsListParams,
  validateAgentsRenameParams,
  validateAgentsUpdateParams,
} from "../protocol/index.js";
import { listAgentsForGateway } from "../session-utils.js";
import { verifyWebAuthnSession } from "../webauthn-http.js";
/**
 * Recursively copy a directory tree.
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDirRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
/**
 * Read a workspace file, transparently decrypting NYXENC1 content.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readSecureWorkspaceFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  if (!raw.startsWith("NYXENC1\n")) {
    return raw;
  }
  const passphrase = getPassphraseOrNull();
  if (!passphrase) {
    return raw;
  }
  try {
    return decryptContent(raw, passphrase);
  } catch {
    return raw;
  }
}

/**
 * Write a workspace file, encrypting if passphrase is configured.
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<void>}
 */
async function writeSecureWorkspaceFile(filePath, content) {
  const passphrase = getPassphraseOrNull();
  const output = passphrase ? encryptContent(content, passphrase) : content;
  await fs.writeFile(filePath, output, "utf-8");
  if (passphrase) {
    await fs.chmod(filePath, 0o600);
  }
}

/** Returns true if name is a safe relative path within workspaceDir. */
function isAllowedWorkspacePath(workspaceDir, name) {
  if (!name || name.includes("\0")) {
    return false;
  }
  if (path.isAbsolute(name)) {
    return false;
  }
  const base = path.resolve(workspaceDir);
  const resolved = path.resolve(workspaceDir, name);
  return resolved === base || resolved.startsWith(base + path.sep);
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".js",
  ".ts",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".html",
  ".css",
]);

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
]);
const PDF_EXTENSIONS = new Set([".pdf"]);

const IGNORED_FILENAMES = new Set([".DS_Store", ".localized", "Thumbs.db", "desktop.ini"]);

async function scanDir(dir, section, baseDir) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (IGNORED_FILENAMES.has(entry.name) || entry.name.startsWith("._")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      results.push(...(await scanDir(fullPath, section, baseDir)));
    } else if (entry.isFile()) {
      const meta = await statFile(fullPath);
      if (!meta) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      const contentType = IMAGE_EXTENSIONS.has(ext)
        ? "image"
        : PDF_EXTENSIONS.has(ext)
          ? "pdf"
          : TEXT_EXTENSIONS.has(ext)
            ? "text"
            : "binary";
      results.push({
        name: relPath,
        path: fullPath,
        missing: false,
        size: meta.size,
        updatedAtMs: meta.updatedAtMs,
        section,
        editable: TEXT_EXTENSIONS.has(ext),
        contentType,
      });
    }
  }
  return results;
}

const BOOTSTRAP_FILE_NAMES = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_SECURITY_FILENAME,
];
const BOOTSTRAP_FILE_NAMES_POST_ONBOARDING = BOOTSTRAP_FILE_NAMES.filter(
  (name) => name !== DEFAULT_BOOTSTRAP_FILENAME,
);

/**
 * Files that require biometric (WebAuthn) approval before the agent can write them.
 * If no credentials are registered the gateway falls back to a hard block.
 */
const PROTECTED_WORKSPACE_NAMES = new Set([DEFAULT_AGENTS_FILENAME, DEFAULT_SECURITY_FILENAME]);

const FILE_APPROVAL_TIMEOUT_MS = 120000;
async function statFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return null;
    }
    return {
      size: stat.size,
      updatedAtMs: Math.floor(stat.mtimeMs),
    };
  } catch {
    return null;
  }
}
async function listAgentFiles(workspaceDir, options) {
  const files = [];
  const bootstrapFileNames = options?.hideBootstrap
    ? BOOTSTRAP_FILE_NAMES_POST_ONBOARDING
    : BOOTSTRAP_FILE_NAMES;

  // Core bootstrap files
  for (const name of bootstrapFileNames) {
    const filePath = path.join(workspaceDir, name);
    const meta = await statFile(filePath);
    files.push(
      meta
        ? {
            name,
            path: filePath,
            missing: false,
            size: meta.size,
            updatedAtMs: meta.updatedAtMs,
            section: "core",
            editable: true,
          }
        : { name, path: filePath, missing: true, section: "core", editable: true },
    );
  }

  // memory/ directory — newest first
  const memoryFiles = await scanDir(path.join(workspaceDir, "memory"), "memory", workspaceDir);
  memoryFiles.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  files.push(...memoryFiles);

  // docs/ directory — alphabetical
  const docsFiles = await scanDir(path.join(workspaceDir, "docs"), "docs", workspaceDir);
  docsFiles.sort((a, b) => a.name.localeCompare(b.name));
  files.push(...docsFiles);

  return files;
}
async function moveToTrashBestEffort(pathname) {
  if (!pathname) {
    return;
  }
  try {
    await fs.access(pathname);
  } catch {
    return;
  }
  try {
    await movePathToTrash(pathname);
  } catch {}
}
export const agentsHandlers = {
  "agents.list": ({ params, respond }) => {
    if (!validateAgentsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.list params: ${formatValidationErrors(validateAgentsListParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    respond(true, result, undefined);
  },
  "agents.create": async ({ params, respond, context }) => {
    if (!validateAgentsCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.create params: ${formatValidationErrors(validateAgentsCreateParams.errors)}`,
        ),
      );
      return;
    }
    // Parse template — try explicit param, then slug match, then keyword match
    let tpl = null;
    let matchedSlug = null;
    const tplDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../skills/agent-templates/templates",
    );
    const templateSlug = typeof params.template === "string" ? params.template.trim() : "";
    // 1. Explicit template param or exact slug match by name
    const slugsToTry = [templateSlug, normalizeAgentId(String(params.name ?? ""))].filter(Boolean);
    for (const slug of slugsToTry) {
      if (tpl) {
        break;
      }
      try {
        const tplContent = await fs.readFile(path.join(tplDir, `${slug}.md`), "utf-8");
        tpl = parseAgentTemplate(tplContent);
        matchedSlug = slug;
      } catch {
        // Not found — try next
      }
    }
    // 2. Keyword match via index.json if no exact slug matched
    if (!tpl) {
      try {
        const indexContent = await fs.readFile(path.join(tplDir, "index.json"), "utf-8");
        const index = JSON.parse(indexContent);
        const nameLower = String(params.name ?? "").toLowerCase();
        let bestSlug = null;
        let bestScore = 0;
        for (const [slug, entry] of Object.entries(index)) {
          const score =
            entry.keywords?.filter((kw) => nameLower.includes(kw.toLowerCase())).length ?? 0;
          if (score > bestScore) {
            bestScore = score;
            bestSlug = slug;
          }
        }
        if (bestSlug) {
          const tplContent = await fs.readFile(path.join(tplDir, `${bestSlug}.md`), "utf-8");
          tpl = parseAgentTemplate(tplContent);
          matchedSlug = bestSlug;
        }
      } catch {
        // Index not found or parse error — continue without template
      }
    }
    const cfg = loadConfig();
    const rawName = String(params.name ?? "").trim() || tpl?.name || "";
    const agentId = normalizeAgentId(rawName);
    if (agentId === DEFAULT_AGENT_ID) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `"${DEFAULT_AGENT_ID}" is reserved`),
      );
      return;
    }
    if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${agentId}" already exists`),
      );
      return;
    }
    const rawWorkspace = String(params.workspace ?? "").trim();
    // Only accept absolute paths as explicit workspace; reject relative paths
    // and empty strings to prevent creating inside another agent's workspace
    const explicitWorkspace = rawWorkspace && path.isAbsolute(rawWorkspace) ? rawWorkspace : "";
    // Generate opaque directory ID — decouples filesystem from agent identity
    const dirId = generateAgentDirId();
    const stateDir = resolveStateDir(process.env);
    const workspaceDir = explicitWorkspace
      ? resolveUserPath(explicitWorkspace)
      : path.join(stateDir, `workspace-${dirId}`);
    const agentDir = path.join(stateDir, "agents", dirId, "agent");
    let nextConfig = applyAgentConfig(cfg, {
      agentId,
      name: rawName,
      workspace: workspaceDir,
      agentDir,
    });
    // Auto-wire agent-to-agent communication so Nyx can delegate immediately
    nextConfig = wireAgentCommunication(nextConfig, agentId);
    // Resolve tool profile: explicit param > template > name inference
    const toolProfile = params.toolProfile ?? tpl?.toolProfile ?? inferToolProfile(rawName);
    const autoConfig = [];
    const { config: profiledConfig, applied: profileApplied } = applyToolProfile(
      nextConfig,
      agentId,
      toolProfile,
    );
    if (profileApplied.length) {
      nextConfig = profiledConfig;
      autoConfig.push(...profileApplied);
    }
    // Apply template extras (alsoAllow, deny) if template was loaded
    if (tpl) {
      const { config: tplConfig, applied: tplApplied } = applyTemplateConfig(
        nextConfig,
        agentId,
        tpl,
      );
      if (tplApplied.length) {
        nextConfig = tplConfig;
        autoConfig.push(...tplApplied);
      }
    }
    const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
    await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: !skipBootstrap });
    await fs.mkdir(path.join(stateDir, "agents", dirId, "sessions"), { recursive: true });
    await writeConfigFile(nextConfig);
    const safeName = sanitizeIdentityLine(rawName);
    const emoji = resolveOptionalStringParam(params.emoji);
    const avatar = resolveOptionalStringParam(params.avatar);
    const identityPath = path.join(workspaceDir, DEFAULT_IDENTITY_FILENAME);
    const lines = [
      "",
      `- Name: ${safeName}`,
      ...(emoji ? [`- Emoji: ${sanitizeIdentityLine(emoji)}`] : []),
      ...(avatar ? [`- Avatar: ${sanitizeIdentityLine(avatar)}`] : []),
      "",
    ];
    await fs.appendFile(identityPath, lines.join("\n"), "utf-8");
    // Inject personality/purpose into SOUL.md — explicit param > template description
    const description = resolveOptionalStringParam(params.description) ?? tpl?.description;
    if (description) {
      const soulPath = path.join(workspaceDir, DEFAULT_SOUL_FILENAME);
      const soulContent = await fs.readFile(soulPath, "utf-8");
      const sections = [`\n\n## Purpose\n\n${description}\n`];
      if (tpl) {
        sections.push(
          `\n## Delivery Rule\n\nWhen you receive a task via inter-agent message, you MUST deliver the final result back using sessions_send to the requester's session. Never end silently.\n`,
        );
      }
      await fs.writeFile(soulPath, soulContent + sections.join(""), "utf-8");
    }
    // Encrypt all bootstrap files if vault is unlocked
    const passphrase = getPassphraseOrNull();
    if (passphrase) {
      const bootstrapFiles = [
        DEFAULT_AGENTS_FILENAME,
        DEFAULT_SOUL_FILENAME,
        DEFAULT_TOOLS_FILENAME,
        DEFAULT_IDENTITY_FILENAME,
        DEFAULT_USER_FILENAME,
        DEFAULT_HEARTBEAT_FILENAME,
        DEFAULT_SECURITY_FILENAME,
        DEFAULT_BOOTSTRAP_FILENAME,
      ];
      await Promise.all(
        bootstrapFiles.map(async (name) => {
          const filePath = path.join(workspaceDir, name);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            if (!content.startsWith("NYXENC1\n")) {
              await fs.writeFile(filePath, encryptContent(content, passphrase), "utf-8");
              await fs.chmod(filePath, 0o600);
            }
          } catch {}
        }),
      );
    }
    // Install template-declared skills into agent workspace
    if (tpl?.skills?.length) {
      const skillsDir = path.join(workspaceDir, "skills");
      await fs.mkdir(skillsDir, { recursive: true });
      for (const skillName of tpl.skills) {
        const srcDir = path.join(tplDir, "..", "..", skillName);
        try {
          await fs.access(srcDir);
          const destDir = path.join(skillsDir, skillName);
          await copyDirRecursive(srcDir, destDir);
          // Encrypt SKILL.md if vault is unlocked
          if (passphrase) {
            const skillMd = path.join(destDir, "SKILL.md");
            try {
              const content = await fs.readFile(skillMd, "utf-8");
              if (!content.startsWith("NYXENC1\n")) {
                await fs.writeFile(skillMd, encryptContent(content, passphrase), "utf-8");
                await fs.chmod(skillMd, 0o600);
              }
            } catch {}
          }
          autoConfig.push(`skills.installed=${skillName}`);
        } catch {
          // Skill not found in bundled dir — skip silently
        }
      }
    }
    // Pre-create main session so the sidebar shows it immediately
    const mainSessionKey = `agent:${agentId}:main`;
    const sessionStorePath = path.join(stateDir, "agents", dirId, "sessions", "sessions.json");
    await updateSessionStore(sessionStorePath, (store) => {
      const now = Date.now();
      store[mainSessionKey] = {
        sessionId: randomUUID(),
        createdAt: now,
        updatedAt: now,
        initializing: true,
      };
    });
    context.broadcast?.("sessions.changed", {}, { dropIfSlow: true });
    respond(
      true,
      {
        ok: true,
        agentId,
        name: rawName,
        workspace: workspaceDir,
        sessionKey: mainSessionKey,
        ...(matchedSlug ? { template: matchedSlug } : {}),
        ...(toolProfile !== "full" ? { toolProfile } : {}),
        ...(autoConfig.length ? { autoConfig } : {}),
        hint: `Agent "${rawName}" is now available. Delegate tasks via sessions_send to ${mainSessionKey}`,
      },
      undefined,
    );
    // Trigger greeting — clear initializing flag when done
    callGateway({
      method: "agent",
      params: {
        message: "/new",
        sessionKey: mainSessionKey,
        idempotencyKey: `greeting:${agentId}:${Date.now()}`,
        deliver: false,
      },
      timeoutMs: 30_000,
    })
      .then(() =>
        updateSessionStore(sessionStorePath, (store) => {
          if (store[mainSessionKey]) {
            delete store[mainSessionKey].initializing;
          }
        }),
      )
      .then(() => context.broadcast?.("sessions.changed", {}, { dropIfSlow: true }))
      .catch(() => {});
  },
  "agents.update": async ({ params, respond }) => {
    if (!validateAgentsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.update params: ${formatValidationErrors(validateAgentsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = normalizeAgentId(String(params.agentId ?? ""));
    if (findAgentEntryIndex(listAgentEntries(cfg), agentId) < 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${agentId}" not found`),
      );
      return;
    }
    const workspaceDir =
      typeof params.workspace === "string" && params.workspace.trim()
        ? resolveUserPath(params.workspace.trim())
        : undefined;
    const model = resolveOptionalStringParam(params.model);
    const avatar = resolveOptionalStringParam(params.avatar);
    const nextConfig = applyAgentConfig(cfg, {
      agentId,
      ...(typeof params.name === "string" && params.name.trim()
        ? { name: params.name.trim() }
        : {}),
      ...(workspaceDir ? { workspace: workspaceDir } : {}),
      ...(model ? { model } : {}),
    });
    await writeConfigFile(nextConfig);
    if (workspaceDir) {
      const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
      await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: !skipBootstrap });
    }
    if (avatar) {
      const workspace = workspaceDir ?? resolveAgentWorkspaceDir(nextConfig, agentId);
      await fs.mkdir(workspace, { recursive: true });
      const identityPath = path.join(workspace, DEFAULT_IDENTITY_FILENAME);
      await fs.appendFile(identityPath, `\n- Avatar: ${sanitizeIdentityLine(avatar)}\n`, "utf-8");
    }
    respond(true, { ok: true, agentId }, undefined);
  },
  "agents.delete": async ({ params, respond, context }) => {
    if (!validateAgentsDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.delete params: ${formatValidationErrors(validateAgentsDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = normalizeAgentId(String(params.agentId ?? ""));
    if (agentId === DEFAULT_AGENT_ID) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `"${DEFAULT_AGENT_ID}" cannot be deleted`),
      );
      return;
    }
    if (findAgentEntryIndex(listAgentEntries(cfg), agentId) < 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${agentId}" not found`),
      );
      return;
    }
    const deleteFiles = typeof params.deleteFiles === "boolean" ? params.deleteFiles : true;
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const agentDir = resolveAgentDir(cfg, agentId);
    // Parent of agentDir (e.g. agents/{uuid}/) contains both agent/ and sessions/
    const agentParentDir = path.dirname(agentDir);
    const result = pruneAgentConfig(cfg, agentId);
    await writeConfigFile(result.config);
    // Respond first so the calling agent can persist its final messages
    respond(true, { ok: true, agentId, removedBindings: result.removedBindings }, undefined);
    context.broadcast?.("sessions.changed", {}, { dropIfSlow: true });
    if (deleteFiles) {
      // Delay file removal to let the session manager flush pending writes
      setTimeout(() => {
        Promise.all([
          moveToTrashBestEffort(workspaceDir),
          moveToTrashBestEffort(agentParentDir),
        ]).catch(() => {});
      }, 3000);
    }
  },
  "agents.rename": async ({ params, respond, context }) => {
    if (!validateAgentsRenameParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.rename params: ${formatValidationErrors(validateAgentsRenameParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const oldId = normalizeAgentId(String(params.agentId ?? ""));
    const newId = normalizeAgentId(String(params.newId ?? ""));
    if (oldId === DEFAULT_AGENT_ID || newId === DEFAULT_AGENT_ID) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `"${DEFAULT_AGENT_ID}" cannot be renamed`),
      );
      return;
    }
    if (oldId === newId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "old and new IDs are identical"),
      );
      return;
    }
    if (findAgentEntryIndex(listAgentEntries(cfg), oldId) < 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${oldId}" not found`),
      );
      return;
    }
    if (findAgentEntryIndex(listAgentEntries(cfg), newId) >= 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${newId}" already exists`),
      );
      return;
    }
    // Directories use opaque UUIDs — no filesystem changes needed on rename.
    // Only config + session keys need rewriting.
    const agentDir = resolveAgentDir(cfg, oldId);
    const storePath = path.join(path.dirname(agentDir), "sessions", "sessions.json");
    let migratedSessions = 0;
    try {
      const result = await migrateSessionStore(storePath, oldId, newId);
      migratedSessions = result.migratedKeys;
    } catch {}

    const nextConfig = renameAgentConfig(cfg, oldId, newId);
    await writeConfigFile(nextConfig);

    context.broadcast?.("sessions.changed", {}, { dropIfSlow: true });
    respond(true, { ok: true, oldId, newId, migratedSessions }, undefined);
  },
  "agents.files.list": async ({ params, respond }) => {
    if (!validateAgentsFilesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.list params: ${formatValidationErrors(validateAgentsFilesListParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    let hideBootstrap = false;
    try {
      hideBootstrap = await isWorkspaceOnboardingCompleted(workspaceDir);
    } catch {}
    const files = await listAgentFiles(workspaceDir, { hideBootstrap });
    respond(true, { agentId, workspace: workspaceDir, files }, undefined);
  },
  "agents.files.get": async ({ params, respond }) => {
    if (!validateAgentsFilesGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.get params: ${formatValidationErrors(validateAgentsFilesGetParams.errors)}`,
        ),
      );
      return;
    }
    const resolved = resolveAgentWorkspaceFileOrRespondError(params, respond);
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name } = resolved;
    const filePath = path.join(workspaceDir, name);
    const meta = await statFile(filePath);
    if (!meta) {
      respond(
        true,
        {
          agentId,
          workspace: workspaceDir,
          file: { name, path: filePath, missing: true },
        },
        undefined,
      );
      return;
    }
    const ext = path.extname(name).toLowerCase();
    let content;
    let contentType;
    if (IMAGE_EXTENSIONS.has(ext)) {
      const buf = await fs.readFile(filePath);
      const mime =
        ext === ".svg"
          ? "image/svg+xml"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : `image/${ext.slice(1)}`;
      content = `data:${mime};base64,${buf.toString("base64")}`;
      contentType = "image";
    } else if (PDF_EXTENSIONS.has(ext)) {
      const buf = await fs.readFile(filePath);
      content = `data:application/pdf;base64,${buf.toString("base64")}`;
      contentType = "pdf";
    } else {
      content = await readSecureWorkspaceFile(filePath);
      contentType = TEXT_EXTENSIONS.has(ext) ? "text" : "binary";
    }
    respond(
      true,
      {
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: meta.size,
          updatedAtMs: meta.updatedAtMs,
          content,
          contentType,
        },
      },
      undefined,
    );
  },
  "agents.files.edit": async ({ params, respond, context }) => {
    if (!validateAgentsFilesEditParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.edit params: ${formatValidationErrors(validateAgentsFilesEditParams.errors)}`,
        ),
      );
      return;
    }
    const resolved = resolveAgentWorkspaceFileOrRespondError(params, respond);
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name } = resolved;
    if (PROTECTED_WORKSPACE_NAMES.has(name)) {
      const { credentials } = await loadCredentials();
      if (credentials.length === 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `"${name}" is protected. Register a WebAuthn credential (Touch ID / Face ID) to enable biometric approval.`,
          ),
        );
        return;
      }
      const manager = context?.fileApprovalManager;
      if (!manager) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `"${name}" is protected and approval manager is unavailable`,
          ),
        );
        return;
      }
      const preview = `Replace: ${String(params.oldText ?? "").slice(0, 150)}\nWith: ${String(params.newText ?? "").slice(0, 150)}`;
      const record = manager.create(
        { agentId, name, operation: "edit", preview },
        FILE_APPROVAL_TIMEOUT_MS,
      );
      const decisionPromise = manager.register(record, FILE_APPROVAL_TIMEOUT_MS);
      context.broadcast(
        "files.approval.required",
        {
          id: record.id,
          agentId,
          name,
          operation: "edit",
          preview: record.request.preview,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const decision = await decisionPromise;
      if (!decision || decision === "deny") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Edit to "${name}" was denied`),
        );
        return;
      }
    }
    const filePath = path.join(workspaceDir, name);
    const meta = await statFile(filePath);
    if (!meta) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `file "${name}" does not exist`),
      );
      return;
    }
    const content = await readSecureWorkspaceFile(filePath);
    const oldText = String(params.oldText);
    const newText = String(params.newText ?? "");
    const firstIdx = content.indexOf(oldText);
    if (firstIdx === -1) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "text not found"));
      return;
    }
    const secondIdx = content.indexOf(oldText, firstIdx + 1);
    if (secondIdx !== -1) {
      let count = 2;
      let searchFrom = secondIdx + 1;
      while (true) {
        const next = content.indexOf(oldText, searchFrom);
        if (next === -1) {
          break;
        }
        count++;
        searchFrom = next + 1;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `ambiguous: ${count} occurrences`),
      );
      return;
    }
    const updated = content.slice(0, firstIdx) + newText + content.slice(firstIdx + oldText.length);
    await writeSecureWorkspaceFile(filePath, updated);
    const newMeta = await statFile(filePath);
    respond(
      true,
      {
        ok: true,
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: newMeta?.size,
          updatedAtMs: newMeta?.updatedAtMs,
          content: updated,
        },
      },
      undefined,
    );
  },
  "agents.files.set": async ({ params, respond, context }) => {
    if (!validateAgentsFilesSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.set params: ${formatValidationErrors(validateAgentsFilesSetParams.errors)}`,
        ),
      );
      return;
    }
    const resolved = resolveAgentWorkspaceFileOrRespondError(params, respond);
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name } = resolved;
    if (PROTECTED_WORKSPACE_NAMES.has(name)) {
      const { credentials } = await loadCredentials();
      if (credentials.length === 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `"${name}" is protected. Register a WebAuthn credential (Touch ID / Face ID) to enable biometric approval.`,
          ),
        );
        return;
      }
      const manager = context?.fileApprovalManager;
      if (!manager) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `"${name}" is protected and approval manager is unavailable`,
          ),
        );
        return;
      }
      const content = String(params.content ?? "");
      const record = manager.create(
        { agentId, name, operation: "set", preview: content.slice(0, 300) },
        FILE_APPROVAL_TIMEOUT_MS,
      );
      const decisionPromise = manager.register(record, FILE_APPROVAL_TIMEOUT_MS);
      context.broadcast(
        "files.approval.required",
        {
          id: record.id,
          agentId,
          name,
          operation: "set",
          preview: record.request.preview,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const decision = await decisionPromise;
      if (!decision || decision === "deny") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Write to "${name}" was denied`),
        );
        return;
      }
    }
    await fs.mkdir(workspaceDir, { recursive: true });
    const filePath = path.join(workspaceDir, name);
    const content = String(params.content ?? "");
    await writeSecureWorkspaceFile(filePath, content);
    const meta = await statFile(filePath);
    respond(
      true,
      {
        ok: true,
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: meta?.size,
          updatedAtMs: meta?.updatedAtMs,
          content,
        },
      },
      undefined,
    );
  },
  "agents.files.delete": async ({ params, respond }) => {
    if (!validateAgentsFilesDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.delete params: ${formatValidationErrors(validateAgentsFilesDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const resolved = resolveAgentWorkspaceFileOrRespondError(params, respond);
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name } = resolved;
    if (BOOTSTRAP_FILE_NAMES.includes(name)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `cannot delete core file "${name}"`),
      );
      return;
    }
    const filePath = path.join(workspaceDir, name);
    try {
      await fs.access(filePath);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `file not found: "${name}"`),
      );
      return;
    }
    await moveToTrashBestEffort(filePath);
    respond(true, { ok: true, agentId, name }, undefined);
  },
  "agents.files.approve": async ({ params, respond, client, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    const token =
      typeof params?.webauthnSessionToken === "string" ? params.webauthnSessionToken : "";
    if (!id || !token) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "id and webauthnSessionToken are required"),
      );
      return;
    }
    if (!verifyWebAuthnSession(token)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid or expired WebAuthn session"),
      );
      return;
    }
    const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id ?? null;
    const ok = context?.fileApprovalManager?.resolve(id, "approve", resolvedBy);
    if (!ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id"),
      );
      return;
    }
    context.broadcast(
      "files.approval.resolved",
      { id, decision: "approve", resolvedBy },
      { dropIfSlow: true },
    );
    respond(true, { ok: true }, undefined);
  },
  "agents.files.deny": async ({ params, respond, client, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id ?? null;
    const ok = context?.fileApprovalManager?.resolve(id, "deny", resolvedBy);
    if (!ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id"),
      );
      return;
    }
    context.broadcast(
      "files.approval.resolved",
      { id, decision: "deny", resolvedBy },
      { dropIfSlow: true },
    );
    respond(true, { ok: true }, undefined);
  },
};
