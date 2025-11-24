import process from "node:process";
import { applyCliProfileEnv, parseCliProfileArgs } from "./cli/profile.js";
import { normalizeWindowsArgv } from "./cli/windows-argv.js";
import { normalizeEnv } from "./infra/env.js";
process.title = "genosos";
normalizeEnv();
if (process.argv.includes("--no-color")) {
  process.env.NO_COLOR = "1";
  process.env.FORCE_COLOR = "0";
}
process.argv = normalizeWindowsArgv(process.argv);
const parsed = parseCliProfileArgs(process.argv);
if (!parsed.ok) {
  console.error(`[genosos] ${parsed.error}`);
  process.exit(2);
}
if (parsed.profile) {
  applyCliProfileEnv({ profile: parsed.profile });
  process.argv = parsed.argv;
}
const { runCli } = await import("./cli/run-main.js");
runCli(process.argv).catch((error) => {
  console.error(
    "[genosos] Failed to start CLI:",
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
