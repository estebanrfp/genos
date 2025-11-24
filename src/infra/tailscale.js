let parsePossiblyNoisyJsonObject = function (stdout) {
    const trimmed = stdout.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    return JSON.parse(trimmed);
  },
  extractExecErrorText = function (err) {
    const errOutput = err;
    const stdout = typeof errOutput.stdout === "string" ? errOutput.stdout : "";
    const stderr = typeof errOutput.stderr === "string" ? errOutput.stderr : "";
    const message = typeof errOutput.message === "string" ? errOutput.message : "";
    const code = typeof errOutput.code === "string" ? errOutput.code : "";
    return { stdout, stderr, message, code };
  },
  isPermissionDeniedError = function (err) {
    const { stdout, stderr, message, code } = extractExecErrorText(err);
    if (code.toUpperCase() === "EACCES") {
      return true;
    }
    const combined = `${stdout}\n${stderr}\n${message}`.toLowerCase();
    return (
      combined.includes("permission denied") ||
      combined.includes("access denied") ||
      combined.includes("operation not permitted") ||
      combined.includes("not permitted") ||
      combined.includes("requires root") ||
      combined.includes("must be run as root") ||
      combined.includes("must be run with sudo") ||
      combined.includes("requires sudo") ||
      combined.includes("need sudo")
    );
  },
  getString = function (value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  },
  readRecord = function (value) {
    return value && typeof value === "object" ? value : null;
  },
  parseWhoisIdentity = function (payload) {
    const userProfile =
      readRecord(payload.UserProfile) ??
      readRecord(payload.userProfile) ??
      readRecord(payload.User);
    const login =
      getString(userProfile?.LoginName) ??
      getString(userProfile?.Login) ??
      getString(userProfile?.login) ??
      getString(payload.LoginName) ??
      getString(payload.login);
    if (!login) {
      return null;
    }
    const name =
      getString(userProfile?.DisplayName) ??
      getString(userProfile?.Name) ??
      getString(userProfile?.displayName) ??
      getString(payload.DisplayName) ??
      getString(payload.name);
    return { login, name };
  },
  readCachedWhois = function (ip, now) {
    const cached = whoisCache.get(ip);
    if (!cached) {
      return;
    }
    if (cached.expiresAt <= now) {
      whoisCache.delete(ip);
      return;
    }
    return cached.value;
  },
  writeCachedWhois = function (ip, value, ttlMs) {
    whoisCache.set(ip, { value, expiresAt: Date.now() + ttlMs });
  };
