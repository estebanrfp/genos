let addCandidate = function (candidates, value) {
    if (!value) {
      return;
    }
    candidates.add(path.resolve(value));
  },
  summarizeCommandOutput = function (text) {
    const lines = text
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      return;
    }
    const last = lines.at(-1);
    if (!last) {
      return;
    }
    return last.length > 240 ? `${last.slice(0, 239)}\u2026` : last;
  };
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandWithTimeout } from "../process/exec.js";
import { defaultRuntime } from "../runtime.js";
import { resolveGenosOSPackageRoot, resolveGenosOSPackageRootSync } from "./genosos-root.js";
const CONTROL_UI_DIST_PATH_SEGMENTS = ["dist", "control-ui", "index.html"];
export function resolveControlUiDistIndexPathForRoot(root) {
  return path.join(root, ...CONTROL_UI_DIST_PATH_SEGMENTS);
}
export async function resolveControlUiDistIndexHealth(opts = {}) {
  const indexPath = opts.root
    ? resolveControlUiDistIndexPathForRoot(opts.root)
    : await resolveControlUiDistIndexPath({
        argv1: opts.argv1 ?? process.argv[1],
        moduleUrl: opts.moduleUrl,
      });
  return {
    indexPath,
    exists: Boolean(indexPath && fs.existsSync(indexPath)),
  };
}
export function resolveControlUiRepoRoot(argv1 = process.argv[1]) {
  if (!argv1) {
    return null;
  }
  const normalized = path.resolve(argv1);
  const parts = normalized.split(path.sep);
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex !== -1) {
    const root = parts.slice(0, srcIndex).join(path.sep);
    if (fs.existsSync(path.join(root, "ui", "vite.config.js"))) {
      return root;
    }
  }
  let dir = path.dirname(normalized);
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, "package.json")) &&
      fs.existsSync(path.join(dir, "ui", "vite.config.js"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}
export async function resolveControlUiDistIndexPath(argv1OrOpts) {
  const argv1 =
    typeof argv1OrOpts === "string" ? argv1OrOpts : (argv1OrOpts?.argv1 ?? process.argv[1]);
  const moduleUrl = typeof argv1OrOpts === "object" ? argv1OrOpts?.moduleUrl : undefined;
  if (!argv1) {
    return null;
  }
  const normalized = path.resolve(argv1);
  const distDir = path.dirname(normalized);
  if (path.basename(distDir) === "dist") {
    return path.join(distDir, "control-ui", "index.html");
  }
  const packageRoot = await resolveGenosOSPackageRoot({ argv1: normalized, moduleUrl });
  if (packageRoot) {
    return path.join(packageRoot, "dist", "control-ui", "index.html");
  }
  let dir = path.dirname(normalized);
  for (let i = 0; i < 8; i++) {
    const pkgJsonPath = path.join(dir, "package.json");
    const indexPath = path.join(dir, "dist", "control-ui", "index.html");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const raw = fs.readFileSync(pkgJsonPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.name === "genosos") {
          return fs.existsSync(indexPath) ? indexPath : null;
        }
        return null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}
export function resolveControlUiRootOverrideSync(rootOverride) {
  const resolved = path.resolve(rootOverride);
  try {
    const stats = fs.statSync(resolved);
    if (stats.isFile()) {
      return path.basename(resolved) === "index.html" ? path.dirname(resolved) : null;
    }
    if (stats.isDirectory()) {
      const indexPath = path.join(resolved, "index.html");
      return fs.existsSync(indexPath) ? resolved : null;
    }
  } catch {
    return null;
  }
  return null;
}
export function resolveControlUiRootSync(opts = {}) {
  const candidates = new Set();
  const argv1 = opts.argv1 ?? process.argv[1];
  const cwd = opts.cwd ?? process.cwd();
  const moduleDir = opts.moduleUrl ? path.dirname(fileURLToPath(opts.moduleUrl)) : null;
  const argv1Dir = argv1 ? path.dirname(path.resolve(argv1)) : null;
  const execDir = (() => {
    try {
      const execPath = opts.execPath ?? process.execPath;
      return path.dirname(fs.realpathSync(execPath));
    } catch {
      return null;
    }
  })();
  const packageRoot = resolveGenosOSPackageRootSync({
    argv1,
    moduleUrl: opts.moduleUrl,
    cwd,
  });
  addCandidate(candidates, execDir ? path.join(execDir, "control-ui") : null);
  if (moduleDir) {
    addCandidate(candidates, path.join(moduleDir, "control-ui"));
    addCandidate(candidates, path.join(moduleDir, "../control-ui"));
    addCandidate(candidates, path.join(moduleDir, "../../dist/control-ui"));
  }
  if (argv1Dir) {
    addCandidate(candidates, path.join(argv1Dir, "dist", "control-ui"));
    addCandidate(candidates, path.join(argv1Dir, "control-ui"));
  }
  if (packageRoot) {
    addCandidate(candidates, path.join(packageRoot, "dist", "control-ui"));
  }
  addCandidate(candidates, path.join(cwd, "dist", "control-ui"));
  for (const dir of candidates) {
    const indexPath = path.join(dir, "index.html");
    if (fs.existsSync(indexPath)) {
      return dir;
    }
  }
  return null;
}
export async function ensureControlUiAssetsBuilt(runtime = defaultRuntime, opts) {
  const health = await resolveControlUiDistIndexHealth({ argv1: process.argv[1] });
  const indexFromDist = health.indexPath;
  if (health.exists) {
    return { ok: true, built: false };
  }
  const repoRoot = resolveControlUiRepoRoot(process.argv[1]);
  if (!repoRoot) {
    const hint = indexFromDist
      ? `Missing Control UI assets at ${indexFromDist}`
      : "Missing Control UI assets";
    return {
      ok: false,
      built: false,
      message: `${hint}. Build them with \`pnpm ui:build\` (auto-installs UI deps).`,
    };
  }
  const indexPath = resolveControlUiDistIndexPathForRoot(repoRoot);
  if (fs.existsSync(indexPath)) {
    return { ok: true, built: false };
  }
  const uiScript = path.join(repoRoot, "scripts", "ui.js");
  if (!fs.existsSync(uiScript)) {
    return {
      ok: false,
      built: false,
      message: `Control UI assets missing but ${uiScript} is unavailable.`,
    };
  }
  runtime.log("Control UI assets missing; building (ui:build, auto-installs UI deps)\u2026");
  const build = await runCommandWithTimeout([process.execPath, uiScript, "build"], {
    cwd: repoRoot,
    timeoutMs: opts?.timeoutMs ?? 600000,
  });
  if (build.code !== 0) {
    return {
      ok: false,
      built: false,
      message: `Control UI build failed: ${summarizeCommandOutput(build.stderr) ?? `exit ${build.code}`}`,
    };
  }
  if (!fs.existsSync(indexPath)) {
    return {
      ok: false,
      built: true,
      message: `Control UI build completed but ${indexPath} is still missing.`,
    };
  }
  return { ok: true, built: true };
}
