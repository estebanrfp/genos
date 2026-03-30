let resolvePluginRoot = function () {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..");
};
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMatrixRuntime } from "../runtime.js";
const MATRIX_SDK_PACKAGE = "@vector-im/matrix-bot-sdk";
export function isMatrixSdkAvailable() {
  try {
    const req = createRequire(import.meta.url);
    req.resolve(MATRIX_SDK_PACKAGE);
    return true;
  } catch {
    return false;
  }
}
export async function ensureMatrixSdkInstalled(params) {
  if (isMatrixSdkAvailable()) {
    return;
  }
  const confirm = params.confirm;
  if (confirm) {
    const ok = await confirm("Matrix requires @vector-im/matrix-bot-sdk. Install now?");
    if (!ok) {
      throw new Error("Matrix requires @vector-im/matrix-bot-sdk (install dependencies first).");
    }
  }
  const root = resolvePluginRoot();
  const command = fs.existsSync(path.join(root, "pnpm-lock.yaml"))
    ? ["pnpm", "install"]
    : ["npm", "install", "--omit=dev", "--silent"];
  params.runtime.log?.(`matrix: installing dependencies via ${command[0]} (${root})\u2026`);
  const result = await getMatrixRuntime().system.runCommandWithTimeout(command, {
    cwd: root,
    timeoutMs: 300000,
    env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || "Matrix dependency install failed.",
    );
  }
  if (!isMatrixSdkAvailable()) {
    throw new Error(
      "Matrix dependency install completed but @vector-im/matrix-bot-sdk is still missing.",
    );
  }
}
