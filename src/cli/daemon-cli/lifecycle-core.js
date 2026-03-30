let createActionIO = function (params) {
  const stdout = params.json ? createNullWriter() : process.stdout;
  const emit = (payload) => {
    if (!params.json) {
      return;
    }
    emitDaemonActionJson({ action: params.action, ...payload });
  };
  const fail = (message, hints) => {
    if (params.json) {
      emit({ ok: false, error: message, hints });
    } else {
      defaultRuntime.error(message);
    }
    defaultRuntime.exit(1);
  };
  return { stdout, emit, fail };
};
import { loadConfig } from "../../config/config.js";
import { resolveIsNixMode } from "../../config/paths.js";
import { checkTokenDrift } from "../../daemon/service-audit.js";
import { renderSystemdUnavailableHints } from "../../daemon/systemd-hints.js";
import { isSystemdUserServiceAvailable } from "../../daemon/systemd.js";
import { isWSL } from "../../infra/wsl.js";
import { defaultRuntime } from "../../runtime.js";
import { buildDaemonServiceSnapshot, createNullWriter, emitDaemonActionJson } from "./response.js";
async function maybeAugmentSystemdHints(hints) {
  if (process.platform !== "linux") {
    return hints;
  }
  const systemdAvailable = await isSystemdUserServiceAvailable().catch(() => false);
  if (systemdAvailable) {
    return hints;
  }
  return [...hints, ...renderSystemdUnavailableHints({ wsl: await isWSL() })];
}
async function handleServiceNotLoaded(params) {
  const hints = await maybeAugmentSystemdHints(params.renderStartHints());
  params.emit({
    ok: true,
    result: "not-loaded",
    message: `${params.serviceNoun} service ${params.service.notLoadedText}.`,
    hints,
    service: buildDaemonServiceSnapshot(params.service, params.loaded),
  });
  if (!params.json) {
    defaultRuntime.log(`${params.serviceNoun} service ${params.service.notLoadedText}.`);
    for (const hint of hints) {
      defaultRuntime.log(`Start with: ${hint}`);
    }
  }
}
async function resolveServiceLoadedOrFail(params) {
  try {
    return await params.service.isLoaded({ env: process.env });
  } catch (err) {
    params.fail(`${params.serviceNoun} service check failed: ${String(err)}`);
    return null;
  }
}
export async function runServiceUninstall(params) {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "uninstall", json });
  if (resolveIsNixMode(process.env)) {
    fail("Nix mode detected; service uninstall is disabled.");
    return;
  }
  let loaded = false;
  try {
    loaded = await params.service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  if (loaded && params.stopBeforeUninstall) {
    try {
      await params.service.stop({ env: process.env, stdout });
    } catch {}
  }
  try {
    await params.service.uninstall({ env: process.env, stdout });
  } catch (err) {
    fail(`${params.serviceNoun} uninstall failed: ${String(err)}`);
    return;
  }
  loaded = false;
  try {
    loaded = await params.service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  if (loaded && params.assertNotLoadedAfterUninstall) {
    fail(`${params.serviceNoun} service still loaded after uninstall.`);
    return;
  }
  emit({
    ok: true,
    result: "uninstalled",
    service: buildDaemonServiceSnapshot(params.service, loaded),
  });
}
export async function runServiceStart(params) {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "start", json });
  const loaded = await resolveServiceLoadedOrFail({
    serviceNoun: params.serviceNoun,
    service: params.service,
    fail,
  });
  if (loaded === null) {
    return;
  }
  if (!loaded) {
    await handleServiceNotLoaded({
      serviceNoun: params.serviceNoun,
      service: params.service,
      loaded,
      renderStartHints: params.renderStartHints,
      json,
      emit,
    });
    return;
  }
  try {
    await params.service.restart({ env: process.env, stdout });
  } catch (err) {
    const hints = params.renderStartHints();
    fail(`${params.serviceNoun} start failed: ${String(err)}`, hints);
    return;
  }
  let started = true;
  try {
    started = await params.service.isLoaded({ env: process.env });
  } catch {
    started = true;
  }
  emit({
    ok: true,
    result: "started",
    service: buildDaemonServiceSnapshot(params.service, started),
  });
}
export async function runServiceStop(params) {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "stop", json });
  const loaded = await resolveServiceLoadedOrFail({
    serviceNoun: params.serviceNoun,
    service: params.service,
    fail,
  });
  if (loaded === null) {
    return;
  }
  if (!loaded) {
    emit({
      ok: true,
      result: "not-loaded",
      message: `${params.serviceNoun} service ${params.service.notLoadedText}.`,
      service: buildDaemonServiceSnapshot(params.service, loaded),
    });
    if (!json) {
      defaultRuntime.log(`${params.serviceNoun} service ${params.service.notLoadedText}.`);
    }
    return;
  }
  try {
    await params.service.stop({ env: process.env, stdout });
  } catch (err) {
    fail(`${params.serviceNoun} stop failed: ${String(err)}`);
    return;
  }
  let stopped = false;
  try {
    stopped = await params.service.isLoaded({ env: process.env });
  } catch {
    stopped = false;
  }
  emit({
    ok: true,
    result: "stopped",
    service: buildDaemonServiceSnapshot(params.service, stopped),
  });
}
export async function runServiceRestart(params) {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "restart", json });
  const loaded = await resolveServiceLoadedOrFail({
    serviceNoun: params.serviceNoun,
    service: params.service,
    fail,
  });
  if (loaded === null) {
    return false;
  }
  if (!loaded) {
    await handleServiceNotLoaded({
      serviceNoun: params.serviceNoun,
      service: params.service,
      loaded,
      renderStartHints: params.renderStartHints,
      json,
      emit,
    });
    return false;
  }
  const warnings = [];
  if (params.checkTokenDrift) {
    try {
      const command = await params.service.readCommand(process.env);
      const serviceToken = command?.environment?.GENOS_GATEWAY_TOKEN;
      const cfg = loadConfig();
      const configToken =
        cfg.gateway?.auth?.token ||
        process.env.GENOS_GATEWAY_TOKEN ||
        process.env.GENOS_GATEWAY_TOKEN;
      const driftIssue = checkTokenDrift({ serviceToken, configToken });
      if (driftIssue) {
        const warning = driftIssue.detail
          ? `${driftIssue.message} ${driftIssue.detail}`
          : driftIssue.message;
        warnings.push(warning);
        if (!json) {
          defaultRuntime.log(`
\u26A0\uFE0F  ${driftIssue.message}`);
          if (driftIssue.detail) {
            defaultRuntime.log(`   ${driftIssue.detail}\n`);
          }
        }
      }
    } catch {}
  }
  try {
    await params.service.restart({ env: process.env, stdout });
    let restarted = true;
    try {
      restarted = await params.service.isLoaded({ env: process.env });
    } catch {
      restarted = true;
    }
    emit({
      ok: true,
      result: "restarted",
      service: buildDaemonServiceSnapshot(params.service, restarted),
      warnings: warnings.length ? warnings : undefined,
    });
    return true;
  } catch (err) {
    const hints = params.renderStartHints();
    fail(`${params.serviceNoun} restart failed: ${String(err)}`, hints);
    return false;
  }
}
