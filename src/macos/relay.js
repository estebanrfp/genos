let hasFlag = function (args, flag) {
  return args.includes(flag);
};
import process from "node:process";
const BUNDLED_VERSION =
  (typeof __GENOS_VERSION__ === "string" && __GENOS_VERSION__) ||
  process.env.GENOS_BUNDLED_VERSION ||
  "0.0.0";
async function patchBunLongForProtobuf() {
  if (typeof process.versions.bun !== "string") {
    return;
  }
  const mod = await import("long");
  const Long = mod.default ?? mod;
  globalThis.Long = Long;
}
async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, "--version") || hasFlag(args, "-V") || hasFlag(args, "-v")) {
    console.log(BUNDLED_VERSION);
    process.exit(0);
  }
  const { parseRelaySmokeTest, runRelaySmokeTest } = await import("./relay-smoke.js");
  const smokeTest = parseRelaySmokeTest(args, process.env);
  if (smokeTest) {
    try {
      await runRelaySmokeTest(smokeTest);
      process.exit(0);
    } catch (err) {
      console.error(`Relay smoke test failed (${smokeTest}):`, err);
      process.exit(1);
    }
  }
  await patchBunLongForProtobuf();
  const { loadDotEnv } = await import("../infra/dotenv.js");
  loadDotEnv({ quiet: true });
  const { ensureGenosOSCliOnPath } = await import("../infra/path-env.js");
  ensureGenosOSCliOnPath();
  const { enableConsoleCapture } = await import("../logging.js");
  enableConsoleCapture();
  const { assertSupportedRuntime } = await import("../infra/runtime-guard.js");
  assertSupportedRuntime();
  const { formatUncaughtError } = await import("../infra/errors.js");
  const { installUnhandledRejectionHandler } = await import("../infra/unhandled-rejections.js");
  const { buildProgram } = await import("../cli/program.js");
  const program = buildProgram();
  installUnhandledRejectionHandler();
  process.on("uncaughtException", (error) => {
    console.error("[genosos] Uncaught exception:", formatUncaughtError(error));
    process.exit(1);
  });
  await program.parseAsync(process.argv);
}
main().catch((err) => {
  console.error("[genosos] Relay failed:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
