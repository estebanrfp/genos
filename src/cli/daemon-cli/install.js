import { buildGatewayInstallPlan } from "../../commands/daemon-install-helpers.js";
import {
  DEFAULT_GATEWAY_DAEMON_RUNTIME,
  isGatewayDaemonRuntime,
} from "../../commands/daemon-runtime.js";
import { randomToken } from "../../commands/onboard-helpers.js";
import {
  loadConfig,
  readConfigFileSnapshot,
  resolveGatewayPort,
  writeConfigFile,
} from "../../config/config.js";
import { resolveIsNixMode } from "../../config/paths.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { resolveGatewayAuth } from "../../gateway/auth.js";
import { defaultRuntime } from "../../runtime.js";
import { formatCliCommand } from "../command-format.js";
import {
  buildDaemonServiceSnapshot,
  createDaemonActionContext,
  installDaemonServiceAndEmit,
} from "./response.js";
import { parsePort } from "./shared.js";
export async function runDaemonInstall(opts) {
  const json = Boolean(opts.json);
  const { stdout, warnings, emit, fail } = createDaemonActionContext({ action: "install", json });
  if (resolveIsNixMode(process.env)) {
    fail("Nix mode detected; service install is disabled.");
    return;
  }
  const cfg = loadConfig();
  const portOverride = parsePort(opts.port);
  if (opts.port !== undefined && portOverride === null) {
    fail("Invalid port");
    return;
  }
  const port = portOverride ?? resolveGatewayPort(cfg);
  if (!Number.isFinite(port) || port <= 0) {
    fail("Invalid port");
    return;
  }
  const runtimeRaw = opts.runtime ? String(opts.runtime) : DEFAULT_GATEWAY_DAEMON_RUNTIME;
  if (!isGatewayDaemonRuntime(runtimeRaw)) {
    fail('Invalid --runtime (use "node" or "bun")');
    return;
  }
  const service = resolveGatewayService();
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch (err) {
    fail(`Gateway service check failed: ${String(err)}`);
    return;
  }
  if (loaded) {
    if (!opts.force) {
      emit({
        ok: true,
        result: "already-installed",
        message: `Gateway service already ${service.loadedText}.`,
        service: buildDaemonServiceSnapshot(service, loaded),
      });
      if (!json) {
        defaultRuntime.log(`Gateway service already ${service.loadedText}.`);
        defaultRuntime.log(
          `Reinstall with: ${formatCliCommand("genosos gateway install --force")}`,
        );
      }
      return;
    }
  }
  const resolvedAuth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    tailscaleMode: cfg.gateway?.tailscale?.mode ?? "off",
  });
  const needsToken =
    resolvedAuth.mode === "token" && !resolvedAuth.token && !resolvedAuth.allowTailscale;
  let token =
    opts.token ||
    cfg.gateway?.auth?.token ||
    process.env.GENOS_GATEWAY_TOKEN ||
    process.env.GENOS_GATEWAY_TOKEN;
  if (!token && needsToken) {
    token = randomToken();
    const warnMsg = "No gateway token found. Auto-generated one and saving to config.";
    if (json) {
      warnings.push(warnMsg);
    } else {
      defaultRuntime.log(warnMsg);
    }
    try {
      const snapshot = await readConfigFileSnapshot();
      if (snapshot.exists && !snapshot.valid) {
        const msg = "Warning: config file exists but is invalid; skipping token persistence.";
        if (json) {
          warnings.push(msg);
        } else {
          defaultRuntime.log(msg);
        }
      } else {
        const baseConfig = snapshot.exists ? snapshot.config : {};
        if (!baseConfig.gateway?.auth?.token) {
          await writeConfigFile({
            ...baseConfig,
            gateway: {
              ...baseConfig.gateway,
              auth: {
                ...baseConfig.gateway?.auth,
                mode: baseConfig.gateway?.auth?.mode ?? "token",
                token,
              },
            },
          });
        } else {
          token = baseConfig.gateway.auth.token;
        }
      }
    } catch (err) {
      const msg = `Warning: could not persist token to config: ${String(err)}`;
      if (json) {
        warnings.push(msg);
      } else {
        defaultRuntime.log(msg);
      }
    }
  }
  const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
    env: process.env,
    port,
    token,
    runtime: runtimeRaw,
    warn: (message) => {
      if (json) {
        warnings.push(message);
      } else {
        defaultRuntime.log(message);
      }
    },
    config: cfg,
  });
  await installDaemonServiceAndEmit({
    serviceNoun: "Gateway",
    service,
    warnings,
    emit,
    fail,
    install: async () => {
      await service.install({
        env: process.env,
        stdout,
        programArguments,
        workingDirectory,
        environment,
      });
    },
  });
}
