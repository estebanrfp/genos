let isTruthy = function (value) {
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
    );
  },
  isLikelySupervisedProcess = function (env = process.env) {
    return SUPERVISOR_HINT_ENV_VARS.some((key) => {
      const value = env[key];
      return typeof value === "string" && value.trim().length > 0;
    });
  };
import { spawn } from "node:child_process";
const SUPERVISOR_HINT_ENV_VARS = [
  "LAUNCH_JOB_LABEL",
  "LAUNCH_JOB_NAME",
  "INVOCATION_ID",
  "SYSTEMD_EXEC_PID",
  "JOURNAL_STREAM",
];
export function restartGatewayProcessWithFreshPid() {
  if (isTruthy(process.env.GENOS_NO_RESPAWN)) {
    return { mode: "disabled" };
  }
  if (isLikelySupervisedProcess(process.env)) {
    return { mode: "supervised" };
  }
  try {
    const args = [...process.execArgv, ...process.argv.slice(1)];
    const child = spawn(process.execPath, args, {
      env: process.env,
      detached: true,
      stdio: "inherit",
    });
    child.unref();
    return { mode: "spawned", pid: child.pid ?? undefined };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { mode: "failed", detail };
  }
}
