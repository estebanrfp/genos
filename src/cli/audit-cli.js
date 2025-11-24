// GenosOS — Esteban & Nyx 🦀🌙
import { STATE_DIR } from "../config/paths.js";
import { verifyAuditLog, tailAuditLog } from "../infra/audit-log.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import { formatHelpExamples } from "./help-format.js";

/**
 * Register audit CLI subcommands.
 * @param {import("commander").Command} program
 */
export function registerAuditCli(program) {
  const audit = program
    .command("audit")
    .description("Verify and inspect the tamper-evident audit log")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["genosos audit verify", "Verify the integrity of the audit log chain."],
          ["genosos audit tail", "Show the last 20 audit log entries."],
          ["genosos audit tail --lines 50", "Show the last 50 entries."],
        ])}\n`,
    );

  audit
    .command("verify")
    .description("Verify the integrity of the audit log HMAC chain")
    .action(() => {
      const rich = isRich();
      const result = verifyAuditLog(STATE_DIR);
      if (result.valid) {
        defaultRuntime.log(
          rich
            ? theme.success(`Audit log valid: ${result.entries} entries, chain intact.`)
            : `Audit log valid: ${result.entries} entries, chain intact.`,
        );
      } else {
        defaultRuntime.log(
          rich
            ? theme.error(`Audit log TAMPERED at entry ${result.broken} of ${result.entries}.`)
            : `Audit log TAMPERED at entry ${result.broken} of ${result.entries}.`,
        );
        process.exitCode = 1;
      }
    });

  audit
    .command("tail")
    .description("Show the last N audit log entries")
    .option("--lines <n>", "Number of entries to show", "20")
    .option("--json", "Output raw JSON")
    .action((opts) => {
      const n = parseInt(opts.lines, 10) || 20;
      const entries = tailAuditLog(n, STATE_DIR);
      const rich = isRich();

      if (entries.length === 0) {
        defaultRuntime.log(
          rich ? theme.muted("No audit entries found.") : "No audit entries found.",
        );
        return;
      }

      if (opts.json) {
        defaultRuntime.log(JSON.stringify(entries, null, 2));
        return;
      }

      for (const entry of entries) {
        const ts = entry.ts?.slice(0, 19).replace("T", " ") ?? "?";
        const details = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
        defaultRuntime.log(
          rich
            ? `${theme.muted(ts)} ${theme.accent(entry.action)}${details}`
            : `${ts} ${entry.action}${details}`,
        );
      }
    });
}
