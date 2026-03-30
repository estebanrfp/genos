let resolvePowerShellPath = function () {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    if (systemRoot) {
      const candidate = path.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return "powershell.exe";
  },
  resolveShellFromPath = function (name) {
    const envPath = process.env.PATH ?? "";
    if (!envPath) {
      return;
    }
    const entries = envPath.split(path.delimiter).filter(Boolean);
    for (const entry of entries) {
      const candidate = path.join(entry, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
    return;
  },
  normalizeShellName = function (value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    return path
      .basename(trimmed)
      .replace(/\.(exe|cmd|bat)$/i, "")
      .replace(/[^a-zA-Z0-9_-]/g, "");
  };
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
export function getShellConfig() {
  if (process.platform === "win32") {
    return {
      shell: resolvePowerShellPath(),
      args: ["-NoProfile", "-NonInteractive", "-Command"],
    };
  }
  const envShell = process.env.SHELL?.trim();
  const shellName = envShell ? path.basename(envShell) : "";
  if (shellName === "fish") {
    const bash = resolveShellFromPath("bash");
    if (bash) {
      return { shell: bash, args: ["-c"] };
    }
    const sh = resolveShellFromPath("sh");
    if (sh) {
      return { shell: sh, args: ["-c"] };
    }
  }
  const shell = envShell && envShell.length > 0 ? envShell : "sh";
  return { shell, args: ["-c"] };
}
export function detectRuntimeShell() {
  const overrideShell = process.env.GENOS_SHELL?.trim() || process.env.GENOS_SHELL?.trim();
  if (overrideShell) {
    const name = normalizeShellName(overrideShell);
    if (name) {
      return name;
    }
  }
  if (process.platform === "win32") {
    if (process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
      return "pwsh";
    }
    return "powershell";
  }
  const envShell = process.env.SHELL?.trim();
  if (envShell) {
    const name = normalizeShellName(envShell);
    if (name) {
      return name;
    }
  }
  if (process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
    return "pwsh";
  }
  if (process.env.BASH_VERSION) {
    return "bash";
  }
  if (process.env.ZSH_VERSION) {
    return "zsh";
  }
  if (process.env.FISH_VERSION) {
    return "fish";
  }
  if (process.env.KSH_VERSION) {
    return "ksh";
  }
  if (process.env.NU_VERSION || process.env.NUSHELL_VERSION) {
    return "nu";
  }
  return;
}
export function sanitizeBinaryOutput(text) {
  const scrubbed = text.replace(/[\p{Format}\p{Surrogate}]/gu, "");
  if (!scrubbed) {
    return scrubbed;
  }
  const chunks = [];
  for (const char of scrubbed) {
    const code = char.codePointAt(0);
    if (code == null) {
      continue;
    }
    if (code === 9 || code === 10 || code === 13) {
      chunks.push(char);
      continue;
    }
    if (code < 32) {
      continue;
    }
    chunks.push(char);
  }
  return chunks.join("");
}
export function killProcessTree(pid) {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
      });
    } catch {}
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}
