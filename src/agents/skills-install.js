let withWarnings = function (result, warnings) {
    if (warnings.length === 0) {
      return result;
    }
    return {
      ...result,
      warnings: warnings.slice(),
    };
  },
  formatScanFindingDetail = function (rootDir, finding) {
    const relativePath = path.relative(rootDir, finding.file);
    const filePath =
      relativePath && relativePath !== "." && !relativePath.startsWith("..")
        ? relativePath
        : path.basename(finding.file);
    return `${finding.message} (${filePath}:${finding.line})`;
  },
  resolveInstallId = function (spec, index) {
    return (spec.id ?? `${spec.kind}-${index}`).trim();
  },
  findInstallSpec = function (entry, installId) {
    const specs = entry.metadata?.install ?? [];
    for (const [index, spec] of specs.entries()) {
      if (resolveInstallId(spec, index) === installId) {
        return spec;
      }
    }
    return;
  },
  buildNodeInstallCommand = function (packageName, prefs) {
    switch (prefs.nodeManager) {
      case "pnpm":
        return ["pnpm", "add", "-g", "--ignore-scripts", packageName];
      case "yarn":
        return ["yarn", "global", "add", "--ignore-scripts", packageName];
      case "bun":
        return ["bun", "add", "-g", "--ignore-scripts", packageName];
      default:
        return ["npm", "install", "-g", "--ignore-scripts", packageName];
    }
  },
  buildInstallCommand = function (spec, prefs) {
    switch (spec.kind) {
      case "brew": {
        if (!spec.formula) {
          return { argv: null, error: "missing brew formula" };
        }
        return { argv: ["brew", "install", spec.formula] };
      }
      case "node": {
        if (!spec.package) {
          return { argv: null, error: "missing node package" };
        }
        return {
          argv: buildNodeInstallCommand(spec.package, prefs),
        };
      }
      case "go": {
        if (!spec.module) {
          return { argv: null, error: "missing go module" };
        }
        return { argv: ["go", "install", spec.module] };
      }
      case "uv": {
        if (!spec.package) {
          return { argv: null, error: "missing uv package" };
        }
        return { argv: ["uv", "tool", "install", spec.package] };
      }
      case "download": {
        return { argv: null, error: "download install handled separately" };
      }
      default:
        return { argv: null, error: "unsupported installer" };
    }
  },
  createInstallFailure = function (params) {
    return {
      ok: false,
      message: params.message,
      stdout: params.stdout?.trim() ?? "",
      stderr: params.stderr?.trim() ?? "",
      code: params.code ?? null,
    };
  },
  createInstallSuccess = function (result) {
    return {
      ok: true,
      message: "Installed",
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      code: result.code,
    };
  },
  resolveBrewMissingFailure = function (spec) {
    const formula = spec.formula ?? "this package";
    const hint =
      process.platform === "linux"
        ? `Homebrew is not installed. Install it from https://brew.sh or install "${formula}" manually using your system package manager (e.g. apt, dnf, pacman).`
        : "Homebrew is not installed. Install it from https://brew.sh";
    return createInstallFailure({ message: `brew not installed \u2014 ${hint}` });
  };
