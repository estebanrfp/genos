let validateHookId = function (hookId) {
    if (!hookId) {
      return "invalid hook name: missing";
    }
    if (hookId === "." || hookId === "..") {
      return "invalid hook name: reserved path segment";
    }
    if (hookId.includes("/") || hookId.includes("\\")) {
      return "invalid hook name: path separators not allowed";
    }
    return null;
  },
  resolveHookInstallModeOptions = function (params) {
    return {
      logger: params.logger ?? defaultLogger,
      mode: params.mode ?? "install",
      dryRun: params.dryRun ?? false,
    };
  },
  resolveTimedHookInstallModeOptions = function (params) {
    return {
      ...resolveHookInstallModeOptions(params),
      timeoutMs: params.timeoutMs ?? 120000,
    };
  };
import fs from "node:fs/promises";
import path from "node:path";
import { MANIFEST_KEY } from "../compat/legacy-names.js";
import {
  extractArchive,
  fileExists,
  readJsonFile,
  resolveArchiveKind,
  resolvePackedRootDir,
} from "../infra/archive.js";
import { installPackageDir } from "../infra/install-package-dir.js";
import { resolveSafeInstallDir, unscopedPackageName } from "../infra/install-safe-path.js";
import {
  packNpmSpecToArchive,
  resolveArchiveSourcePath,
  withTempDir,
} from "../infra/install-source-utils.js";
import { validateRegistryNpmSpec } from "../infra/npm-registry-spec.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import { parseFrontmatter } from "./frontmatter.js";
const defaultLogger = {};
export function resolveHookInstallDir(hookId, hooksDir) {
  const hooksBase = hooksDir ? resolveUserPath(hooksDir) : path.join(CONFIG_DIR, "hooks");
  const hookIdError = validateHookId(hookId);
  if (hookIdError) {
    throw new Error(hookIdError);
  }
  const targetDirResult = resolveSafeInstallDir({
    baseDir: hooksBase,
    id: hookId,
    invalidNameMessage: "invalid hook name: path traversal detected",
  });
  if (!targetDirResult.ok) {
    throw new Error(targetDirResult.error);
  }
  return targetDirResult.path;
}
async function ensureGenosOSHooks(manifest) {
  const hooks = manifest[MANIFEST_KEY]?.hooks;
  if (!Array.isArray(hooks)) {
    throw new Error("package.json missing genosos.hooks");
  }
  const list = hooks.map((e) => (typeof e === "string" ? e.trim() : "")).filter(Boolean);
  if (list.length === 0) {
    throw new Error("package.json genosos.hooks is empty");
  }
  return list;
}
async function resolveInstallTargetDir(id, hooksDir) {
  const baseHooksDir = hooksDir ? resolveUserPath(hooksDir) : path.join(CONFIG_DIR, "hooks");
  await fs.mkdir(baseHooksDir, { recursive: true });
  const targetDirResult = resolveSafeInstallDir({
    baseDir: baseHooksDir,
    id,
    invalidNameMessage: "invalid hook name: path traversal detected",
  });
  if (!targetDirResult.ok) {
    return { ok: false, error: targetDirResult.error };
  }
  return { ok: true, targetDir: targetDirResult.path };
}
async function resolveHookNameFromDir(hookDir) {
  const hookMdPath = path.join(hookDir, "HOOK.md");
  if (!(await fileExists(hookMdPath))) {
    throw new Error(`HOOK.md missing in ${hookDir}`);
  }
  const raw = await fs.readFile(hookMdPath, "utf-8");
  const frontmatter = parseFrontmatter(raw);
  return frontmatter.name || path.basename(hookDir);
}
async function validateHookDir(hookDir) {
  const hookMdPath = path.join(hookDir, "HOOK.md");
  if (!(await fileExists(hookMdPath))) {
    throw new Error(`HOOK.md missing in ${hookDir}`);
  }
  const handlerCandidates = ["handler.ts", "handler.js", "index.ts", "index.js"];
  const hasHandler = await Promise.all(
    handlerCandidates.map(async (candidate) => fileExists(path.join(hookDir, candidate))),
  ).then((results) => results.some(Boolean));
  if (!hasHandler) {
    throw new Error(`handler.ts/handler.js/index.ts/index.js missing in ${hookDir}`);
  }
}
async function installHookPackageFromDir(params) {
  const { logger, timeoutMs, mode, dryRun } = resolveTimedHookInstallModeOptions(params);
  const manifestPath = path.join(params.packageDir, "package.json");
  if (!(await fileExists(manifestPath))) {
    return { ok: false, error: "package.json missing" };
  }
  let manifest;
  try {
    manifest = await readJsonFile(manifestPath);
  } catch (err) {
    return { ok: false, error: `invalid package.json: ${String(err)}` };
  }
  let hookEntries;
  try {
    hookEntries = await ensureGenosOSHooks(manifest);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  const pkgName = typeof manifest.name === "string" ? manifest.name : "";
  const hookPackId = pkgName ? unscopedPackageName(pkgName) : path.basename(params.packageDir);
  const hookIdError = validateHookId(hookPackId);
  if (hookIdError) {
    return { ok: false, error: hookIdError };
  }
  if (params.expectedHookPackId && params.expectedHookPackId !== hookPackId) {
    return {
      ok: false,
      error: `hook pack id mismatch: expected ${params.expectedHookPackId}, got ${hookPackId}`,
    };
  }
  const targetDirResult = await resolveInstallTargetDir(hookPackId, params.hooksDir);
  if (!targetDirResult.ok) {
    return { ok: false, error: targetDirResult.error };
  }
  const targetDir = targetDirResult.targetDir;
  if (mode === "install" && (await fileExists(targetDir))) {
    return { ok: false, error: `hook pack already exists: ${targetDir} (delete it first)` };
  }
  const resolvedHooks = [];
  for (const entry of hookEntries) {
    const hookDir = path.resolve(params.packageDir, entry);
    await validateHookDir(hookDir);
    const hookName = await resolveHookNameFromDir(hookDir);
    resolvedHooks.push(hookName);
  }
  if (dryRun) {
    return {
      ok: true,
      hookPackId,
      hooks: resolvedHooks,
      targetDir,
      version: typeof manifest.version === "string" ? manifest.version : undefined,
    };
  }
  const deps = manifest.dependencies ?? {};
  const hasDeps = Object.keys(deps).length > 0;
  const installRes = await installPackageDir({
    sourceDir: params.packageDir,
    targetDir,
    mode,
    timeoutMs,
    logger,
    copyErrorPrefix: "failed to copy hook pack",
    hasDeps,
    depsLogMessage: "Installing hook pack dependencies\u2026",
  });
  if (!installRes.ok) {
    return installRes;
  }
  return {
    ok: true,
    hookPackId,
    hooks: resolvedHooks,
    targetDir,
    version: typeof manifest.version === "string" ? manifest.version : undefined,
  };
}
async function installHookFromDir(params) {
  const { logger, mode, dryRun } = resolveHookInstallModeOptions(params);
  await validateHookDir(params.hookDir);
  const hookName = await resolveHookNameFromDir(params.hookDir);
  const hookIdError = validateHookId(hookName);
  if (hookIdError) {
    return { ok: false, error: hookIdError };
  }
  if (params.expectedHookPackId && params.expectedHookPackId !== hookName) {
    return {
      ok: false,
      error: `hook id mismatch: expected ${params.expectedHookPackId}, got ${hookName}`,
    };
  }
  const targetDirResult = await resolveInstallTargetDir(hookName, params.hooksDir);
  if (!targetDirResult.ok) {
    return { ok: false, error: targetDirResult.error };
  }
  const targetDir = targetDirResult.targetDir;
  if (mode === "install" && (await fileExists(targetDir))) {
    return { ok: false, error: `hook already exists: ${targetDir} (delete it first)` };
  }
  if (dryRun) {
    return { ok: true, hookPackId: hookName, hooks: [hookName], targetDir };
  }
  logger.info?.(`Installing to ${targetDir}\u2026`);
  let backupDir = null;
  if (mode === "update" && (await fileExists(targetDir))) {
    backupDir = `${targetDir}.backup-${Date.now()}`;
    await fs.rename(targetDir, backupDir);
  }
  try {
    await fs.cp(params.hookDir, targetDir, { recursive: true });
  } catch (err) {
    if (backupDir) {
      await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {
        return;
      });
      await fs.rename(backupDir, targetDir).catch(() => {
        return;
      });
    }
    return { ok: false, error: `failed to copy hook: ${String(err)}` };
  }
  if (backupDir) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {
      return;
    });
  }
  return { ok: true, hookPackId: hookName, hooks: [hookName], targetDir };
}
export async function installHooksFromArchive(params) {
  const logger = params.logger ?? defaultLogger;
  const timeoutMs = params.timeoutMs ?? 120000;
  const archivePathResult = await resolveArchiveSourcePath(params.archivePath);
  if (!archivePathResult.ok) {
    return archivePathResult;
  }
  const archivePath = archivePathResult.path;
  return await withTempDir("genosos-hook-", async (tmpDir) => {
    const extractDir = path.join(tmpDir, "extract");
    await fs.mkdir(extractDir, { recursive: true });
    logger.info?.(`Extracting ${archivePath}\u2026`);
    try {
      await extractArchive({ archivePath, destDir: extractDir, timeoutMs, logger });
    } catch (err) {
      return { ok: false, error: `failed to extract archive: ${String(err)}` };
    }
    let rootDir = "";
    try {
      rootDir = await resolvePackedRootDir(extractDir);
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    const manifestPath = path.join(rootDir, "package.json");
    if (await fileExists(manifestPath)) {
      return await installHookPackageFromDir({
        packageDir: rootDir,
        hooksDir: params.hooksDir,
        timeoutMs,
        logger,
        mode: params.mode,
        dryRun: params.dryRun,
        expectedHookPackId: params.expectedHookPackId,
      });
    }
    return await installHookFromDir({
      hookDir: rootDir,
      hooksDir: params.hooksDir,
      logger,
      mode: params.mode,
      dryRun: params.dryRun,
      expectedHookPackId: params.expectedHookPackId,
    });
  });
}
export async function installHooksFromNpmSpec(params) {
  const { logger, timeoutMs, mode, dryRun } = resolveTimedHookInstallModeOptions(params);
  const expectedHookPackId = params.expectedHookPackId;
  const spec = params.spec.trim();
  const specError = validateRegistryNpmSpec(spec);
  if (specError) {
    return { ok: false, error: specError };
  }
  return await withTempDir("genosos-hook-pack-", async (tmpDir) => {
    logger.info?.(`Downloading ${spec}\u2026`);
    const packedResult = await packNpmSpecToArchive({
      spec,
      timeoutMs,
      cwd: tmpDir,
    });
    if (!packedResult.ok) {
      return packedResult;
    }
    return await installHooksFromArchive({
      archivePath: packedResult.archivePath,
      hooksDir: params.hooksDir,
      timeoutMs,
      logger,
      mode,
      dryRun,
      expectedHookPackId,
    });
  });
}
export async function installHooksFromPath(params) {
  const resolved = resolveUserPath(params.path);
  if (!(await fileExists(resolved))) {
    return { ok: false, error: `path not found: ${resolved}` };
  }
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    const manifestPath = path.join(resolved, "package.json");
    if (await fileExists(manifestPath)) {
      return await installHookPackageFromDir({
        packageDir: resolved,
        hooksDir: params.hooksDir,
        timeoutMs: params.timeoutMs,
        logger: params.logger,
        mode: params.mode,
        dryRun: params.dryRun,
        expectedHookPackId: params.expectedHookPackId,
      });
    }
    return await installHookFromDir({
      hookDir: resolved,
      hooksDir: params.hooksDir,
      logger: params.logger,
      mode: params.mode,
      dryRun: params.dryRun,
      expectedHookPackId: params.expectedHookPackId,
    });
  }
  if (!resolveArchiveKind(resolved)) {
    return { ok: false, error: `unsupported hook file: ${resolved}` };
  }
  return await installHooksFromArchive({
    archivePath: resolved,
    hooksDir: params.hooksDir,
    timeoutMs: params.timeoutMs,
    logger: params.logger,
    mode: params.mode,
    dryRun: params.dryRun,
    expectedHookPackId: params.expectedHookPackId,
  });
}
