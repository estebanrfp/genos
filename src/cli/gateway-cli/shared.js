import {
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
  resolveGatewayWindowsTaskName,
} from "../../daemon/constants.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { defaultRuntime } from "../../runtime.js";
import { formatCliCommand } from "../command-format.js";
import { parsePort } from "../shared/parse-port.js";

export { parsePort };
export const toOptionString = (value) => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return;
};
export function describeUnknownError(err) {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "number" || typeof err === "bigint") {
    return err.toString();
  }
  if (typeof err === "boolean") {
    return err ? "true" : "false";
  }
  if (err && typeof err === "object") {
    if ("message" in err && typeof err.message === "string") {
      return err.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }
  return "Unknown error";
}
export function extractGatewayMiskeys(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { hasGatewayToken: false, hasRemoteToken: false };
  }
  const gateway = parsed.gateway;
  if (!gateway || typeof gateway !== "object") {
    return { hasGatewayToken: false, hasRemoteToken: false };
  }
  const hasGatewayToken = "token" in gateway;
  const remote = gateway.remote;
  const hasRemoteToken = remote && typeof remote === "object" ? "token" in remote : false;
  return { hasGatewayToken, hasRemoteToken };
}
export function renderGatewayServiceStopHints(env = process.env) {
  const profile = env.GENOS_PROFILE;
  switch (process.platform) {
    case "darwin":
      return [
        `Tip: ${formatCliCommand("genosos gateway stop")}`,
        `Or: launchctl bootout gui/$UID/${resolveGatewayLaunchAgentLabel(profile)}`,
      ];
    case "linux":
      return [
        `Tip: ${formatCliCommand("genosos gateway stop")}`,
        `Or: systemctl --user stop ${resolveGatewaySystemdServiceName(profile)}.service`,
      ];
    case "win32":
      return [
        `Tip: ${formatCliCommand("genosos gateway stop")}`,
        `Or: schtasks /End /TN "${resolveGatewayWindowsTaskName(profile)}"`,
      ];
    default:
      return [`Tip: ${formatCliCommand("genosos gateway stop")}`];
  }
}
export async function maybeExplainGatewayServiceStop() {
  const service = resolveGatewayService();
  let loaded = null;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch {
    loaded = null;
  }
  if (loaded === false) {
    return;
  }
  defaultRuntime.error(
    loaded
      ? `Gateway service appears ${service.loadedText}. Stop it first.`
      : "Gateway service status unknown; if supervised, stop it first.",
  );
  for (const hint of renderGatewayServiceStopHints()) {
    defaultRuntime.error(hint);
  }
}
