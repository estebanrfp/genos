let resolveCommand = function (command) {
  if (process.platform !== "win32") {
    return command;
  }
  const basename = path.basename(command).toLowerCase();
  const ext = path.extname(basename);
  if (ext) {
    return command;
  }
  const cmdCommands = ["npm", "pnpm", "yarn", "npx"];
  if (cmdCommands.includes(basename)) {
    return `${command}.cmd`;
  }
  return command;
};
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { danger, shouldLogVerbose } from "../globals.js";
import { logDebug, logError } from "../logger.js";
import { resolveCommandStdio } from "./spawn-utils.js";
const execFileAsync = promisify(execFile);
export function shouldSpawnWithShell(_params) {
  return false;
}
export async function runExec(command, args, opts = 1e4) {
  const options =
    typeof opts === "number"
      ? { timeout: opts, encoding: "utf8" }
      : {
          timeout: opts.timeoutMs,
          maxBuffer: opts.maxBuffer,
          encoding: "utf8",
        };
  try {
    const { stdout, stderr } = await execFileAsync(resolveCommand(command), args, options);
    if (shouldLogVerbose()) {
      if (stdout.trim()) {
        logDebug(stdout.trim());
      }
      if (stderr.trim()) {
        logError(stderr.trim());
      }
    }
    return { stdout, stderr };
  } catch (err) {
    if (shouldLogVerbose()) {
      logError(danger(`Command failed: ${command} ${args.join(" ")}`));
    }
    throw err;
  }
}
export async function runCommandWithTimeout(argv, optionsOrTimeout) {
  const options =
    typeof optionsOrTimeout === "number" ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
  const { timeoutMs, cwd, input, env, noOutputTimeoutMs } = options;
  const { windowsVerbatimArguments } = options;
  const hasInput = input !== undefined;
  const shouldSuppressNpmFund = (() => {
    const cmd = path.basename(argv[0] ?? "");
    if (cmd === "npm" || cmd === "npm.cmd" || cmd === "npm.exe") {
      return true;
    }
    if (cmd === "node" || cmd === "node.exe") {
      const script = argv[1] ?? "";
      return script.includes("npm-cli.js");
    }
    return false;
  })();
  const mergedEnv = env ? { ...process.env, ...env } : { ...process.env };
  const resolvedEnv = Object.fromEntries(
    Object.entries(mergedEnv)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  if (shouldSuppressNpmFund) {
    if (resolvedEnv.NPM_CONFIG_FUND == null) {
      resolvedEnv.NPM_CONFIG_FUND = "false";
    }
    if (resolvedEnv.npm_config_fund == null) {
      resolvedEnv.npm_config_fund = "false";
    }
  }
  const stdio = resolveCommandStdio({ hasInput, preferInherit: true });
  const resolvedCommand = resolveCommand(argv[0] ?? "");
  const child = spawn(resolvedCommand, argv.slice(1), {
    stdio,
    cwd,
    env: resolvedEnv,
    windowsVerbatimArguments,
    ...(shouldSpawnWithShell({ resolvedCommand, platform: process.platform })
      ? { shell: true }
      : {}),
  });
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let noOutputTimedOut = false;
    let noOutputTimer = null;
    const shouldTrackOutputTimeout =
      typeof noOutputTimeoutMs === "number" &&
      Number.isFinite(noOutputTimeoutMs) &&
      noOutputTimeoutMs > 0;
    const clearNoOutputTimer = () => {
      if (!noOutputTimer) {
        return;
      }
      clearTimeout(noOutputTimer);
      noOutputTimer = null;
    };
    const armNoOutputTimer = () => {
      if (!shouldTrackOutputTimeout || settled) {
        return;
      }
      clearNoOutputTimer();
      noOutputTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        noOutputTimedOut = true;
        if (typeof child.kill === "function") {
          child.kill("SIGKILL");
        }
      }, Math.floor(noOutputTimeoutMs));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (typeof child.kill === "function") {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    armNoOutputTimer();
    if (hasInput && child.stdin) {
      child.stdin.write(input ?? "");
      child.stdin.end();
    }
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      armNoOutputTimer();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      armNoOutputTimer();
    });
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearNoOutputTimer();
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearNoOutputTimer();
      const termination = noOutputTimedOut
        ? "no-output-timeout"
        : timedOut
          ? "timeout"
          : signal != null
            ? "signal"
            : "exit";
      resolve({
        pid: child.pid ?? undefined,
        stdout,
        stderr,
        code,
        signal,
        killed: child.killed,
        termination,
        noOutputTimedOut,
      });
    });
  });
}
