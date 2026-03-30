let formatConfigIssues = function (issues) {
  return issues.map((issue) => `- ${issue.path || "<root>"}: ${issue.message}`);
};
import { loadAndMaybeMigrateDoctorConfig } from "../../config/config-guard-flow.js";
import { readConfigFileSnapshot, writeConfigFile } from "../../config/config.js";
import { colorize, isRich, theme } from "../../terminal/theme.js";
import { shortenHomePath } from "../../utils.js";
import { shouldMigrateStateFromPath } from "../argv.js";
import { formatCliCommand } from "../command-format.js";
const ALLOWED_INVALID_COMMANDS = new Set(["doctor", "logs", "health", "help", "status"]);
const ALLOWED_INVALID_GATEWAY_SUBCOMMANDS = new Set([
  "status",
  "probe",
  "health",
  "discover",
  "call",
  "install",
  "uninstall",
  "start",
  "stop",
  "restart",
]);
let didRunDoctorConfigFlow = false;
let configSnapshotPromise = null;
async function getConfigSnapshot() {
  if (process.env.VITEST === "true") {
    return readConfigFileSnapshot();
  }
  configSnapshotPromise ??= readConfigFileSnapshot();
  return configSnapshotPromise;
}
export async function ensureConfigReady(params) {
  const commandPath = params.commandPath ?? [];
  if (!didRunDoctorConfigFlow && shouldMigrateStateFromPath(commandPath)) {
    didRunDoctorConfigFlow = true;
    const doctorResult = await loadAndMaybeMigrateDoctorConfig({
      options: { nonInteractive: true },
      confirm: async () => false,
    });
    if (doctorResult.shouldWriteConfig) {
      await writeConfigFile(doctorResult.cfg);
      configSnapshotPromise = null;
    }
  }
  const snapshot = await getConfigSnapshot();
  const commandName = commandPath[0];
  const subcommandName = commandPath[1];
  const allowInvalid = commandName
    ? ALLOWED_INVALID_COMMANDS.has(commandName) ||
      (commandName === "gateway" &&
        subcommandName &&
        ALLOWED_INVALID_GATEWAY_SUBCOMMANDS.has(subcommandName))
    : false;
  const issues = snapshot.exists && !snapshot.valid ? formatConfigIssues(snapshot.issues) : [];
  const legacyIssues =
    snapshot.legacyIssues.length > 0
      ? snapshot.legacyIssues.map((issue) => `- ${issue.path}: ${issue.message}`)
      : [];
  const invalid = snapshot.exists && !snapshot.valid;
  if (!invalid) {
    return;
  }
  const rich = isRich();
  const muted = (value) => colorize(rich, theme.muted, value);
  const error = (value) => colorize(rich, theme.error, value);
  const heading = (value) => colorize(rich, theme.heading, value);
  const commandText = (value) => colorize(rich, theme.command, value);
  params.runtime.error(heading("Config invalid"));
  params.runtime.error(`${muted("File:")} ${muted(shortenHomePath(snapshot.path))}`);
  if (issues.length > 0) {
    params.runtime.error(muted("Problem:"));
    params.runtime.error(issues.map((issue) => `  ${error(issue)}`).join("\n"));
  }
  if (legacyIssues.length > 0) {
    params.runtime.error(muted("Legacy config keys detected:"));
    params.runtime.error(legacyIssues.map((issue) => `  ${error(issue)}`).join("\n"));
  }
  params.runtime.error("");
  params.runtime.error(`${muted("Run:")} ${commandText(formatCliCommand("genosos doctor --fix"))}`);
  if (!allowInvalid) {
    params.runtime.exit(1);
  }
}
