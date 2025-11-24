let addNonEmptyDir = function (dirs, dir) {
    if (dir) {
      dirs.push(dir);
    }
  },
  appendSubdir = function (base, subdir) {
    if (!base) {
      return;
    }
    return base.endsWith(`/${subdir}`) ? base : path.posix.join(base, subdir);
  },
  addCommonUserBinDirs = function (dirs, home) {
    dirs.push(`${home}/.local/bin`);
    dirs.push(`${home}/.npm-global/bin`);
    dirs.push(`${home}/bin`);
    dirs.push(`${home}/.volta/bin`);
    dirs.push(`${home}/.asdf/shims`);
    dirs.push(`${home}/.bun/bin`);
  },
  resolveSystemPathDirs = function (platform) {
    if (platform === "darwin") {
      return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
    }
    if (platform === "linux") {
      return ["/usr/local/bin", "/usr/bin", "/bin"];
    }
    return [];
  };
import os from "node:os";
import path from "node:path";
import { VERSION } from "../version.js";
import {
  GATEWAY_SERVICE_KIND,
  GATEWAY_SERVICE_MARKER,
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
  NODE_SERVICE_KIND,
  NODE_SERVICE_MARKER,
  NODE_WINDOWS_TASK_SCRIPT_NAME,
  resolveNodeLaunchAgentLabel,
  resolveNodeSystemdServiceName,
  resolveNodeWindowsTaskName,
} from "./constants.js";
export function resolveDarwinUserBinDirs(home, env) {
  if (!home) {
    return [];
  }
  const dirs = [];
  addNonEmptyDir(dirs, env?.PNPM_HOME);
  addNonEmptyDir(dirs, appendSubdir(env?.NPM_CONFIG_PREFIX, "bin"));
  addNonEmptyDir(dirs, appendSubdir(env?.BUN_INSTALL, "bin"));
  addNonEmptyDir(dirs, appendSubdir(env?.VOLTA_HOME, "bin"));
  addNonEmptyDir(dirs, appendSubdir(env?.ASDF_DATA_DIR, "shims"));
  addNonEmptyDir(dirs, env?.NVM_DIR);
  addNonEmptyDir(dirs, appendSubdir(env?.FNM_DIR, "aliases/default/bin"));
  addCommonUserBinDirs(dirs, home);
  dirs.push(`${home}/Library/Application Support/fnm/aliases/default/bin`);
  dirs.push(`${home}/.fnm/aliases/default/bin`);
  dirs.push(`${home}/Library/pnpm`);
  dirs.push(`${home}/.local/share/pnpm`);
  return dirs;
}
export function resolveLinuxUserBinDirs(home, env) {
  if (!home) {
    return [];
  }
  const dirs = [];
  addNonEmptyDir(dirs, env?.PNPM_HOME);
  addNonEmptyDir(dirs, appendSubdir(env?.NPM_CONFIG_PREFIX, "bin"));
  addNonEmptyDir(dirs, appendSubdir(env?.BUN_INSTALL, "bin"));
  addNonEmptyDir(dirs, appendSubdir(env?.VOLTA_HOME, "bin"));
  addNonEmptyDir(dirs, appendSubdir(env?.ASDF_DATA_DIR, "shims"));
  addNonEmptyDir(dirs, appendSubdir(env?.NVM_DIR, "current/bin"));
  addNonEmptyDir(dirs, appendSubdir(env?.FNM_DIR, "current/bin"));
  addCommonUserBinDirs(dirs, home);
  dirs.push(`${home}/.nvm/current/bin`);
  dirs.push(`${home}/.fnm/current/bin`);
  dirs.push(`${home}/.local/share/pnpm`);
  return dirs;
}
export function getMinimalServicePathParts(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return [];
  }
  const parts = [];
  const extraDirs = options.extraDirs ?? [];
  const systemDirs = resolveSystemPathDirs(platform);
  const userDirs =
    platform === "linux"
      ? resolveLinuxUserBinDirs(options.home, options.env)
      : platform === "darwin"
        ? resolveDarwinUserBinDirs(options.home, options.env)
        : [];
  const add = (dir) => {
    if (!dir) {
      return;
    }
    if (!parts.includes(dir)) {
      parts.push(dir);
    }
  };
  for (const dir of extraDirs) {
    add(dir);
  }
  for (const dir of userDirs) {
    add(dir);
  }
  for (const dir of systemDirs) {
    add(dir);
  }
  return parts;
}
export function getMinimalServicePathPartsFromEnv(options = {}) {
  const env = options.env ?? process.env;
  return getMinimalServicePathParts({
    ...options,
    home: options.home ?? env.HOME,
    env,
  });
}
export function buildMinimalServicePath(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return env.PATH ?? "";
  }
  return getMinimalServicePathPartsFromEnv({ ...options, env }).join(path.posix.delimiter);
}
export function buildServiceEnvironment(params) {
  const { env, port, token, launchdLabel } = params;
  const profile = env.GENOS_PROFILE;
  const resolvedLaunchdLabel =
    launchdLabel ||
    (process.platform === "darwin" ? resolveGatewayLaunchAgentLabel(profile) : undefined);
  const systemdUnit = `${resolveGatewaySystemdServiceName(profile)}.service`;
  const stateDir = env.GENOS_STATE_DIR;
  const configPath = env.GENOS_CONFIG_PATH;
  const tmpDir = env.TMPDIR?.trim() || os.tmpdir();
  return {
    HOME: env.HOME,
    TMPDIR: tmpDir,
    PATH: buildMinimalServicePath({ env }),
    GENOS_PROFILE: profile,
    GENOS_STATE_DIR: stateDir,
    GENOS_CONFIG_PATH: configPath,
    GENOS_GATEWAY_PORT: String(port),
    GENOS_GATEWAY_TOKEN: token,
    GENOS_LAUNCHD_LABEL: resolvedLaunchdLabel,
    GENOS_SYSTEMD_UNIT: systemdUnit,
    GENOS_SERVICE_MARKER: GATEWAY_SERVICE_MARKER,
    GENOS_SERVICE_KIND: GATEWAY_SERVICE_KIND,
    GENOS_SERVICE_VERSION: VERSION,
  };
}
export function buildNodeServiceEnvironment(params) {
  const { env } = params;
  const stateDir = env.GENOS_STATE_DIR;
  const configPath = env.GENOS_CONFIG_PATH;
  const tmpDir = env.TMPDIR?.trim() || os.tmpdir();
  return {
    HOME: env.HOME,
    TMPDIR: tmpDir,
    PATH: buildMinimalServicePath({ env }),
    GENOS_STATE_DIR: stateDir,
    GENOS_CONFIG_PATH: configPath,
    GENOS_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    GENOS_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    GENOS_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    GENOS_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    GENOS_LOG_PREFIX: "node",
    GENOS_SERVICE_MARKER: NODE_SERVICE_MARKER,
    GENOS_SERVICE_KIND: NODE_SERVICE_KIND,
    GENOS_SERVICE_VERSION: VERSION,
  };
}
