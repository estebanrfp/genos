import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
export function mockSessionsConfig() {
  vi.mock("../config/config.js", async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      loadConfig: () => ({
        agents: {
          defaults: {
            model: { primary: "pi:opus" },
            models: { "pi:opus": {} },
            contextTokens: 32000,
          },
        },
      }),
    };
  });
}
export function makeRuntime(params) {
  const logs = [];
  const errors = [];
  const throwOnError = params?.throwOnError ?? false;
  return {
    runtime: {
      log: (msg) => logs.push(String(msg)),
      error: (msg) => {
        errors.push(String(msg));
        if (throwOnError) {
          throw new Error(String(msg));
        }
      },
      exit: (code) => {
        throw new Error(`exit ${code}`);
      },
    },
    logs,
    errors,
  };
}
export function writeStore(data, prefix = "sessions") {
  const file = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
export async function runSessionsJson(run, store, options) {
  const { runtime, logs } = makeRuntime();
  try {
    await run(
      {
        store,
        json: true,
        active: options?.active,
      },
      runtime,
    );
  } finally {
    fs.rmSync(store, { force: true });
  }
  return JSON.parse(logs[0] ?? "{}");
}