import fs from "node:fs";
import path from "node:path";
import { resolveBrewExecutable } from "../infra/brew.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { scanDirectoryWithSummary } from "../security/skill-scanner.js";
import { resolveUserPath } from "../utils.js";
import { installDownloadSpec } from "./skills-install-download.js";
import { formatInstallFailureMessage } from "./skills-install-output.js";
import { hasBinary, loadWorkspaceSkillEntries, resolveSkillsInstallPreferences } from "./skills.js";
async function collectSkillInstallScanWarnings(entry) {
  const warnings = [];
  const skillName = entry.skill.name;
  const skillDir = path.resolve(entry.skill.baseDir);
  try {
    const summary = await scanDirectoryWithSummary(skillDir);
    if (summary.critical > 0) {
      const criticalDetails = summary.findings
        .filter((finding) => finding.severity === "critical")
        .map((finding) => formatScanFindingDetail(skillDir, finding))
        .join("; ");
      warnings.push(
        `WARNING: Skill "${skillName}" contains dangerous code patterns: ${criticalDetails}`,
      );
    } else if (summary.warn > 0) {
      warnings.push(
        `Skill "${skillName}" has ${summary.warn} suspicious code pattern(s). Run "genosos security audit --deep" for details.`,
      );
    }
  } catch (err) {
    warnings.push(
      `Skill "${skillName}" code safety scan failed (${String(err)}). Installation continues; run "genosos security audit --deep" after install.`,
    );
  }
  return warnings;
}
async function resolveBrewBinDir(timeoutMs, brewExe) {
  const exe = brewExe ?? (hasBinary("brew") ? "brew" : resolveBrewExecutable());
  if (!exe) {
    return;
  }
  const prefixResult = await runCommandWithTimeout([exe, "--prefix"], {
    timeoutMs: Math.min(timeoutMs, 30000),
  });
  if (prefixResult.code === 0) {
    const prefix = prefixResult.stdout.trim();
    if (prefix) {
      return path.join(prefix, "bin");
    }
  }
  const envPrefix = process.env.HOMEBREW_PREFIX?.trim();
  if (envPrefix) {
    return path.join(envPrefix, "bin");
  }
  for (const candidate of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return;
}
async function runCommandSafely(argv, optionsOrTimeout) {
  try {
    const result = await runCommandWithTimeout(argv, optionsOrTimeout);
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    return {
      code: null,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}
async function runBestEffortCommand(argv, optionsOrTimeout) {
  await runCommandSafely(argv, optionsOrTimeout);
}
async function ensureUvInstalled(params) {
  if (params.spec.kind !== "uv" || hasBinary("uv")) {
    return;
  }
  if (!params.brewExe) {
    return createInstallFailure({
      message:
        "uv not installed \u2014 install manually: https://docs.astral.sh/uv/getting-started/installation/",
    });
  }
  const brewResult = await runCommandSafely([params.brewExe, "install", "uv"], {
    timeoutMs: params.timeoutMs,
  });
  if (brewResult.code === 0) {
    return;
  }
  return createInstallFailure({
    message: "Failed to install uv (brew)",
    ...brewResult,
  });
}
async function installGoViaApt(timeoutMs) {
  const aptInstallArgv = ["apt-get", "install", "-y", "golang-go"];
  const aptUpdateArgv = ["apt-get", "update", "-qq"];
  const aptFailureMessage =
    "go not installed \u2014 automatic install via apt failed. Install manually: https://go.dev/doc/install";
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (isRoot) {
    await runBestEffortCommand(aptUpdateArgv, { timeoutMs });
    const aptResult = await runCommandSafely(aptInstallArgv, { timeoutMs });
    if (aptResult.code === 0) {
      return;
    }
    return createInstallFailure({
      message: aptFailureMessage,
      ...aptResult,
    });
  }
  if (!hasBinary("sudo")) {
    return createInstallFailure({
      message:
        "go not installed \u2014 apt-get is available but sudo is not installed. Install manually: https://go.dev/doc/install",
    });
  }
  const sudoCheck = await runCommandSafely(["sudo", "-n", "true"], {
    timeoutMs: 5000,
  });
  if (sudoCheck.code !== 0) {
    return createInstallFailure({
      message:
        "go not installed \u2014 apt-get is available but sudo is not usable (missing or requires a password). Install manually: https://go.dev/doc/install",
      ...sudoCheck,
    });
  }
  await runBestEffortCommand(["sudo", ...aptUpdateArgv], { timeoutMs });
  const aptResult = await runCommandSafely(["sudo", ...aptInstallArgv], {
    timeoutMs,
  });
  if (aptResult.code === 0) {
    return;
  }
  return createInstallFailure({
    message: aptFailureMessage,
    ...aptResult,
  });
}
async function ensureGoInstalled(params) {
  if (params.spec.kind !== "go" || hasBinary("go")) {
    return;
  }
  if (params.brewExe) {
    const brewResult = await runCommandSafely([params.brewExe, "install", "go"], {
      timeoutMs: params.timeoutMs,
    });
    if (brewResult.code === 0) {
      return;
    }
    return createInstallFailure({
      message: "Failed to install go (brew)",
      ...brewResult,
    });
  }
  if (hasBinary("apt-get")) {
    return installGoViaApt(params.timeoutMs);
  }
  return createInstallFailure({
    message: "go not installed \u2014 install manually: https://go.dev/doc/install",
  });
}
async function executeInstallCommand(params) {
  if (!params.argv || params.argv.length === 0) {
    return createInstallFailure({ message: "invalid install command" });
  }
  const result = await runCommandSafely(params.argv, {
    timeoutMs: params.timeoutMs,
    env: params.env,
  });
  if (result.code === 0) {
    return createInstallSuccess(result);
  }
  return createInstallFailure({
    message: formatInstallFailureMessage(result),
    ...result,
  });
}
export async function installSkill(params) {
  const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 300000, 1000), 900000);
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const entries = loadWorkspaceSkillEntries(workspaceDir);
  const entry = entries.find((item) => item.skill.name === params.skillName);
  if (!entry) {
    return {
      ok: false,
      message: `Skill not found: ${params.skillName}`,
      stdout: "",
      stderr: "",
      code: null,
    };
  }
  const spec = findInstallSpec(entry, params.installId);
  const warnings = await collectSkillInstallScanWarnings(entry);
  if (!spec) {
    return withWarnings(
      {
        ok: false,
        message: `Installer not found: ${params.installId}`,
        stdout: "",
        stderr: "",
        code: null,
      },
      warnings,
    );
  }
  if (spec.kind === "download") {
    const downloadResult = await installDownloadSpec({ entry, spec, timeoutMs });
    return withWarnings(downloadResult, warnings);
  }
  const prefs = resolveSkillsInstallPreferences(params.config);
  const command = buildInstallCommand(spec, prefs);
  if (command.error) {
    return withWarnings(
      {
        ok: false,
        message: command.error,
        stdout: "",
        stderr: "",
        code: null,
      },
      warnings,
    );
  }
  const brewExe = hasBinary("brew") ? "brew" : resolveBrewExecutable();
  if (spec.kind === "brew" && !brewExe) {
    return withWarnings(resolveBrewMissingFailure(spec), warnings);
  }
  const uvInstallFailure = await ensureUvInstalled({ spec, brewExe, timeoutMs });
  if (uvInstallFailure) {
    return withWarnings(uvInstallFailure, warnings);
  }
  const goInstallFailure = await ensureGoInstalled({ spec, brewExe, timeoutMs });
  if (goInstallFailure) {
    return withWarnings(goInstallFailure, warnings);
  }
  const argv = command.argv ? [...command.argv] : null;
  if (spec.kind === "brew" && brewExe && argv?.[0] === "brew") {
    argv[0] = brewExe;
  }
  let env;
  if (spec.kind === "go" && brewExe) {
    const brewBin = await resolveBrewBinDir(timeoutMs, brewExe);
    if (brewBin) {
      env = { GOBIN: brewBin };
    }
  }
  return withWarnings(await executeInstallCommand({ argv, timeoutMs, env }), warnings);
}
