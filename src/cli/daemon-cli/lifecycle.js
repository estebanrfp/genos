import { resolveGatewayService } from "../../daemon/service.js";
import {
  runServiceRestart,
  runServiceStart,
  runServiceStop,
  runServiceUninstall,
} from "./lifecycle-core.js";
import { renderGatewayServiceStartHints } from "./shared.js";
export async function runDaemonUninstall(opts = {}) {
  return await runServiceUninstall({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    opts,
    stopBeforeUninstall: true,
    assertNotLoadedAfterUninstall: true,
  });
}
export async function runDaemonStart(opts = {}) {
  return await runServiceStart({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    renderStartHints: renderGatewayServiceStartHints,
    opts,
  });
}
export async function runDaemonStop(opts = {}) {
  return await runServiceStop({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    opts,
  });
}
export async function runDaemonRestart(opts = {}) {
  return await runServiceRestart({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    renderStartHints: renderGatewayServiceStartHints,
    opts,
    checkTokenDrift: true,
  });
}
