let normalize = function (value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  },
  resolveRawHomeDir = function (env, homedir) {
    const explicitHome = normalize(env.GENOS_HOME);
    if (explicitHome) {
      if (explicitHome === "~" || explicitHome.startsWith("~/") || explicitHome.startsWith("~\\")) {
        const fallbackHome =
          normalize(env.HOME) ?? normalize(env.USERPROFILE) ?? normalizeSafe(homedir);
        if (fallbackHome) {
          return explicitHome.replace(/^~(?=$|[\\/])/, fallbackHome);
        }
        return;
      }
      return explicitHome;
    }
    const envHome = normalize(env.HOME);
    if (envHome) {
      return envHome;
    }
    const userProfile = normalize(env.USERPROFILE);
    if (userProfile) {
      return userProfile;
    }
    return normalizeSafe(homedir);
  },
  normalizeSafe = function (homedir) {
    try {
      return normalize(homedir());
    } catch {
      return;
    }
  };
import os from "node:os";
import path from "node:path";
export function resolveEffectiveHomeDir(env = process.env, homedir = os.homedir) {
  const raw = resolveRawHomeDir(env, homedir);
  return raw ? path.resolve(raw) : undefined;
}
export function resolveRequiredHomeDir(env = process.env, homedir = os.homedir) {
  return resolveEffectiveHomeDir(env, homedir) ?? path.resolve(process.cwd());
}
export function expandHomePrefix(input, opts) {
  if (!input.startsWith("~")) {
    return input;
  }
  const home =
    normalize(opts?.home) ??
    resolveEffectiveHomeDir(opts?.env ?? process.env, opts?.homedir ?? os.homedir);
  if (!home) {
    return input;
  }
  return input.replace(/^~(?=$|[\\/])/, home);
}
