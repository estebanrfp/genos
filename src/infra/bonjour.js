let isDisabledByEnv = function () {
    if (isTruthyEnvValue(process.env.GENOS_DISABLE_BONJOUR)) {
      return true;
    }
    if (process.env.VITEST) {
      return true;
    }
    return false;
  },
  safeServiceName = function (name) {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : "GenosOS";
  },
  prettifyInstanceName = function (name) {
    const normalized = name.trim().replace(/\s+/g, " ");
    return normalized.replace(/\s+\(GenosOS\)\s*$/i, "").trim() || normalized;
  },
  serviceSummary = function (label, svc) {
    let fqdn = "unknown";
    let hostname = "unknown";
    let port = -1;
    try {
      fqdn = svc.getFQDN();
    } catch {}
    try {
      hostname = svc.getHostname();
    } catch {}
    try {
      port = svc.getPort();
    } catch {}
    const state = typeof svc.serviceState === "string" ? svc.serviceState : "unknown";
    return `${label} fqdn=${fqdn} host=${hostname} port=${port} state=${state}`;
  };
import { logDebug, logWarn } from "../logger.js";
import { getLogger } from "../logging.js";
import { ignoreCiaoCancellationRejection } from "./bonjour-ciao.js";
import { formatBonjourError } from "./bonjour-errors.js";
import { isTruthyEnvValue } from "./env.js";
import { registerUnhandledRejectionHandler } from "./unhandled-rejections.js";
export async function startGatewayBonjourAdvertiser(opts) {
  if (isDisabledByEnv()) {
    return { stop: async () => {} };
  }
  const { getResponder, Protocol } = await import("@homebridge/ciao");
  const responder = getResponder();
  const hostnameRaw =
    process.env.GENOS_MDNS_HOSTNAME?.trim() || process.env.GENOS_MDNS_HOSTNAME?.trim() || "genosos";
  const hostname =
    hostnameRaw
      .replace(/\.local$/i, "")
      .split(".")[0]
      .trim() || "genosos";
  const instanceName =
    typeof opts.instanceName === "string" && opts.instanceName.trim()
      ? opts.instanceName.trim()
      : `${hostname} (GenosOS)`;
  const displayName = prettifyInstanceName(instanceName);
  const txtBase = {
    role: "gateway",
    gatewayPort: String(opts.gatewayPort),
    lanHost: `${hostname}.local`,
    displayName,
  };
  if (opts.gatewayTlsEnabled) {
    txtBase.gatewayTls = "1";
    if (opts.gatewayTlsFingerprintSha256) {
      txtBase.gatewayTlsSha256 = opts.gatewayTlsFingerprintSha256;
    }
  }
  if (typeof opts.canvasPort === "number" && opts.canvasPort > 0) {
    txtBase.canvasPort = String(opts.canvasPort);
  }
  if (typeof opts.tailnetDns === "string" && opts.tailnetDns.trim()) {
    txtBase.tailnetDns = opts.tailnetDns.trim();
  }
  if (!opts.minimal && typeof opts.cliPath === "string" && opts.cliPath.trim()) {
    txtBase.cliPath = opts.cliPath.trim();
  }
  const services = [];
  const gatewayTxt = {
    ...txtBase,
    transport: "gateway",
  };
  if (!opts.minimal) {
    gatewayTxt.sshPort = String(opts.sshPort ?? 22);
  }
  const gateway = responder.createService({
    name: safeServiceName(instanceName),
    type: "genosos-gw",
    protocol: Protocol.TCP,
    port: opts.gatewayPort,
    domain: "local",
    hostname,
    txt: gatewayTxt,
  });
  services.push({
    label: "gateway",
    svc: gateway,
  });
  let ciaoCancellationRejectionHandler;
  if (services.length > 0) {
    ciaoCancellationRejectionHandler = registerUnhandledRejectionHandler(
      ignoreCiaoCancellationRejection,
    );
  }
  logDebug(
    `bonjour: starting (hostname=${hostname}, instance=${JSON.stringify(safeServiceName(instanceName))}, gatewayPort=${opts.gatewayPort}${opts.minimal ? ", minimal=true" : `, sshPort=${opts.sshPort ?? 22}`})`,
  );
  for (const { label, svc } of services) {
    try {
      svc.on("name-change", (name) => {
        const next = typeof name === "string" ? name : String(name);
        logWarn(`bonjour: ${label} name conflict resolved; newName=${JSON.stringify(next)}`);
      });
      svc.on("hostname-change", (nextHostname) => {
        const next = typeof nextHostname === "string" ? nextHostname : String(nextHostname);
        logWarn(
          `bonjour: ${label} hostname conflict resolved; newHostname=${JSON.stringify(next)}`,
        );
      });
    } catch (err) {
      logDebug(`bonjour: failed to attach listeners for ${label}: ${String(err)}`);
    }
  }
  for (const { label, svc } of services) {
    try {
      svc
        .advertise()
        .then(() => {
          getLogger().info(`bonjour: advertised ${serviceSummary(label, svc)}`);
        })
        .catch((err) => {
          logWarn(
            `bonjour: advertise failed (${serviceSummary(label, svc)}): ${formatBonjourError(err)}`,
          );
        });
    } catch (err) {
      logWarn(
        `bonjour: advertise threw (${serviceSummary(label, svc)}): ${formatBonjourError(err)}`,
      );
    }
  }
  const lastRepairAttempt = new Map();
  const watchdog = setInterval(() => {
    for (const { label, svc } of services) {
      const stateUnknown = svc.serviceState;
      if (typeof stateUnknown !== "string") {
        continue;
      }
      if (stateUnknown === "announced" || stateUnknown === "announcing") {
        continue;
      }
      let key = label;
      try {
        key = `${label}:${svc.getFQDN()}`;
      } catch {}
      const now = Date.now();
      const last = lastRepairAttempt.get(key) ?? 0;
      if (now - last < 30000) {
        continue;
      }
      lastRepairAttempt.set(key, now);
      logWarn(
        `bonjour: watchdog detected non-announced service; attempting re-advertise (${serviceSummary(label, svc)})`,
      );
      try {
        svc.advertise().catch((err) => {
          logWarn(
            `bonjour: watchdog advertise failed (${serviceSummary(label, svc)}): ${formatBonjourError(err)}`,
          );
        });
      } catch (err) {
        logWarn(
          `bonjour: watchdog advertise threw (${serviceSummary(label, svc)}): ${formatBonjourError(err)}`,
        );
      }
    }
  }, 60000);
  watchdog.unref?.();
  return {
    stop: async () => {
      clearInterval(watchdog);
      for (const { svc } of services) {
        try {
          await svc.destroy();
        } catch {}
      }
      try {
        await responder.shutdown();
      } catch {
      } finally {
        ciaoCancellationRejectionHandler?.();
      }
    },
  };
}
