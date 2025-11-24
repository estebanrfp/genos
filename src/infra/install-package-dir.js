import fs from "node:fs/promises";
import { runCommandWithTimeout } from "../process/exec.js";
import { fileExists } from "./archive.js";
export async function installPackageDir(params) {
  params.logger?.info?.(`Installing to ${params.targetDir}\u2026`);
  let backupDir = null;
  if (params.mode === "update" && (await fileExists(params.targetDir))) {
    backupDir = `${params.targetDir}.backup-${Date.now()}`;
    await fs.rename(params.targetDir, backupDir);
  }
  const rollback = async () => {
    if (!backupDir) {
      return;
    }
    await fs.rm(params.targetDir, { recursive: true, force: true }).catch(() => {
      return;
    });
    await fs.rename(backupDir, params.targetDir).catch(() => {
      return;
    });
  };
  try {
    await fs.cp(params.sourceDir, params.targetDir, { recursive: true });
  } catch (err) {
    await rollback();
    return { ok: false, error: `${params.copyErrorPrefix}: ${String(err)}` };
  }
  try {
    await params.afterCopy?.();
  } catch (err) {
    await rollback();
    return { ok: false, error: `post-copy validation failed: ${String(err)}` };
  }
  if (params.hasDeps) {
    params.logger?.info?.(params.depsLogMessage);
    const npmRes = await runCommandWithTimeout(
      ["npm", "install", "--omit=dev", "--silent", "--ignore-scripts"],
      {
        timeoutMs: Math.max(params.timeoutMs, 300000),
        cwd: params.targetDir,
      },
    );
    if (npmRes.code !== 0) {
      await rollback();
      return {
        ok: false,
        error: `npm install failed: ${npmRes.stderr.trim() || npmRes.stdout.trim()}`,
      };
    }
  }
  if (backupDir) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {
      return;
    });
  }
  return { ok: true };
}
