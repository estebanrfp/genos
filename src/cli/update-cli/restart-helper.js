let shellEscape = function (value) {
    return value.replace(/'/g, "'\\''");
  },
  isBatchSafe = function (value) {
    return /^[A-Za-z0-9 _\-().]+$/.test(value);
  },
  resolveSystemdUnit = function (env) {
    const override = env.GENOS_SYSTEMD_UNIT?.trim();
    if (override) {
      return override.endsWith(".service") ? override : `${override}.service`;
    }
    return `${resolveGatewaySystemdServiceName(env.GENOS_PROFILE)}.service`;
  },
  resolveLaunchdLabel = function (env) {
    const override = env.GENOS_LAUNCHD_LABEL?.trim();
    if (override) {
      return override;
    }
    return resolveGatewayLaunchAgentLabel(env.GENOS_PROFILE);
  },
  resolveWindowsTaskName = function (env) {
    const override = env.GENOS_WINDOWS_TASK_NAME?.trim();
    if (override) {
      return override;
    }
    return resolveGatewayWindowsTaskName(env.GENOS_PROFILE);
  };
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
  resolveGatewayWindowsTaskName,
} from "../../daemon/constants.js";
export async function prepareRestartScript(env = process.env) {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const platform = process.platform;
  let scriptContent = "";
  let filename = "";
  try {
    if (platform === "linux") {
      const unitName = resolveSystemdUnit(env);
      const escaped = shellEscape(unitName);
      filename = `genosos-restart-${timestamp}.sh`;
      scriptContent = `#!/bin/sh
# Standalone restart script \u2014 survives parent process termination.
# Wait briefly to ensure file locks are released after update.
sleep 1
systemctl --user restart '${escaped}'
# Self-cleanup
rm -f "$0"
`;
    } else if (platform === "darwin") {
      const label = resolveLaunchdLabel(env);
      const escaped = shellEscape(label);
      const uid = process.getuid ? process.getuid() : 501;
      filename = `genosos-restart-${timestamp}.sh`;
      scriptContent = `#!/bin/sh
# Standalone restart script \u2014 survives parent process termination.
# Wait briefly to ensure file locks are released after update.
sleep 1
launchctl kickstart -k 'gui/${uid}/${escaped}'
# Self-cleanup
rm -f "$0"
`;
    } else if (platform === "win32") {
      const taskName = resolveWindowsTaskName(env);
      if (!isBatchSafe(taskName)) {
        return null;
      }
      filename = `genosos-restart-${timestamp}.bat`;
      scriptContent = `@echo off
REM Standalone restart script \u2014 survives parent process termination.
REM Wait briefly to ensure file locks are released after update.
timeout /t 2 /nobreak >nul
schtasks /End /TN "${taskName}"
schtasks /Run /TN "${taskName}"
REM Self-cleanup
del "%~f0"
`;
    } else {
      return null;
    }
    const scriptPath = path.join(tmpDir, filename);
    await fs.writeFile(scriptPath, scriptContent, { mode: 493 });
    return scriptPath;
  } catch {
    return null;
  }
}
export async function runRestartScript(scriptPath) {
  const isWindows = process.platform === "win32";
  const file = isWindows ? "cmd.exe" : "/bin/sh";
  const args = isWindows ? ["/c", scriptPath] : [scriptPath];
  const child = spawn(file, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
