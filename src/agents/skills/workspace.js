/**
 * Config domain entries for the unified Capabilities catalog.
 * Each entry maps a config_manage action to its description.
 */
const CONFIG_CATALOG_ENTRIES = [
  "channels: setup/manage communication channels (WhatsApp, Discord, Slack, Telegram, iMessage, Signal, Matrix, Nostr)",
  "providers: add, pause, remove AI provider credentials (Anthropic, OpenAI, Google, Ollama)",
  "apis: service API keys and tokens (env.vars) — Google SA, Tavily, Hashnode, Cloudflare, etc. Never in workspace files",
  "models: default model, defaultTier (simple/normal/complex), fallbacks, routing tier profiles (model + thinking + verbose + reasoning), aliases. IMPORTANT: to switch model in current session use session_status model={name}, NOT config_manage",
  "agents: create, configure, rename, delete agents and tool profiles",
  "sessions: manage sessions, reset, overrides, DM isolation",
  "tools: agent tool profiles, allow/deny policies, channel restrictions (managed via chat)",
  "cron: board overlay only — use the dedicated cron tool for all job operations (add/list/remove/run)",
  "tts: text-to-speech provider, voice, auto-mode",
  "memory: memory backend, embeddings, search paths",
  "usage: token analytics, cost breakdown (chart opens overlay)",
  "logs: gateway log viewer (view opens overlay, tail returns text)",
  "files: workspace file browser (browse opens overlay)",
  "skills: enable, disable, configure agent skills",
  "nodes: paired nodes, exec binding",
  "devices: paired device authorization and pairing",
  "approvals: exec security and approval policies",
  "security: vault status, harden (Fortress Mode), audit (security scan with findings + remediation)",
  "backup: state backups — create, list, verify, restore",
  "webauthn: Touch ID / WebAuthn credentials",
  "services: connected service guides — voice (Twilio), crm (HubSpot), payments (Stripe), calendar (Google), youtube (YouTube Data API), avatar (HeyGen)",
  "gateway: operational guide — bind, TLS, auth",
  "advanced: operational guide — canvas, plugins, diagnostics, updates",
];

/** Find longest common directory prefix across paths. */
function findCommonPrefix(paths) {
  if (paths.length < 2) return "";
  const parts0 = paths[0].split("/");
  let depth = parts0.length;
  for (let i = 1; i < paths.length; i++) {
    const parts = paths[i].split("/");
    let j = 0;
    while (j < depth && j < parts.length && parts0[j] === parts[j]) j++;
    depth = j;
  }
  return depth > 1 ? parts0.slice(0, depth).join("/") + "/" : "";
}

/**
 * Format unified Capabilities catalog in TOON format for system prompt.
 * Two domains: Skills (→ SKILL.md path) and Config (→ config_manage action).
 */
