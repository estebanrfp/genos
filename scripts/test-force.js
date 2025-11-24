let killGatewayListeners = function (port) {
    try {
      const killed = forceFreePort(port);
      if (killed.length > 0) {
        console.log(
          `freed port ${port}; terminated: ${killed.map((p) => `${p.command} (pid ${p.pid})`).join(", ")}`,
        );
      } else {
        console.log(`port ${port} already free`);
      }
      return killed;
    } catch (err) {
      console.error(`failed to free port ${port}: ${String(err)}`);
      return [];
    }
  },
  runTests = function () {
    const isolatedLock =
      process.env.GENOS_GATEWAY_LOCK ??
      path.join(os.tmpdir(), `genosos-gateway.lock.test.${Date.now()}`);
    const result = spawnSync("pnpm", ["vitest", "run"], {
      stdio: "inherit",
      env: {
        ...process.env,
        GENOS_GATEWAY_LOCK: isolatedLock,
      },
    });
    if (result.error) {
      console.error(`pnpm test failed to start: ${String(result.error)}`);
      process.exit(1);
    }
    process.exit(result.status ?? 1);
  },
  main = function () {
    const port = Number.parseInt(process.env.GENOS_GATEWAY_PORT ?? `${DEFAULT_PORT}`, 10);
    console.log(`\uD83E\uDDF9 test:force - clearing gateway on port ${port}`);
    const killed = killGatewayListeners(port);
    if (killed.length === 0) {
      console.log("no listeners to kill");
    }
    console.log("running pnpm test\u2026");
    runTests();
  };
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { forceFreePort } from "../src/cli/ports.js";
const DEFAULT_PORT = 18789;
main();
