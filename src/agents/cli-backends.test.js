import { describe, expect, it } from "vitest";
import { resolveCliBackendConfig } from "./cli-backends.js";
describe("resolveCliBackendConfig reliability merge", () => {
  it("deep-merges reliability watchdog overrides for codex", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "codex-cli": {
              command: "codex",
              reliability: {
                watchdog: {
                  resume: {
                    noOutputTimeoutMs: 42000,
                  },
                },
              },
            },
          },
        },
      },
    };
    const resolved = resolveCliBackendConfig("codex-cli", cfg);
    expect(resolved).not.toBeNull();
    expect(resolved?.config.reliability?.watchdog?.resume?.noOutputTimeoutMs).toBe(42000);
    expect(resolved?.config.reliability?.watchdog?.resume?.noOutputTimeoutRatio).toBe(0.3);
    expect(resolved?.config.reliability?.watchdog?.resume?.minMs).toBe(60000);
    expect(resolved?.config.reliability?.watchdog?.resume?.maxMs).toBe(180000);
    expect(resolved?.config.reliability?.watchdog?.fresh?.noOutputTimeoutRatio).toBe(0.8);
  });
});
