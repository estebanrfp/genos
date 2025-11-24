let filterHookEntries = function (entries, config, eligibility) {
    return entries.filter((entry) => shouldIncludeHook({ entry, config, eligibility }));
  },
  readHookPackageManifest = function (dir) {
    const manifestPath = path.join(dir, "package.json");
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  resolvePackageHooks = function (manifest) {
    const raw = manifest[MANIFEST_KEY]?.hooks;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
  },
  resolveContainedDir = function (baseDir, targetDir) {
    const base = path.resolve(baseDir);
    const resolved = path.resolve(baseDir, targetDir);
    const relative = path.relative(base, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null;
    }
    return resolved;
  },
  loadHookFromDir = function (params) {
    const hookMdPath = path.join(params.hookDir, "HOOK.md");
    if (!fs.existsSync(hookMdPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(hookMdPath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const name = frontmatter.name || params.nameHint || path.basename(params.hookDir);
      const description = frontmatter.description || "";
      const handlerCandidates = ["handler.ts", "handler.js", "index.ts", "index.js"];
      let handlerPath;
      for (const candidate of handlerCandidates) {
        const candidatePath = path.join(params.hookDir, candidate);
        if (fs.existsSync(candidatePath)) {
          handlerPath = candidatePath;
          break;
        }
      }
      if (!handlerPath) {
        console.warn(`[hooks] Hook "${name}" has HOOK.md but no handler file in ${params.hookDir}`);
        return null;
      }
      return {
        name,
        description,
        source: params.source,
        pluginId: params.pluginId,
        filePath: hookMdPath,
        baseDir: params.hookDir,
        handlerPath,
      };
    } catch (err) {
      console.warn(`[hooks] Failed to load hook from ${params.hookDir}:`, err);
      return null;
    }
  },
  loadHooksFromDir = function (params) {
    const { dir, source, pluginId } = params;
    if (!fs.existsSync(dir)) {
      return [];
    }
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      return [];
    }
    const hooks = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const hookDir = path.join(dir, entry.name);
      const manifest = readHookPackageManifest(hookDir);
      const packageHooks = manifest ? resolvePackageHooks(manifest) : [];
      if (packageHooks.length > 0) {
        for (const hookPath of packageHooks) {
          const resolvedHookDir = resolveContainedDir(hookDir, hookPath);
          if (!resolvedHookDir) {
            console.warn(
              `[hooks] Ignoring out-of-package hook path "${hookPath}" in ${hookDir} (must be within package directory)`,
            );
            continue;
          }
          const hook = loadHookFromDir({
            hookDir: resolvedHookDir,
            source,
            pluginId,
            nameHint: path.basename(resolvedHookDir),
          });
          if (hook) {
            hooks.push(hook);
          }
        }
        continue;
      }
      const hook = loadHookFromDir({
        hookDir,
        source,
        pluginId,
        nameHint: entry.name,
      });
      if (hook) {
        hooks.push(hook);
      }
    }
    return hooks;
  },
  loadHookEntries = function (workspaceDir, opts) {
    const managedHooksDir = opts?.managedHooksDir ?? path.join(CONFIG_DIR, "hooks");
    const workspaceHooksDir = path.join(workspaceDir, "hooks");
    const bundledHooksDir = opts?.bundledHooksDir ?? resolveBundledHooksDir();
    const extraDirsRaw = opts?.config?.hooks?.internal?.load?.extraDirs ?? [];
    const extraDirs = extraDirsRaw
      .map((d) => (typeof d === "string" ? d.trim() : ""))
      .filter(Boolean);
    const bundledHooks = bundledHooksDir
      ? loadHooksFromDir({
          dir: bundledHooksDir,
          source: "genosos-bundled",
        })
      : [];
    const extraHooks = extraDirs.flatMap((dir) => {
      const resolved = resolveUserPath(dir);
      return loadHooksFromDir({
        dir: resolved,
        source: "genosos-workspace",
      });
    });
    const managedHooks = loadHooksFromDir({
      dir: managedHooksDir,
      source: "genosos-managed",
    });
    const workspaceHooks = loadHooksFromDir({
      dir: workspaceHooksDir,
      source: "genosos-workspace",
    });
    const merged = new Map();
    for (const hook of extraHooks) {
      merged.set(hook.name, hook);
    }
    for (const hook of bundledHooks) {
      merged.set(hook.name, hook);
    }
    for (const hook of managedHooks) {
      merged.set(hook.name, hook);
    }
    for (const hook of workspaceHooks) {
      merged.set(hook.name, hook);
    }
    return Array.from(merged.values()).map((hook) => {
      let frontmatter = {};
      try {
        const raw = fs.readFileSync(hook.filePath, "utf-8");
        frontmatter = parseFrontmatter(raw);
      } catch {}
      return {
        hook,
        frontmatter,
        metadata: resolveGenosOSMetadata(frontmatter),
        invocation: resolveHookInvocationPolicy(frontmatter),
      };
    });
  };
import fs from "node:fs";
import path from "node:path";
import { MANIFEST_KEY } from "../compat/legacy-names.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import { resolveBundledHooksDir } from "./bundled-dir.js";
import { shouldIncludeHook } from "./config.js";
import {
  parseFrontmatter,
  resolveGenosOSMetadata,
  resolveHookInvocationPolicy,
} from "./frontmatter.js";
export function loadHookEntriesFromDir(params) {
  const hooks = loadHooksFromDir({
    dir: params.dir,
    source: params.source,
    pluginId: params.pluginId,
  });
  return hooks.map((hook) => {
    let frontmatter = {};
    try {
      const raw = fs.readFileSync(hook.filePath, "utf-8");
      frontmatter = parseFrontmatter(raw);
    } catch {}
    const entry = {
      hook: {
        ...hook,
        source: params.source,
        pluginId: params.pluginId,
      },
      frontmatter,
      metadata: resolveGenosOSMetadata(frontmatter),
      invocation: resolveHookInvocationPolicy(frontmatter),
    };
    return entry;
  });
}
export function buildWorkspaceHookSnapshot(workspaceDir, opts) {
  const hookEntries = opts?.entries ?? loadHookEntries(workspaceDir, opts);
  const eligible = filterHookEntries(hookEntries, opts?.config, opts?.eligibility);
  return {
    hooks: eligible.map((entry) => ({
      name: entry.hook.name,
      events: entry.metadata?.events ?? [],
    })),
    resolvedHooks: eligible.map((entry) => entry.hook),
    version: opts?.snapshotVersion,
  };
}
export function loadWorkspaceHookEntries(workspaceDir, opts) {
  return loadHookEntries(workspaceDir, opts);
}