import { existsSync } from "node:fs";
import { formatCliCommand } from "../cli/command-format.js";
import { promptYesNo } from "../cli/prompt.js";
import { danger, info, logVerbose, shouldLogVerbose, warn } from "../globals.js";
import { runExec } from "../process/exec.js";
import { defaultRuntime } from "../runtime.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
import { ensureBinary } from "./binaries.js";
export async function findTailscaleBinary() {
  const checkBinary = async (path) => {
    if (!path || !existsSync(path)) {
      return false;
    }
    try {
      await Promise.race([
        runExec(path, ["--version"], { timeoutMs: 3000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const { stdout } = await runExec("which", ["tailscale"]);
    const fromPath = stdout.trim();
    if (fromPath && (await checkBinary(fromPath))) {
      return fromPath;
    }
  } catch {}
  const macAppPath = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  if (await checkBinary(macAppPath)) {
    return macAppPath;
  }
  try {
    const { stdout } = await runExec(
      "find",
      [
        "/Applications",
        "-maxdepth",
        "3",
        "-name",
        "Tailscale",
        "-path",
        "*/Tailscale.app/Contents/MacOS/Tailscale",
      ],
      { timeoutMs: 5000 },
    );
    const found = stdout.trim().split("\n")[0];
    if (found && (await checkBinary(found))) {
      return found;
    }
  } catch {}
  try {
    const { stdout } = await runExec("locate", ["Tailscale.app"]);
    const candidates = stdout
      .trim()
      .split("\n")
      .filter((line) => line.includes("/Tailscale.app/Contents/MacOS/Tailscale"));
    for (const candidate of candidates) {
      if (await checkBinary(candidate)) {
        return candidate;
      }
    }
  } catch {}
  return null;
}
export async function getTailnetHostname(exec = runExec, detectedBinary) {
  const candidates = detectedBinary
    ? [detectedBinary]
    : ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  let lastError;
  for (const candidate of candidates) {
    if (candidate.startsWith("/") && !existsSync(candidate)) {
      continue;
    }
    try {
      const { stdout } = await exec(candidate, ["status", "--json"], {
        timeoutMs: 5000,
        maxBuffer: 400000,
      });
      const parsed = stdout ? parsePossiblyNoisyJsonObject(stdout) : {};
      const self =
        typeof parsed.Self === "object" && parsed.Self !== null ? parsed.Self : undefined;
      const dns = typeof self?.DNSName === "string" ? self.DNSName : undefined;
      const ips = Array.isArray(self?.TailscaleIPs) ? (parsed.Self.TailscaleIPs ?? []) : [];
      if (dns && dns.length > 0) {
        return dns.replace(/\.$/, "");
      }
      if (ips.length > 0) {
        return ips[0];
      }
      throw new Error("Could not determine Tailscale DNS or IP");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("Could not determine Tailscale DNS or IP");
}
let cachedTailscaleBinary = null;
export async function getTailscaleBinary() {
  const forcedBinary = process.env.GENOS_TEST_TAILSCALE_BINARY?.trim();
  if (forcedBinary) {
    cachedTailscaleBinary = forcedBinary;
    return forcedBinary;
  }
  if (cachedTailscaleBinary) {
    return cachedTailscaleBinary;
  }
  cachedTailscaleBinary = await findTailscaleBinary();
  return cachedTailscaleBinary ?? "tailscale";
}
export async function readTailscaleStatusJson(exec = runExec, opts) {
  const tailscaleBin = await getTailscaleBinary();
  const { stdout } = await exec(tailscaleBin, ["status", "--json"], {
    timeoutMs: opts?.timeoutMs ?? 5000,
    maxBuffer: 400000,
  });
  return stdout ? parsePossiblyNoisyJsonObject(stdout) : {};
}
export async function ensureGoInstalled(
  exec = runExec,
  prompt = promptYesNo,
  runtime = defaultRuntime,
) {
  const hasGo = await exec("go", ["version"]).then(
    () => true,
    () => false,
  );
  if (hasGo) {
    return;
  }
  const install = await prompt(
    "Go is not installed. Install via Homebrew (brew install go)?",
    true,
  );
  if (!install) {
    runtime.error("Go is required to build tailscaled from source. Aborting.");
    runtime.exit(1);
  }
  logVerbose("Installing Go via Homebrew\u2026");
  await exec("brew", ["install", "go"]);
}
export async function ensureTailscaledInstalled(
  exec = runExec,
  prompt = promptYesNo,
  runtime = defaultRuntime,
) {
  const hasTailscaled = await exec("tailscaled", ["--version"]).then(
    () => true,
    () => false,
  );
  if (hasTailscaled) {
    return;
  }
  const install = await prompt(
    "tailscaled not found. Install via Homebrew (tailscale package)?",
    true,
  );
  if (!install) {
    runtime.error("tailscaled is required for user-space funnel. Aborting.");
    runtime.exit(1);
  }
  logVerbose("Installing tailscaled via Homebrew\u2026");
  await exec("brew", ["install", "tailscale"]);
}
const whoisCache = new Map();
async function execWithSudoFallback(exec, bin, args, opts) {
  try {
    return await exec(bin, args, opts);
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      throw err;
    }
    logVerbose(`Command failed, retrying with sudo: ${bin} ${args.join(" ")}`);
    try {
      return await exec("sudo", ["-n", bin, ...args], opts);
    } catch (sudoErr) {
      const { stderr, message } = extractExecErrorText(sudoErr);
      const detail = (stderr || message).trim();
      if (detail) {
        logVerbose(`Sudo retry failed: ${detail}`);
      }
      throw err;
    }
  }
}
export async function ensureFunnel(
  port,
  exec = runExec,
  runtime = defaultRuntime,
  prompt = promptYesNo,
) {
  try {
    const tailscaleBin = await getTailscaleBinary();
    const statusOut = (await exec(tailscaleBin, ["funnel", "status", "--json"])).stdout.trim();
    const parsed = statusOut ? JSON.parse(statusOut) : {};
    if (!parsed || Object.keys(parsed).length === 0) {
      runtime.error(danger("Tailscale Funnel is not enabled on this tailnet/device."));
      runtime.error(
        info(
          "Enable in admin console: https://login.tailscale.com/admin (see https://tailscale.com/kb/1223/funnel)",
        ),
      );
      runtime.error(
        info(
          "macOS user-space tailscaled docs: https://github.com/tailscale/tailscale/wiki/Tailscaled-on-macOS",
        ),
      );
      const proceed = await prompt("Attempt local setup with user-space tailscaled?", true);
      if (!proceed) {
        runtime.exit(1);
      }
      await ensureBinary("brew", exec, runtime);
      await ensureGoInstalled(exec, prompt, runtime);
      await ensureTailscaledInstalled(exec, prompt, runtime);
    }
    logVerbose(`Enabling funnel on port ${port}\u2026`);
    const { stdout } = await execWithSudoFallback(
      exec,
      tailscaleBin,
      ["funnel", "--yes", "--bg", `${port}`],
      {
        maxBuffer: 200000,
        timeoutMs: 15000,
      },
    );
    if (stdout.trim()) {
      console.log(stdout.trim());
    }
  } catch (err) {
    const errOutput = err;
    const stdout = typeof errOutput.stdout === "string" ? errOutput.stdout : "";
    const stderr = typeof errOutput.stderr === "string" ? errOutput.stderr : "";
    if (stdout.includes("Funnel is not enabled")) {
      console.error(danger("Funnel is not enabled on this tailnet/device."));
      const linkMatch = stdout.match(/https?:\/\/\S+/);
      if (linkMatch) {
        console.error(info(`Enable it here: ${linkMatch[0]}`));
      } else {
        console.error(
          info(
            "Enable in admin console: https://login.tailscale.com/admin (see https://tailscale.com/kb/1223/funnel)",
          ),
        );
      }
    }
    if (stderr.includes("client version") || stdout.includes("client version")) {
      console.error(
        warn(
          "Tailscale client/server version mismatch detected; try updating tailscale/tailscaled.",
        ),
      );
    }
    runtime.error("Failed to enable Tailscale Funnel. Is it allowed on your tailnet?");
    runtime.error(
      info(
        `Tip: Funnel is optional for GenosOS. You can keep running the web gateway without it: \`${formatCliCommand("genosos gateway")}\``,
      ),
    );
    if (shouldLogVerbose()) {
      const rich = isRich();
      if (stdout.trim()) {
        runtime.error(colorize(rich, theme.muted, `stdout: ${stdout.trim()}`));
      }
      if (stderr.trim()) {
        runtime.error(colorize(rich, theme.muted, `stderr: ${stderr.trim()}`));
      }
      runtime.error(err);
    }
    runtime.exit(1);
  }
}
export async function enableTailscaleServe(port, exec = runExec) {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ["serve", "--bg", "--yes", `${port}`], {
    maxBuffer: 200000,
    timeoutMs: 15000,
  });
}
export async function disableTailscaleServe(exec = runExec) {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ["serve", "reset"], {
    maxBuffer: 200000,
    timeoutMs: 15000,
  });
}
export async function enableTailscaleFunnel(port, exec = runExec) {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ["funnel", "--bg", "--yes", `${port}`], {
    maxBuffer: 200000,
    timeoutMs: 15000,
  });
}
export async function disableTailscaleFunnel(exec = runExec) {
  const tailscaleBin = await getTailscaleBinary();
  await execWithSudoFallback(exec, tailscaleBin, ["funnel", "reset"], {
    maxBuffer: 200000,
    timeoutMs: 15000,
  });
}
export async function readTailscaleWhoisIdentity(ip, exec = runExec, opts) {
  const normalized = ip.trim();
  if (!normalized) {
    return null;
  }
  const now = Date.now();
  const cached = readCachedWhois(normalized, now);
  if (cached !== undefined) {
    return cached;
  }
  const cacheTtlMs = opts?.cacheTtlMs ?? 60000;
  const errorTtlMs = opts?.errorTtlMs ?? 5000;
  try {
    const tailscaleBin = await getTailscaleBinary();
    const { stdout } = await exec(tailscaleBin, ["whois", "--json", normalized], {
      timeoutMs: opts?.timeoutMs ?? 5000,
      maxBuffer: 200000,
    });
    const parsed = stdout ? parsePossiblyNoisyJsonObject(stdout) : {};
    const identity = parseWhoisIdentity(parsed);
    writeCachedWhois(normalized, identity, cacheTtlMs);
    return identity;
  } catch {
    writeCachedWhois(normalized, null, errorTtlMs);
    return null;
  }
}
