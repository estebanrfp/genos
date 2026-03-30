let safeFileName = function (input) {
    return safeDirName(input);
  },
  validatePluginId = function (pluginId) {
    if (!pluginId) {
      return "invalid plugin name: missing";
    }
    if (pluginId === "." || pluginId === "..") {
      return "invalid plugin name: reserved path segment";
    }
    if (pluginId.includes("/") || pluginId.includes("\\")) {
      return "invalid plugin name: path separators not allowed";
    }
    return null;
  },
  resolvePluginInstallModeOptions = function (params) {
    return {
      logger: params.logger ?? defaultLogger,
      mode: params.mode ?? "install",
      dryRun: params.dryRun ?? false,
    };
  },
  resolveTimedPluginInstallModeOptions = function (params) {
    return {
      ...resolvePluginInstallModeOptions(params),
      timeoutMs: params.timeoutMs ?? 120000,
    };
  },
  buildFileInstallResult = function (pluginId, targetFile) {
    return {
      ok: true,
      pluginId,
      targetDir: targetFile,
      manifestName: undefined,
      version: undefined,
      extensions: [path.basename(targetFile)],
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
import {
  resolveSafeInstallDir,
  safeDirName,
  unscopedPackageName,
} from "../infra/install-safe-path.js";
import {
  packNpmSpecToArchive,
  resolveArchiveSourcePath,
  withTempDir,
} from "../infra/install-source-utils.js";
import { validateRegistryNpmSpec } from "../infra/npm-registry-spec.js";
import { extensionUsesSkippedScannerPath, isPathInside } from "../security/scan-paths.js";
import * as skillScanner from "../security/skill-scanner.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
const defaultLogger = {};
async function ensureGenosOSExtensions(manifest) {
  const extensions = manifest[MANIFEST_KEY]?.extensions;
  if (!Array.isArray(extensions)) {
    throw new Error("package.json missing genosos.extensions");
  }
  const list = extensions.map((e) => (typeof e === "string" ? e.trim() : "")).filter(Boolean);
  if (list.length === 0) {
    throw new Error("package.json genosos.extensions is empty");
  }
  return list;
}
export function resolvePluginInstallDir(pluginId, extensionsDir) {
  const extensionsBase = extensionsDir
    ? resolveUserPath(extensionsDir)
    : path.join(CONFIG_DIR, "extensions");
  const pluginIdError = validatePluginId(pluginId);
  if (pluginIdError) {
    throw new Error(pluginIdError);
  }
  const targetDirResult = resolveSafeInstallDir({
    baseDir: extensionsBase,
    id: pluginId,
    invalidNameMessage: "invalid plugin name: path traversal detected",
  });
  if (!targetDirResult.ok) {
    throw new Error(targetDirResult.error);
  }
  return targetDirResult.path;
}
async function installPluginFromPackageDir(params) {
  const { logger, timeoutMs, mode, dryRun } = resolveTimedPluginInstallModeOptions(params);
  const manifestPath = path.join(params.packageDir, "package.json");
  if (!(await fileExists(manifestPath))) {
    return { ok: false, error: "extracted package missing package.json" };
  }
  let manifest;
  try {
    manifest = await readJsonFile(manifestPath);
  } catch (err) {
    return { ok: false, error: `invalid package.json: ${String(err)}` };
  }
  let extensions;
  try {
    extensions = await ensureGenosOSExtensions(manifest);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  const pkgName = typeof manifest.name === "string" ? manifest.name : "";
  const pluginId = pkgName ? unscopedPackageName(pkgName) : "plugin";
  const pluginIdError = validatePluginId(pluginId);
  if (pluginIdError) {
    return { ok: false, error: pluginIdError };
  }
  if (params.expectedPluginId && params.expectedPluginId !== pluginId) {
    return {
      ok: false,
      error: `plugin id mismatch: expected ${params.expectedPluginId}, got ${pluginId}`,
    };
  }
  const packageDir = path.resolve(params.packageDir);
  const forcedScanEntries = [];
  for (const entry of extensions) {
    const resolvedEntry = path.resolve(packageDir, entry);
    if (!isPathInside(packageDir, resolvedEntry)) {
      logger.warn?.(`extension entry escapes plugin directory and will not be scanned: ${entry}`);
      continue;
    }
    if (extensionUsesSkippedScannerPath(entry)) {
      logger.warn?.(
        `extension entry is in a hidden/node_modules path and will receive targeted scan coverage: ${entry}`,
      );
    }
    forcedScanEntries.push(resolvedEntry);
  }
  try {
    const scanSummary = await skillScanner.scanDirectoryWithSummary(params.packageDir, {
      includeFiles: forcedScanEntries,
    });
    if (scanSummary.critical > 0) {
      const criticalDetails = scanSummary.findings
        .filter((f) => f.severity === "critical")
        .map((f) => `${f.message} (${f.file}:${f.line})`)
        .join("; ");
      logger.warn?.(
        `WARNING: Plugin "${pluginId}" contains dangerous code patterns: ${criticalDetails}`,
      );
    } else if (scanSummary.warn > 0) {
      logger.warn?.(
        `Plugin "${pluginId}" has ${scanSummary.warn} suspicious code pattern(s). Run "genosos security audit --deep" for details.`,
      );
    }
  } catch (err) {
    logger.warn?.(
      `Plugin "${pluginId}" code safety scan failed (${String(err)}). Installation continues; run "genosos security audit --deep" after install.`,
    );
  }
  const extensionsDir = params.extensionsDir
    ? resolveUserPath(params.extensionsDir)
    : path.join(CONFIG_DIR, "extensions");
  await fs.mkdir(extensionsDir, { recursive: true });
  const targetDirResult = resolveSafeInstallDir({
    baseDir: extensionsDir,
    id: pluginId,
    invalidNameMessage: "invalid plugin name: path traversal detected",
  });
  if (!targetDirResult.ok) {
    return { ok: false, error: targetDirResult.error };
  }
  const targetDir = targetDirResult.path;
  if (mode === "install" && (await fileExists(targetDir))) {
    return {
      ok: false,
      error: `plugin already exists: ${targetDir} (delete it first)`,
    };
  }
  if (dryRun) {
    return {
      ok: true,
      pluginId,
      targetDir,
      manifestName: pkgName || undefined,
      version: typeof manifest.version === "string" ? manifest.version : undefined,
      extensions,
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
    copyErrorPrefix: "failed to copy plugin",
    hasDeps,
    depsLogMessage: "Installing plugin dependencies\u2026",
    afterCopy: async () => {
      for (const entry of extensions) {
        const resolvedEntry = path.resolve(targetDir, entry);
        if (!isPathInside(targetDir, resolvedEntry)) {
          logger.warn?.(`extension entry escapes plugin directory: ${entry}`);
          continue;
        }
        if (!(await fileExists(resolvedEntry))) {
          logger.warn?.(`extension entry not found: ${entry}`);
        }
      }
    },
  });
  if (!installRes.ok) {
    return installRes;
  }
  return {
    ok: true,
    pluginId,
    targetDir,
    manifestName: pkgName || undefined,
    version: typeof manifest.version === "string" ? manifest.version : undefined,
    extensions,
  };
}
export async function installPluginFromArchive(params) {
  const logger = params.logger ?? defaultLogger;
  const timeoutMs = params.timeoutMs ?? 120000;
  const mode = params.mode ?? "install";
  const archivePathResult = await resolveArchiveSourcePath(params.archivePath);
  if (!archivePathResult.ok) {
    return archivePathResult;
  }
  const archivePath = archivePathResult.path;
  return await withTempDir("genosos-plugin-", async (tmpDir) => {
    const extractDir = path.join(tmpDir, "extract");
    await fs.mkdir(extractDir, { recursive: true });
    logger.info?.(`Extracting ${archivePath}\u2026`);
    try {
      await extractArchive({
        archivePath,
        destDir: extractDir,
        timeoutMs,
        logger,
      });
    } catch (err) {
      return { ok: false, error: `failed to extract archive: ${String(err)}` };
    }
    let packageDir = "";
    try {
      packageDir = await resolvePackedRootDir(extractDir);
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    return await installPluginFromPackageDir({
      packageDir,
      extensionsDir: params.extensionsDir,
      timeoutMs,
      logger,
      mode,
      dryRun: params.dryRun,
      expectedPluginId: params.expectedPluginId,
    });
  });
}
export async function installPluginFromDir(params) {
  const dirPath = resolveUserPath(params.dirPath);
  if (!(await fileExists(dirPath))) {
    return { ok: false, error: `directory not found: ${dirPath}` };
  }
  const stat = await fs.stat(dirPath);
  if (!stat.isDirectory()) {
    return { ok: false, error: `not a directory: ${dirPath}` };
  }
  return await installPluginFromPackageDir({
    packageDir: dirPath,
    extensionsDir: params.extensionsDir,
    timeoutMs: params.timeoutMs,
    logger: params.logger,
    mode: params.mode,
    dryRun: params.dryRun,
    expectedPluginId: params.expectedPluginId,
  });
}
export async function installPluginFromFile(params) {
  const { logger, mode, dryRun } = resolvePluginInstallModeOptions(params);
  const filePath = resolveUserPath(params.filePath);
  if (!(await fileExists(filePath))) {
    return { ok: false, error: `file not found: ${filePath}` };
  }
  const extensionsDir = params.extensionsDir
    ? resolveUserPath(params.extensionsDir)
    : path.join(CONFIG_DIR, "extensions");
  await fs.mkdir(extensionsDir, { recursive: true });
  const base = path.basename(filePath, path.extname(filePath));
  const pluginId = base || "plugin";
  const pluginIdError = validatePluginId(pluginId);
  if (pluginIdError) {
    return { ok: false, error: pluginIdError };
  }
  const targetFile = path.join(extensionsDir, `${safeFileName(pluginId)}${path.extname(filePath)}`);
  if (mode === "install" && (await fileExists(targetFile))) {
    return { ok: false, error: `plugin already exists: ${targetFile} (delete it first)` };
  }
  if (dryRun) {
    return buildFileInstallResult(pluginId, targetFile);
  }
  logger.info?.(`Installing to ${targetFile}\u2026`);
  await fs.copyFile(filePath, targetFile);
  return buildFileInstallResult(pluginId, targetFile);
}
export async function installPluginFromNpmSpec(params) {
  const { logger, timeoutMs, mode, dryRun } = resolveTimedPluginInstallModeOptions(params);
  const expectedPluginId = params.expectedPluginId;
  const spec = params.spec.trim();
  const specError = validateRegistryNpmSpec(spec);
  if (specError) {
    return { ok: false, error: specError };
  }
  return await withTempDir("genosos-npm-pack-", async (tmpDir) => {
    logger.info?.(`Downloading ${spec}\u2026`);
    const packedResult = await packNpmSpecToArchive({
      spec,
      timeoutMs,
      cwd: tmpDir,
    });
    if (!packedResult.ok) {
      return packedResult;
    }
    return await installPluginFromArchive({
      archivePath: packedResult.archivePath,
      extensionsDir: params.extensionsDir,
      timeoutMs,
      logger,
      mode,
      dryRun,
      expectedPluginId,
    });
  });
}
export async function installPluginFromPath(params) {
  const resolved = resolveUserPath(params.path);
  if (!(await fileExists(resolved))) {
    return { ok: false, error: `path not found: ${resolved}` };
  }
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    return await installPluginFromDir({
      dirPath: resolved,
      extensionsDir: params.extensionsDir,
      timeoutMs: params.timeoutMs,
      logger: params.logger,
      mode: params.mode,
      dryRun: params.dryRun,
      expectedPluginId: params.expectedPluginId,
    });
  }
  const archiveKind = resolveArchiveKind(resolved);
  if (archiveKind) {
    return await installPluginFromArchive({
      archivePath: resolved,
      extensionsDir: params.extensionsDir,
      timeoutMs: params.timeoutMs,
      logger: params.logger,
      mode: params.mode,
      dryRun: params.dryRun,
      expectedPluginId: params.expectedPluginId,
    });
  }
  return await installPluginFromFile({
    filePath: resolved,
    extensionsDir: params.extensionsDir,
    logger: params.logger,
    mode: params.mode,
    dryRun: params.dryRun,
  });
}
