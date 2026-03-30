import { Writable } from "node:stream";
import { defaultRuntime } from "../../runtime.js";
export function emitDaemonActionJson(payload) {
  defaultRuntime.log(JSON.stringify(payload, null, 2));
}
export function buildDaemonServiceSnapshot(service, loaded) {
  return {
    label: service.label,
    loaded,
    loadedText: service.loadedText,
    notLoadedText: service.notLoadedText,
  };
}
export function createNullWriter() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}
export function createDaemonActionContext(params) {
  const warnings = [];
  const stdout = params.json ? createNullWriter() : process.stdout;
  const emit = (payload) => {
    if (!params.json) {
      return;
    }
    emitDaemonActionJson({
      action: params.action,
      ...payload,
      warnings: payload.warnings ?? (warnings.length ? warnings : undefined),
    });
  };
  const fail = (message, hints) => {
    if (params.json) {
      emit({
        ok: false,
        error: message,
        hints,
      });
    } else {
      defaultRuntime.error(message);
      if (hints?.length) {
        for (const hint of hints) {
          defaultRuntime.log(`Tip: ${hint}`);
        }
      }
    }
    defaultRuntime.exit(1);
  };
  return { stdout, warnings, emit, fail };
}
export async function installDaemonServiceAndEmit(params) {
  try {
    await params.install();
  } catch (err) {
    params.fail(`${params.serviceNoun} install failed: ${String(err)}`);
    return;
  }
  let installed = true;
  try {
    installed = await params.service.isLoaded({ env: process.env });
  } catch {
    installed = true;
  }
  params.emit({
    ok: true,
    result: "installed",
    service: buildDaemonServiceSnapshot(params.service, installed),
    warnings: params.warnings.length ? params.warnings : undefined,
  });
}
