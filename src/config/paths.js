let envHomedir = function (env) {
    return () => resolveRequiredHomeDir(env, os.homedir);
  },
  resolveUserPath = function (input, env = process.env, homedir = envHomedir(env)) {
    const trimmed = input.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("~")) {
      const expanded = expandHomePrefix(trimmed, {
        home: resolveRequiredHomeDir(env, homedir),
        env,
        homedir,
      });
      return path.resolve(expanded);
    }
    return path.resolve(trimmed);
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHomePrefix, resolveRequiredHomeDir } from "../infra/home-dir.js";
export function resolveIsNixMode(env = process.env) {
  return env.GENOS_NIX_MODE === "1";
}
export const isNixMode = resolveIsNixMode();
const STATE_DIRNAME = ".genosv1";
const CONFIG_FILENAME = "genosos.json";
export function resolveStateDir(env = process.env, homedir = envHomedir(env)) {
  const effectiveHomedir = () => resolveRequiredHomeDir(env, homedir);
  const override = env.GENOS_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath(override, env, effectiveHomedir);
  }
  return path.join(effectiveHomedir(), STATE_DIRNAME);
}
export const STATE_DIR = resolveStateDir();
export function resolveCanonicalConfigPath(
  env = process.env,
  stateDir = resolveStateDir(env, envHomedir(env)),
) {
  const override = env.GENOS_CONFIG_PATH?.trim();
  if (override) {
    return resolveUserPath(override, env, envHomedir(env));
  }
  return path.join(stateDir, CONFIG_FILENAME);
}
export function resolveConfigPathCandidate(env = process.env, homedir = envHomedir(env)) {
  const override = env.GENOS_CONFIG_PATH?.trim();
  if (override) {
    return resolveUserPath(override, env, homedir);
  }
  return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
}
export function resolveConfigPath(
  env = process.env,
  stateDir = resolveStateDir(env, envHomedir(env)),
  homedir = envHomedir(env),
) {
  const override = env.GENOS_CONFIG_PATH?.trim();
  if (override) {
    return resolveUserPath(override, env, homedir);
  }
  const candidate = path.join(stateDir, CONFIG_FILENAME);
  try {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {}
  return candidate;
}
export const CONFIG_PATH = resolveConfigPathCandidate();
export function resolveDefaultConfigCandidates(env = process.env, homedir = envHomedir(env)) {
  const explicit = env.GENOS_CONFIG_PATH?.trim();
  if (explicit) {
    return [resolveUserPath(explicit, env, () => resolveRequiredHomeDir(env, homedir))];
  }
  const stateDir = resolveStateDir(env, homedir);
  return [path.join(stateDir, CONFIG_FILENAME)];
}
export const DEFAULT_GATEWAY_PORT = 18789;
export function resolveGatewayLockDir(tmpdir = os.tmpdir) {
  const base = tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const suffix = uid != null ? `genosos-${uid}` : "genosos";
  return path.join(base, suffix);
}
const OAUTH_FILENAME = "oauth.json";
export function resolveOAuthDir(
  env = process.env,
  stateDir = resolveStateDir(env, envHomedir(env)),
) {
  const override = env.GENOS_OAUTH_DIR?.trim();
  if (override) {
    return resolveUserPath(override, env, envHomedir(env));
  }
  return path.join(stateDir, "credentials");
}
export function resolveOAuthPath(
  env = process.env,
  stateDir = resolveStateDir(env, envHomedir(env)),
) {
  return path.join(resolveOAuthDir(env, stateDir), OAUTH_FILENAME);
}
export function resolveGatewayPort(cfg, env = process.env) {
  const envRaw = env.GENOS_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) {
      return configPort;
    }
  }
  return DEFAULT_GATEWAY_PORT;
}