let formatSkillsForPrompt = function (skills) {
    const visible = skills.filter((s) => !s.disableModelInvocation);
    const lines = ["\n\nCapabilities:"];
    if (visible.length > 0) {
      lines.push("", "Skills (read SKILL.md at → path when task matches):", "");
      const paths = visible.map((s) => s.filePath);
      const prefix = findCommonPrefix(paths);
      if (prefix && visible.length > 2) {
        lines.push(`Base: ${prefix}`);
        for (const s of visible) {
          const rel = s.filePath.slice(prefix.length);
          lines.push(`${s.name}: ${s.description} → ${rel}`);
        }
      } else {
        for (const s of visible) {
          lines.push(`${s.name}: ${s.description} → ${s.filePath}`);
        }
      }
    }
    lines.push("", "Config (use config_manage tool with action name):", "");
    lines.push(...CONFIG_CATALOG_ENTRIES);
    return lines.join("\n");
  },
  compactSkillPaths = function (skills) {
    const home = os.homedir();
    if (!home) return skills;
    const prefix = home.endsWith(path.sep) ? home : home + path.sep;
    return skills.map((s) => ({
      ...s,
      filePath: s.filePath.startsWith(prefix) ? "~/" + s.filePath.slice(prefix.length) : s.filePath,
    }));
  },
  debugSkillCommandOnce = function (messageKey, message, meta) {
    if (skillCommandDebugOnce.has(messageKey)) {
      return;
    }
    skillCommandDebugOnce.add(messageKey);
    skillsLogger.debug(message, meta);
  },
  filterSkillEntries = function (entries, config, skillFilter, eligibility) {
    let filtered = entries.filter((entry) => shouldIncludeSkill({ entry, config, eligibility }));
    if (skillFilter !== undefined) {
      const normalized = normalizeSkillFilter(skillFilter) ?? [];
      const label = normalized.length > 0 ? normalized.join(", ") : "(none)";
      skillsLogger.debug(`Applying skill filter: ${label}`);
      filtered =
        normalized.length > 0
          ? filtered.filter((entry) => normalized.includes(entry.skill.name))
          : [];
      skillsLogger.debug(
        `After skill filter: ${filtered.map((entry) => entry.skill.name).join(", ") || "(none)"}`,
      );
    }
    return filtered;
  },
  sanitizeSkillCommandName = function (raw) {
    const normalized = raw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    const trimmed = normalized.slice(0, SKILL_COMMAND_MAX_LENGTH);
    return trimmed || SKILL_COMMAND_FALLBACK;
  },
  resolveUniqueSkillCommandName = function (base, used) {
    const normalizedBase = base.toLowerCase();
    if (!used.has(normalizedBase)) {
      return base;
    }
    for (let index = 2; index < 1000; index += 1) {
      const suffix = `_${index}`;
      const maxBaseLength = Math.max(1, SKILL_COMMAND_MAX_LENGTH - suffix.length);
      const trimmedBase = base.slice(0, maxBaseLength);
      const candidate = `${trimmedBase}${suffix}`;
      const candidateKey = candidate.toLowerCase();
      if (!used.has(candidateKey)) {
        return candidate;
      }
    }
    const fallback = `${base.slice(0, Math.max(1, SKILL_COMMAND_MAX_LENGTH - 2))}_x`;
    return fallback;
  },
  resolveSkillsLimits = function (config) {
    const limits = config?.skills?.limits;
    return {
      maxCandidatesPerRoot: limits?.maxCandidatesPerRoot ?? DEFAULT_MAX_CANDIDATES_PER_ROOT,
      maxSkillsLoadedPerSource:
        limits?.maxSkillsLoadedPerSource ?? DEFAULT_MAX_SKILLS_LOADED_PER_SOURCE,
      maxSkillsInPrompt: limits?.maxSkillsInPrompt ?? DEFAULT_MAX_SKILLS_IN_PROMPT,
      maxSkillsPromptChars: limits?.maxSkillsPromptChars ?? DEFAULT_MAX_SKILLS_PROMPT_CHARS,
      maxSkillFileBytes: limits?.maxSkillFileBytes ?? DEFAULT_MAX_SKILL_FILE_BYTES,
    };
  },
  listChildDirectories = function (dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          dirs.push(entry.name);
          continue;
        }
        if (entry.isSymbolicLink()) {
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              dirs.push(entry.name);
            }
          } catch {}
        }
      }
      return dirs;
    } catch {
      return [];
    }
  },
  resolveNestedSkillsRoot = function (dir, opts) {
    const nested = path.join(dir, "skills");
    try {
      if (!fs.existsSync(nested) || !fs.statSync(nested).isDirectory()) {
        return { baseDir: dir };
      }
    } catch {
      return { baseDir: dir };
    }
    const nestedDirs = listChildDirectories(nested);
    const scanLimit = Math.max(0, opts?.maxEntriesToScan ?? 100);
    const toScan =
      scanLimit === 0 ? [] : nestedDirs.slice(0, Math.min(nestedDirs.length, scanLimit));
    for (const name of toScan) {
      const skillMd = path.join(nested, name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        return { baseDir: nested, note: `Detected nested skills root at ${nested}` };
      }
    }
    return { baseDir: dir };
  },
  unwrapLoadedSkills = function (loaded) {
    if (Array.isArray(loaded)) {
      return loaded;
    }
    if (loaded && typeof loaded === "object" && "skills" in loaded) {
      const skills = loaded.skills;
      if (Array.isArray(skills)) {
        return skills;
      }
    }
    return [];
  },
  /** @type {Map<string, {version: number, entries: Array}>} */
  skillEntriesCache = new Map(),
  loadSkillEntries = function (workspaceDir, opts) {
    const currentVersion = opts?.snapshotVersion ?? 0;
    if (currentVersion > 0) {
      const cached = skillEntriesCache.get(workspaceDir);
      if (cached && cached.version >= currentVersion) {
        return cached.entries;
      }
    }
    const limits = resolveSkillsLimits(opts?.config);
    const loadSkills = (params) => {
      const resolved = resolveNestedSkillsRoot(params.dir, {
        maxEntriesToScan: limits.maxCandidatesPerRoot,
      });
      const baseDir = resolved.baseDir;
      const rootSkillMd = path.join(baseDir, "SKILL.md");
      if (fs.existsSync(rootSkillMd)) {
        try {
          const size = fs.statSync(rootSkillMd).size;
          if (size > limits.maxSkillFileBytes) {
            skillsLogger.warn("Skipping skills root due to oversized SKILL.md.", {
              dir: baseDir,
              filePath: rootSkillMd,
              size,
              maxSkillFileBytes: limits.maxSkillFileBytes,
            });
            return [];
          }
        } catch {
          return [];
        }
        const loaded = loadSkillsFromDirWithDecrypt({ dir: baseDir, source: params.source });
        return unwrapLoadedSkills(loaded);
      }
      const childDirs = listChildDirectories(baseDir);
      const suspicious = childDirs.length > limits.maxCandidatesPerRoot;
      const maxCandidates = Math.max(0, limits.maxSkillsLoadedPerSource);
      const limitedChildren = childDirs.slice().sort().slice(0, maxCandidates);
      if (suspicious) {
        skillsLogger.warn("Skills root looks suspiciously large, truncating discovery.", {
          dir: params.dir,
          baseDir,
          childDirCount: childDirs.length,
          maxCandidatesPerRoot: limits.maxCandidatesPerRoot,
          maxSkillsLoadedPerSource: limits.maxSkillsLoadedPerSource,
        });
      } else if (childDirs.length > maxCandidates) {
        skillsLogger.warn("Skills root has many entries, truncating discovery.", {
          dir: params.dir,
          baseDir,
          childDirCount: childDirs.length,
          maxSkillsLoadedPerSource: limits.maxSkillsLoadedPerSource,
        });
      }
      const loadedSkills = [];
      for (const name of limitedChildren) {
        const skillDir = path.join(baseDir, name);
        const skillMd = path.join(skillDir, "SKILL.md");
        if (!fs.existsSync(skillMd)) {
          continue;
        }
        try {
          const size = fs.statSync(skillMd).size;
          if (size > limits.maxSkillFileBytes) {
            skillsLogger.warn("Skipping skill due to oversized SKILL.md.", {
              skill: name,
              filePath: skillMd,
              size,
              maxSkillFileBytes: limits.maxSkillFileBytes,
            });
            continue;
          }
        } catch {
          continue;
        }
        const loaded = loadSkillsFromDirWithDecrypt({ dir: skillDir, source: params.source });
        loadedSkills.push(...unwrapLoadedSkills(loaded));
        if (loadedSkills.length >= limits.maxSkillsLoadedPerSource) {
          break;
        }
      }
      if (loadedSkills.length > limits.maxSkillsLoadedPerSource) {
        return loadedSkills
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, limits.maxSkillsLoadedPerSource);
      }
      return loadedSkills;
    };
    const managedSkillsDir = opts?.managedSkillsDir ?? path.join(CONFIG_DIR, "skills");
    const workspaceSkillsDir = path.resolve(workspaceDir, "skills");
    const bundledSkillsDir = opts?.bundledSkillsDir ?? resolveBundledSkillsDir();
    const extraDirsRaw = opts?.config?.skills?.load?.extraDirs ?? [];
    const extraDirs = extraDirsRaw
      .map((d) => (typeof d === "string" ? d.trim() : ""))
      .filter(Boolean);
    const pluginSkillDirs = resolvePluginSkillDirs({
      workspaceDir,
      config: opts?.config,
    });
    const mergedExtraDirs = [...extraDirs, ...pluginSkillDirs];
    const bundledSkills = bundledSkillsDir
      ? loadSkills({
          dir: bundledSkillsDir,
          source: "genosos-bundled",
        })
      : [];
    const extraSkills = mergedExtraDirs.flatMap((dir) => {
      const resolved = resolveUserPath(dir);
      return loadSkills({
        dir: resolved,
        source: "genosos-extra",
      });
    });
    const managedSkills = loadSkills({
      dir: managedSkillsDir,
      source: "genosos-managed",
    });
    const personalAgentsSkillsDir = path.resolve(os.homedir(), ".agents", "skills");
    const personalAgentsSkills = loadSkills({
      dir: personalAgentsSkillsDir,
      source: "agents-skills-personal",
    });
    const projectAgentsSkillsDir = path.resolve(workspaceDir, ".agents", "skills");
    const projectAgentsSkills = loadSkills({
      dir: projectAgentsSkillsDir,
      source: "agents-skills-project",
    });
    const workspaceSkills = loadSkills({
      dir: workspaceSkillsDir,
      source: "genosos-workspace",
    });
    const merged = new Map();
    for (const skill of extraSkills) {
      merged.set(skill.name, skill);
    }
    for (const skill of bundledSkills) {
      merged.set(skill.name, skill);
    }
    for (const skill of managedSkills) {
      merged.set(skill.name, skill);
    }
    for (const skill of personalAgentsSkills) {
      merged.set(skill.name, skill);
    }
    for (const skill of projectAgentsSkills) {
      merged.set(skill.name, skill);
    }
    for (const skill of workspaceSkills) {
      merged.set(skill.name, skill);
    }
    const skillEntries = Array.from(merged.values()).map((skill) => {
      let frontmatter = {};
      try {
        const raw = readSkillFile(skill.filePath);
        frontmatter = parseFrontmatter(raw);
      } catch {}
      return {
        skill,
        frontmatter,
        metadata: resolveGenosOSMetadata(frontmatter),
        invocation: resolveSkillInvocationPolicy(frontmatter),
      };
    });
    if (currentVersion > 0) {
      skillEntriesCache.set(workspaceDir, { version: currentVersion, entries: skillEntries });
    }
    return skillEntries;
  },
  applySkillsPromptLimits = function (params) {
    const limits = resolveSkillsLimits(params.config);
    const total = params.skills.length;
    const byCount = params.skills.slice(0, Math.max(0, limits.maxSkillsInPrompt));
    let skillsForPrompt = byCount;
    let truncated = total > byCount.length;
    let truncatedReason = truncated ? "count" : null;
    const fits = (skills) => {
      const block = formatSkillsForPrompt(skills);
      return block.length <= limits.maxSkillsPromptChars;
    };
    if (!fits(skillsForPrompt)) {
      let lo = 0;
      let hi = skillsForPrompt.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(skillsForPrompt.slice(0, mid))) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      skillsForPrompt = skillsForPrompt.slice(0, lo);
      truncated = true;
      truncatedReason = "chars";
    }
    return { skillsForPrompt, truncated, truncatedReason };
  },
  resolveUniqueSyncedSkillDirName = function (base, used) {
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    for (let index = 2; index < 1e4; index += 1) {
      const candidate = `${base}-${index}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
    let fallbackIndex = 1e4;
    let fallback = `${base}-${fallbackIndex}`;
    while (used.has(fallback)) {
      fallbackIndex += 1;
      fallback = `${base}-${fallbackIndex}`;
    }
    used.add(fallback);
    return fallback;
  },
  resolveSyncedSkillDestinationPath = function (params) {
    const sourceDirName = path.basename(params.entry.skill.baseDir).trim();
    if (!sourceDirName || sourceDirName === "." || sourceDirName === "..") {
      return null;
    }
    const uniqueDirName = resolveUniqueSyncedSkillDirName(sourceDirName, params.usedDirNames);
    return path.resolve(params.targetSkillsDir, uniqueDirName);
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkillsFromDir } from "@mariozechner/pi-coding-agent";
import { resolvePassphrase } from "../../infra/crypto-utils.js";
import { decryptContent } from "../../infra/memory-encryption.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { resolveBundledSkillsDir } from "./bundled-dir.js";
import { shouldIncludeSkill } from "./config.js";
import { normalizeSkillFilter } from "./filter.js";
import {
  parseFrontmatter,
  resolveGenosOSMetadata,
  resolveSkillInvocationPolicy,
} from "./frontmatter.js";
import { resolvePluginSkillDirs } from "./plugin-skills.js";
import { serializeByKey } from "./serialize.js";
const fsp = fs.promises;
const skillsLogger = createSubsystemLogger("skills");

/**
 * Read a SKILL.md file, transparently decrypting NYXENC1 content.
 * @param {string} filePath
 * @returns {string} Plaintext content
 */
const readSkillFile = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.startsWith("NYXENC1\n")) return raw;
  try {
    return decryptContent(raw, resolvePassphrase());
  } catch {
    return raw;
  }
};

/**
 * Load skills from a directory, handling NYXENC1-encrypted SKILL.md files.
 * Falls back to upstream loadSkillsFromDir for unencrypted files.
 * @param {{ dir: string, source: string }} params
 * @returns {object}
 */
const loadSkillsFromDirWithDecrypt = (params) => {
  const skillMd = path.join(params.dir, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    const raw = fs.readFileSync(skillMd, "utf-8");
    if (raw.startsWith("NYXENC1\n")) {
      try {
        const plaintext = readSkillFile(skillMd);
        const fm = parseFrontmatter(plaintext);
        if (!fm.description?.trim()) return { skills: [], diagnostics: [] };
        const name = fm.name || path.basename(params.dir);
        return {
          skills: [
            {
              name,
              description: fm.description,
              filePath: skillMd,
              baseDir: params.dir,
              source: params.source,
              disableModelInvocation: fm["disable-model-invocation"] === true,
            },
          ],
          diagnostics: [],
        };
      } catch (err) {
        skillsLogger.warn("Failed to decrypt SKILL.md", { dir: params.dir, error: err.message });
        return { skills: [], diagnostics: [] };
      }
    }
  }
  return loadSkillsFromDir(params);
};
const skillCommandDebugOnce = new Set();
const SKILL_COMMAND_MAX_LENGTH = 32;
const SKILL_COMMAND_FALLBACK = "skill";
const SKILL_COMMAND_DESCRIPTION_MAX_LENGTH = 100;
const DEFAULT_MAX_CANDIDATES_PER_ROOT = 300;
const DEFAULT_MAX_SKILLS_LOADED_PER_SOURCE = 200;
const DEFAULT_MAX_SKILLS_IN_PROMPT = 150;
const DEFAULT_MAX_SKILLS_PROMPT_CHARS = 30000;
const DEFAULT_MAX_SKILL_FILE_BYTES = 256000;
export function buildWorkspaceSkillSnapshot(workspaceDir, opts) {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const promptEntries = eligible.filter(
    (entry) => entry.invocation?.disableModelInvocation !== true,
  );
  const resolvedSkills = promptEntries.map((entry) => entry.skill);
  const remoteNote = opts?.eligibility?.remote?.note?.trim();
  const { skillsForPrompt, truncated } = applySkillsPromptLimits({
    skills: resolvedSkills,
    config: opts?.config,
  });
  const truncationNote = truncated
    ? `\u26A0\uFE0F Skills truncated: included ${skillsForPrompt.length} of ${resolvedSkills.length}. Run \`genosos skills check\` to audit.`
    : "";
  const prompt = [
    remoteNote,
    truncationNote,
    formatSkillsForPrompt(compactSkillPaths(skillsForPrompt)),
  ]
    .filter(Boolean)
    .join("\n");
  const skillFilter = normalizeSkillFilter(opts?.skillFilter);
  return {
    prompt,
    skills: eligible.map((entry) => ({
      name: entry.skill.name,
      primaryEnv: entry.metadata?.primaryEnv,
    })),
    ...(skillFilter === undefined ? {} : { skillFilter }),
    resolvedSkills,
    version: opts?.snapshotVersion,
  };
}
export function buildWorkspaceSkillsPrompt(workspaceDir, opts) {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const promptEntries = eligible.filter(
    (entry) => entry.invocation?.disableModelInvocation !== true,
  );
  const remoteNote = opts?.eligibility?.remote?.note?.trim();
  const resolvedSkills = promptEntries.map((entry) => entry.skill);
  const { skillsForPrompt, truncated } = applySkillsPromptLimits({
    skills: resolvedSkills,
    config: opts?.config,
  });
  const truncationNote = truncated
    ? `\u26A0\uFE0F Skills truncated: included ${skillsForPrompt.length} of ${resolvedSkills.length}. Run \`genosos skills check\` to audit.`
    : "";
  return [remoteNote, truncationNote, formatSkillsForPrompt(compactSkillPaths(skillsForPrompt))]
    .filter(Boolean)
    .join("\n");
}
export function resolveSkillsPromptForRun(params) {
  const snapshotPrompt = params.skillsSnapshot?.prompt?.trim();
  if (snapshotPrompt) {
    return snapshotPrompt;
  }
  if (params.entries && params.entries.length > 0) {
    const prompt = buildWorkspaceSkillsPrompt(params.workspaceDir, {
      entries: params.entries,
      config: params.config,
    });
    return prompt.trim() ? prompt : "";
  }
  return "";
}
export function loadWorkspaceSkillEntries(workspaceDir, opts) {
  return loadSkillEntries(workspaceDir, opts);
}
export async function syncSkillsToWorkspace(params) {
  const sourceDir = resolveUserPath(params.sourceWorkspaceDir);
  const targetDir = resolveUserPath(params.targetWorkspaceDir);
  if (sourceDir === targetDir) {
    return;
  }
  await serializeByKey(`syncSkills:${targetDir}`, async () => {
    const targetSkillsDir = path.join(targetDir, "skills");
    const entries = loadSkillEntries(sourceDir, {
      config: params.config,
      managedSkillsDir: params.managedSkillsDir,
      bundledSkillsDir: params.bundledSkillsDir,
    });
    await fsp.rm(targetSkillsDir, { recursive: true, force: true });
    await fsp.mkdir(targetSkillsDir, { recursive: true });
    const usedDirNames = new Set();
    for (const entry of entries) {
      let dest = null;
      try {
        dest = resolveSyncedSkillDestinationPath({
          targetSkillsDir,
          entry,
          usedDirNames,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        console.warn(
          `[skills] Failed to resolve safe destination for ${entry.skill.name}: ${message}`,
        );
        continue;
      }
      if (!dest) {
        console.warn(
          `[skills] Failed to resolve safe destination for ${entry.skill.name}: invalid source directory name`,
        );
        continue;
      }
      try {
        await fsp.cp(entry.skill.baseDir, dest, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        console.warn(`[skills] Failed to copy ${entry.skill.name} to sandbox: ${message}`);
      }
    }
  });
}
export function filterWorkspaceSkillEntries(entries, config) {
  return filterSkillEntries(entries, config);
}
export function buildWorkspaceSkillCommandSpecs(workspaceDir, opts) {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
    opts?.eligibility,
  );
  const userInvocable = eligible.filter((entry) => entry.invocation?.userInvocable !== false);
  const used = new Set();
  for (const reserved of opts?.reservedNames ?? []) {
    used.add(reserved.toLowerCase());
  }
  const specs = [];
  for (const entry of userInvocable) {
    const rawName = entry.skill.name;
    const base = sanitizeSkillCommandName(rawName);
    if (base !== rawName) {
      debugSkillCommandOnce(
        `sanitize:${rawName}:${base}`,
        `Sanitized skill command name "${rawName}" to "/${base}".`,
        { rawName, sanitized: `/${base}` },
      );
    }
    const unique = resolveUniqueSkillCommandName(base, used);
    if (unique !== base) {
      debugSkillCommandOnce(
        `dedupe:${rawName}:${unique}`,
        `De-duplicated skill command name for "${rawName}" to "/${unique}".`,
        { rawName, deduped: `/${unique}` },
      );
    }
    used.add(unique.toLowerCase());
    const rawDescription = entry.skill.description?.trim() || rawName;
    const description =
      rawDescription.length > SKILL_COMMAND_DESCRIPTION_MAX_LENGTH
        ? rawDescription.slice(0, SKILL_COMMAND_DESCRIPTION_MAX_LENGTH - 1) + "\u2026"
        : rawDescription;
    const dispatch = (() => {
      const kindRaw = (
        entry.frontmatter?.["command-dispatch"] ??
        entry.frontmatter?.["command_dispatch"] ??
        ""
      )
        .trim()
        .toLowerCase();
      if (!kindRaw) {
        return;
      }
      if (kindRaw !== "tool") {
        return;
      }
      const toolName = (
        entry.frontmatter?.["command-tool"] ??
        entry.frontmatter?.["command_tool"] ??
        ""
      ).trim();
      if (!toolName) {
        debugSkillCommandOnce(
          `dispatch:missingTool:${rawName}`,
          `Skill command "/${unique}" requested tool dispatch but did not provide command-tool. Ignoring dispatch.`,
          { skillName: rawName, command: unique },
        );
        return;
      }
      const argModeRaw = (
        entry.frontmatter?.["command-arg-mode"] ??
        entry.frontmatter?.["command_arg_mode"] ??
        ""
      )
        .trim()
        .toLowerCase();
      const argMode = !argModeRaw || argModeRaw === "raw" ? "raw" : null;
      if (!argMode) {
        debugSkillCommandOnce(
          `dispatch:badArgMode:${rawName}:${argModeRaw}`,
          `Skill command "/${unique}" requested tool dispatch but has unknown command-arg-mode. Falling back to raw.`,
          { skillName: rawName, command: unique, argMode: argModeRaw },
        );
      }
      return { kind: "tool", toolName, argMode: "raw" };
    })();
    specs.push({
      name: unique,
      skillName: rawName,
      description,
      ...(dispatch ? { dispatch } : {}),
    });
  }
  return specs;
}
/**
 * Clear the in-memory skill entries cache.
 * @param {string} [workspaceDir] - Clear only this workspace; omit to clear all.
 */
export function clearSkillEntriesCache(workspaceDir) {
  workspaceDir ? skillEntriesCache.delete(workspaceDir) : skillEntriesCache.clear();
}
