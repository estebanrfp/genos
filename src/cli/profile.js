let takeValue = function (raw, next) {
    if (raw.includes("=")) {
      const [, value] = raw.split("=", 2);
      const trimmed = (value ?? "").trim();
      return { value: trimmed || null, consumedNext: false };
    }
    const trimmed = (next ?? "").trim();
    return { value: trimmed || null, consumedNext: Boolean(next) };
  },
  resolveProfileStateDir = function (profile, env, homedir) {
    const suffix = profile.toLowerCase() === "default" ? "" : `-${profile}`;
    return path.join(resolveRequiredHomeDir(env, homedir), `.genos${suffix}`);
  };
import os from "node:os";
import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { isValidProfileName } from "./profile-utils.js";
export function parseCliProfileArgs(argv) {
  if (argv.length < 2) {
    return { ok: true, profile: null, argv };
  }
  const out = argv.slice(0, 2);
  let profile = null;
  let sawDev = false;
  let sawCommand = false;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (sawCommand) {
      out.push(arg);
      continue;
    }
    if (arg === "--dev") {
      if (profile && profile !== "dev") {
        return { ok: false, error: "Cannot combine --dev with --profile" };
      }
      sawDev = true;
      profile = "dev";
      continue;
    }
    if (arg === "--profile" || arg.startsWith("--profile=")) {
      if (sawDev) {
        return { ok: false, error: "Cannot combine --dev with --profile" };
      }
      const next = args[i + 1];
      const { value, consumedNext } = takeValue(arg, next);
      if (consumedNext) {
        i += 1;
      }
      if (!value) {
        return { ok: false, error: "--profile requires a value" };
      }
      if (!isValidProfileName(value)) {
        return {
          ok: false,
          error: 'Invalid --profile (use letters, numbers, "_", "-" only)',
        };
      }
      profile = value;
      continue;
    }
    if (!arg.startsWith("-")) {
      sawCommand = true;
      out.push(arg);
      continue;
    }
    out.push(arg);
  }
  return { ok: true, profile, argv: out };
}
export function applyCliProfileEnv(params) {
  const env = params.env ?? process.env;
  const homedir = params.homedir ?? os.homedir;
  const profile = params.profile.trim();
  if (!profile) {
    return;
  }
  env.GENOS_PROFILE = profile;
  const stateDir = env.GENOS_STATE_DIR?.trim() || resolveProfileStateDir(profile, env, homedir);
  if (!env.GENOS_STATE_DIR?.trim()) {
    env.GENOS_STATE_DIR = stateDir;
  }
  if (!env.GENOS_CONFIG_PATH?.trim()) {
    env.GENOS_CONFIG_PATH = path.join(stateDir, "genosos.json");
  }
  if (profile === "dev" && !env.GENOS_GATEWAY_PORT?.trim()) {
    env.GENOS_GATEWAY_PORT = "19001";
  }
}
