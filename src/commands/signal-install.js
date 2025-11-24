import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { request } from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { extractArchive } from "../infra/archive.js";
import { resolveBrewExecutable } from "../infra/brew.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { CONFIG_DIR } from "../utils.js";
export async function extractSignalCliArchive(archivePath, installRoot, timeoutMs) {
  await extractArchive({ archivePath, destDir: installRoot, timeoutMs });
}
export function looksLikeArchive(name) {
  return name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".zip");
}
export function pickAsset(assets, platform, arch) {
  const withName = assets.filter((asset) => Boolean(asset.name && asset.browser_download_url));
  const archives = withName.filter((a) => looksLikeArchive(a.name.toLowerCase()));
  const byName = (pattern) => archives.find((asset) => pattern.test(asset.name.toLowerCase()));
  if (platform === "linux") {
    if (arch === "x64") {
      return byName(/linux-native/) || byName(/linux/) || archives[0];
    }
    return;
  }
  if (platform === "darwin") {
    return byName(/macos|osx|darwin/) || archives[0];
  }
  if (platform === "win32") {
    return byName(/windows|win/) || archives[0];
  }
  return archives[0];
}
async function downloadToFile(url, dest, maxRedirects = 5) {
  await new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        const location = res.headers.location;
        if (!location || maxRedirects <= 0) {
          reject(new Error("Redirect loop or missing Location header"));
          return;
        }
        const redirectUrl = new URL(location, url).href;
        resolve(downloadToFile(redirectUrl, dest, maxRedirects - 1));
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode ?? "?"} downloading file`));
        return;
      }
      const out = createWriteStream(dest);
      pipeline(res, out).then(resolve).catch(reject);
    });
    req.on("error", reject);
    req.end();
  });
}
async function findSignalCliBinary(root) {
  const candidates = [];
  const enqueue = async (dir, depth) => {
    if (depth > 3) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await enqueue(full, depth + 1);
      } else if (entry.isFile() && entry.name === "signal-cli") {
        candidates.push(full);
      }
    }
  };
  await enqueue(root, 0);
  return candidates[0] ?? null;
}
async function resolveBrewSignalCliPath(brewExe) {
  try {
    const result = await runCommandWithTimeout([brewExe, "--prefix", "signal-cli"], {
      timeoutMs: 1e4,
    });
    if (result.code === 0 && result.stdout.trim()) {
      const prefix = result.stdout.trim();
      const candidate = path.join(prefix, "bin", "signal-cli");
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        return findSignalCliBinary(prefix);
      }
    }
  } catch {}
  return null;
}
async function installSignalCliViaBrew(runtime) {
  const brewExe = resolveBrewExecutable();
  if (!brewExe) {
    return {
      ok: false,
      error: `No native signal-cli build is available for ${process.arch}. Install Homebrew (https://brew.sh) and try again, or install signal-cli manually.`,
    };
  }
  runtime.log(`Installing signal-cli via Homebrew (${brewExe})\u2026`);
  const result = await runCommandWithTimeout([brewExe, "install", "signal-cli"], {
    timeoutMs: 900000,
  });
  if (result.code !== 0) {
    return {
      ok: false,
      error: `brew install signal-cli failed (exit ${result.code}): ${result.stderr.trim().slice(0, 200)}`,
    };
  }
  const cliPath = await resolveBrewSignalCliPath(brewExe);
  if (!cliPath) {
    return {
      ok: false,
      error: "brew install succeeded but signal-cli binary was not found.",
    };
  }
  let version;
  try {
    const vResult = await runCommandWithTimeout([cliPath, "--version"], {
      timeoutMs: 1e4,
    });
    version = vResult.stdout.trim().replace(/^signal-cli\s+/, "") || undefined;
  } catch {}
  return { ok: true, cliPath, version };
}
async function installSignalCliFromRelease(runtime) {
  const apiUrl = "https://api.github.com/repos/AsamK/signal-cli/releases/latest";
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "genosos",
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    return {
      ok: false,
      error: `Failed to fetch release info (${response.status})`,
    };
  }
  const payload = await response.json();
  const version = payload.tag_name?.replace(/^v/, "") ?? "unknown";
  const assets = payload.assets ?? [];
  const asset = pickAsset(assets, process.platform, process.arch);
  if (!asset) {
    return {
      ok: false,
      error: "No compatible release asset found for this platform.",
    };
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-signal-"));
  const archivePath = path.join(tmpDir, asset.name);
  runtime.log(`Downloading signal-cli ${version} (${asset.name})\u2026`);
  await downloadToFile(asset.browser_download_url, archivePath);
  const installRoot = path.join(CONFIG_DIR, "tools", "signal-cli", version);
  await fs.mkdir(installRoot, { recursive: true });
  if (!looksLikeArchive(asset.name.toLowerCase())) {
    return { ok: false, error: `Unsupported archive type: ${asset.name}` };
  }
  try {
    await extractSignalCliArchive(archivePath, installRoot, 60000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to extract ${asset.name}: ${message}`,
    };
  }
  const cliPath = await findSignalCliBinary(installRoot);
  if (!cliPath) {
    return {
      ok: false,
      error: `signal-cli binary not found after extracting ${asset.name}`,
    };
  }
  await fs.chmod(cliPath, 493).catch(() => {});
  return { ok: true, cliPath, version };
}
export async function installSignalCli(runtime) {
  if (process.platform === "win32") {
    return {
      ok: false,
      error: "Signal CLI auto-install is not supported on Windows yet.",
    };
  }
  const hasNativeRelease = process.platform !== "linux" || process.arch === "x64";
  if (hasNativeRelease) {
    return installSignalCliFromRelease(runtime);
  }
  return installSignalCliViaBrew(runtime);
}
