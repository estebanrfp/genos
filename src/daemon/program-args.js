let isNodeRuntime = function (execPath) {
    const base = path.basename(execPath).toLowerCase();
    return base === "node" || base === "node.exe";
  },
  isBunRuntime = function (execPath) {
    const base = path.basename(execPath).toLowerCase();
    return base === "bun" || base === "bun.exe";
  },
  buildDistCandidates = function (...inputs) {
    const candidates = [];
    const seen = new Set();
    for (const inputPath of inputs) {
      if (!inputPath) {
        continue;
      }
      const baseDir = path.dirname(inputPath);
      appendDistCandidates(candidates, seen, path.resolve(baseDir, ".."));
      appendDistCandidates(candidates, seen, baseDir);
      appendNodeModulesBinCandidates(candidates, seen, inputPath);
    }
    return candidates;
  },
  appendDistCandidates = function (candidates, seen, baseDir) {
    const distDir = path.resolve(baseDir, "dist");
    const distEntries = [
      path.join(distDir, "index.js"),
      path.join(distDir, "index.mjs"),
      path.join(distDir, "entry.js"),
      path.join(distDir, "entry.mjs"),
    ];
    for (const entry of distEntries) {
      if (seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      candidates.push(entry);
    }
  },
  appendNodeModulesBinCandidates = function (candidates, seen, inputPath) {
    const parts = inputPath.split(path.sep);
    const binIndex = parts.lastIndexOf(".bin");
    if (binIndex <= 0) {
      return;
    }
    if (parts[binIndex - 1] !== "node_modules") {
      return;
    }
    const binName = path.basename(inputPath);
    const nodeModulesDir = parts.slice(0, binIndex).join(path.sep);
    const packageRoot = path.join(nodeModulesDir, binName);
    appendDistCandidates(candidates, seen, packageRoot);
  },
  resolveRepoRootForDev = function () {
    const argv1 = process.argv[1];
    if (!argv1) {
      throw new Error("Unable to resolve repo root");
    }
    const normalized = path.resolve(argv1);
    const parts = normalized.split(path.sep);
    const srcIndex = parts.lastIndexOf("src");
    if (srcIndex === -1) {
      throw new Error("Dev mode requires running from repo (src/index.ts)");
    }
    return parts.slice(0, srcIndex).join(path.sep);
  };
import fs from "node:fs/promises";
import path from "node:path";
async function resolveCliEntrypointPathForService() {
  const argv1 = process.argv[1];
  if (!argv1) {
    throw new Error("Unable to resolve CLI entrypoint path");
  }
  const normalized = path.resolve(argv1);
  const resolvedPath = await resolveRealpathSafe(normalized);
  const looksLikeDist = /[/\\]dist[/\\].+\.(cjs|js|mjs)$/.test(resolvedPath);
  if (looksLikeDist) {
    await fs.access(resolvedPath);
    const normalizedLooksLikeDist = /[/\\]dist[/\\].+\.(cjs|js|mjs)$/.test(normalized);
    if (normalizedLooksLikeDist && normalized !== resolvedPath) {
      try {
        await fs.access(normalized);
        return normalized;
      } catch {}
    }
    return resolvedPath;
  }
  const distCandidates = buildDistCandidates(resolvedPath, normalized);
  for (const candidate of distCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(
    `Cannot find built CLI at ${distCandidates.join(" or ")}. Run "pnpm build" first, or use dev mode.`,
  );
}
async function resolveRealpathSafe(inputPath) {
  try {
    return await fs.realpath(inputPath);
  } catch {
    return inputPath;
  }
}
async function resolveBunPath() {
  const bunPath = await resolveBinaryPath("bun");
  return bunPath;
}
async function resolveNodePath() {
  const nodePath = await resolveBinaryPath("node");
  return nodePath;
}
async function resolveBinaryPath(binary) {
  const { execSync } = await import("node:child_process");
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const output = execSync(`${cmd} ${binary}`, { encoding: "utf8" }).trim();
    const resolved = output.split(/\r?\n/)[0]?.trim();
    if (!resolved) {
      throw new Error("empty");
    }
    await fs.access(resolved);
    return resolved;
  } catch {
    if (binary === "bun") {
      throw new Error("Bun not found in PATH. Install bun: https://bun.sh");
    }
    throw new Error("Node not found in PATH. Install Node 22+.");
  }
}
async function resolveCliProgramArguments(params) {
  const execPath = process.execPath;
  const runtime = params.runtime ?? "auto";
  if (runtime === "node") {
    const nodePath =
      params.nodePath ?? (isNodeRuntime(execPath) ? execPath : await resolveNodePath());
    const cliEntrypointPath = await resolveCliEntrypointPathForService();
    return {
      programArguments: [nodePath, cliEntrypointPath, ...params.args],
    };
  }
  if (runtime === "bun") {
    if (params.dev) {
      const repoRoot = resolveRepoRootForDev();
      const devCliPath = path.join(repoRoot, "src", "index.js");
      await fs.access(devCliPath);
      const bunPath = isBunRuntime(execPath) ? execPath : await resolveBunPath();
      return {
        programArguments: [bunPath, devCliPath, ...params.args],
        workingDirectory: repoRoot,
      };
    }
    const bunPath = isBunRuntime(execPath) ? execPath : await resolveBunPath();
    const cliEntrypointPath = await resolveCliEntrypointPathForService();
    return {
      programArguments: [bunPath, cliEntrypointPath, ...params.args],
    };
  }
  if (!params.dev) {
    try {
      const cliEntrypointPath = await resolveCliEntrypointPathForService();
      return {
        programArguments: [execPath, cliEntrypointPath, ...params.args],
      };
    } catch (error) {
      if (!isNodeRuntime(execPath)) {
        return { programArguments: [execPath, ...params.args] };
      }
      throw error;
    }
  }
  const repoRoot = resolveRepoRootForDev();
  const devCliPath = path.join(repoRoot, "src", "index.js");
  await fs.access(devCliPath);
  if (isBunRuntime(execPath)) {
    return {
      programArguments: [execPath, devCliPath, ...params.args],
      workingDirectory: repoRoot,
    };
  }
  const bunPath = await resolveBunPath();
  return {
    programArguments: [bunPath, devCliPath, ...params.args],
    workingDirectory: repoRoot,
  };
}
export async function resolveGatewayProgramArguments(params) {
  const gatewayArgs = ["gateway", "--port", String(params.port)];
  return resolveCliProgramArguments({
    args: gatewayArgs,
    dev: params.dev,
    runtime: params.runtime,
    nodePath: params.nodePath,
  });
}
export async function resolveNodeProgramArguments(params) {
  const args = ["node", "run", "--host", params.host, "--port", String(params.port)];
  if (params.tls || params.tlsFingerprint) {
    args.push("--tls");
  }
  if (params.tlsFingerprint) {
    args.push("--tls-fingerprint", params.tlsFingerprint);
  }
  if (params.nodeId) {
    args.push("--node-id", params.nodeId);
  }
  if (params.displayName) {
    args.push("--display-name", params.displayName);
  }
  return resolveCliProgramArguments({
    args,
    dev: params.dev,
    runtime: params.runtime,
    nodePath: params.nodePath,
  });
}
