import fs from "node:fs";
import path from "node:path";
import { getTailnetHostname } from "../infra/tailscale.js";
import { runExec } from "../process/exec.js";
export function formatBonjourInstanceName(displayName) {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return "GenosOS";
  }
  if (/genosos/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} (GenosOS)`;
}
export function resolveBonjourCliPath(opts = {}) {
  const env = opts.env ?? process.env;
  const envPath = env.GENOS_CLI_PATH?.trim();
  if (envPath) {
    return envPath;
  }
  const statSync = opts.statSync ?? fs.statSync;
  const isFile = (candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  };
  const execPath = opts.execPath ?? process.execPath;
  const execDir = path.dirname(execPath);
  const siblingCli = path.join(execDir, "genosos");
  if (isFile(siblingCli)) {
    return siblingCli;
  }
  const argv = opts.argv ?? process.argv;
  const argvPath = argv[1];
  if (argvPath && isFile(argvPath)) {
    return argvPath;
  }
  const cwd = opts.cwd ?? process.cwd();
  const distCli = path.join(cwd, "dist", "index.js");
  if (isFile(distCli)) {
    return distCli;
  }
  const binCli = path.join(cwd, "bin", "genosos");
  if (isFile(binCli)) {
    return binCli;
  }
  return;
}
export async function resolveTailnetDnsHint(opts) {
  const env = opts?.env ?? process.env;
  const envRaw = env.GENOS_TAILNET_DNS?.trim();
  const envValue = envRaw && envRaw.length > 0 ? envRaw.replace(/\.$/, "") : "";
  if (envValue) {
    return envValue;
  }
  if (opts?.enabled === false) {
    return;
  }
  const exec =
    opts?.exec ??
    ((command, args) => runExec(command, args, { timeoutMs: 1500, maxBuffer: 200000 }));
  try {
    return await getTailnetHostname(exec);
  } catch {
    return;
  }
}
