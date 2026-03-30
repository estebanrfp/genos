import { formatCliCommand } from "../cli/command-format.js";
import { collectConfigEnvVars } from "../config/env-vars.js";
import { resolveGatewayLaunchAgentLabel } from "../daemon/constants.js";
import { resolveGatewayProgramArguments } from "../daemon/program-args.js";
import { resolvePreferredNodePath } from "../daemon/runtime-paths.js";
import { buildServiceEnvironment } from "../daemon/service-env.js";
import { emitNodeRuntimeWarning } from "./daemon-install-runtime-warning.js";
export function resolveGatewayDevMode(argv = process.argv) {
  const entry = argv[1];
  const normalizedEntry = entry?.replaceAll("\\", "/");
  return Boolean(normalizedEntry?.includes("/src/") && normalizedEntry.endsWith(".js"));
}
export async function buildGatewayInstallPlan(params) {
  const devMode = params.devMode ?? resolveGatewayDevMode();
  const nodePath =
    params.nodePath ??
    (await resolvePreferredNodePath({
      env: params.env,
      runtime: params.runtime,
    }));
  const { programArguments, workingDirectory } = await resolveGatewayProgramArguments({
    port: params.port,
    dev: devMode,
    runtime: params.runtime,
    nodePath,
  });
  await emitNodeRuntimeWarning({
    env: params.env,
    runtime: params.runtime,
    nodeProgram: programArguments[0],
    warn: params.warn,
    title: "Gateway runtime",
  });
  const serviceEnvironment = buildServiceEnvironment({
    env: params.env,
    port: params.port,
    token: params.token,
    launchdLabel:
      process.platform === "darwin"
        ? resolveGatewayLaunchAgentLabel(params.env.GENOS_PROFILE)
        : undefined,
  });
  const environment = {
    ...collectConfigEnvVars(params.config),
  };
  Object.assign(environment, serviceEnvironment);
  return { programArguments, workingDirectory, environment };
}
export function gatewayInstallErrorHint(platform = process.platform) {
  return platform === "win32"
    ? "Tip: rerun from an elevated PowerShell (Start \u2192 type PowerShell \u2192 right-click \u2192 Run as administrator) or skip service install."
    : `Tip: rerun \`${formatCliCommand("genosos gateway install")}\` after fixing the error.`;
}
