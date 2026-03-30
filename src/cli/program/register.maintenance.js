import { dashboardCommand } from "../../commands/dashboard.js";
import { resetCommand } from "../../commands/reset.js";
import { uninstallCommand } from "../../commands/uninstall.js";
import { runDoctor } from "../../doctor/engine.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
export function registerMaintenanceCommands(program) {
  program
    .command("doctor")
    .description("Autonomous health check — diagnoses and auto-fixes system issues")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/doctor", "docs.genos.ai/cli/doctor")}\n`,
    )
    .option("--json", "Output raw JSON report", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const report = await runDoctor();
        if (opts.json) {
          defaultRuntime.log(JSON.stringify(report, null, 2));
          defaultRuntime.exit(0);
          return;
        }
        const { summary, checks } = report;
        defaultRuntime.log("");
        defaultRuntime.log(theme.heading("GenosOS Doctor"));
        defaultRuntime.log("");
        for (const check of checks) {
          const issues = check.findings.filter((f) => f.severity !== "ok");
          const oks = check.findings.filter((f) => f.severity === "ok");
          if (issues.length === 0 && oks.length > 0) {
            defaultRuntime.log(`  ${theme.success("✓")} ${check.label}`);
            continue;
          }
          for (const f of check.findings) {
            const icon =
              f.severity === "critical"
                ? theme.error("✗")
                : f.severity === "warn"
                  ? theme.warn("!")
                  : f.severity === "ok"
                    ? theme.success("✓")
                    : theme.muted("·");
            const fixedTag = f.fixed ? theme.success(" [fixed]") : "";
            defaultRuntime.log(`  ${icon} ${f.title}${fixedTag}`);
            if (f.detail && f.severity !== "ok") {
              defaultRuntime.log(`    ${theme.muted(f.detail)}`);
            }
            if (f.remediation && !f.fixed) {
              defaultRuntime.log(`    ${theme.muted("→ " + f.remediation)}`);
            }
          }
        }
        defaultRuntime.log("");
        const parts = [];
        if (summary.critical > 0) {
          parts.push(theme.error(`${summary.critical} critical`));
        }
        if (summary.warnings > 0) {
          parts.push(theme.warn(`${summary.warnings} warnings`));
        }
        if (summary.fixed > 0) {
          parts.push(theme.success(`${summary.fixed} auto-fixed`));
        }
        if (summary.ok > 0) {
          parts.push(`${summary.ok} ok`);
        }
        defaultRuntime.log(`  ${parts.join(", ")}`);
        defaultRuntime.log("");
        defaultRuntime.exit(summary.critical > 0 ? 1 : 0);
      });
    });
  program
    .command("dashboard")
    .description("Open the Control UI with your current token")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/dashboard", "docs.genos.ai/cli/dashboard")}\n`,
    )
    .option("--no-open", "Print URL but do not launch a browser", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await dashboardCommand(defaultRuntime, {
          noOpen: Boolean(opts.noOpen),
        });
      });
    });
  program
    .command("reset")
    .description("Reset local config/state (keeps the CLI installed)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/reset", "docs.genos.ai/cli/reset")}\n`,
    )
    .option("--scope <scope>", "config|config+creds+sessions|full (default: interactive prompt)")
    .option("--yes", "Skip confirmation prompts", false)
    .option("--non-interactive", "Disable prompts (requires --scope + --yes)", false)
    .option("--dry-run", "Print actions without removing files", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await resetCommand(defaultRuntime, {
          scope: opts.scope,
          yes: Boolean(opts.yes),
          nonInteractive: Boolean(opts.nonInteractive),
          dryRun: Boolean(opts.dryRun),
        });
      });
    });
  program
    .command("uninstall")
    .description("Uninstall the gateway service + local data (CLI remains)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/uninstall", "docs.genos.ai/cli/uninstall")}\n`,
    )
    .option("--service", "Remove the gateway service", false)
    .option("--state", "Remove state + config", false)
    .option("--workspace", "Remove workspace dirs", false)
    .option("--app", "Remove the macOS app", false)
    .option("--all", "Remove service + state + workspace + app", false)
    .option("--yes", "Skip confirmation prompts", false)
    .option("--non-interactive", "Disable prompts (requires --yes)", false)
    .option("--dry-run", "Print actions without removing files", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await uninstallCommand(defaultRuntime, {
          service: Boolean(opts.service),
          state: Boolean(opts.state),
          workspace: Boolean(opts.workspace),
          app: Boolean(opts.app),
          all: Boolean(opts.all),
          yes: Boolean(opts.yes),
          nonInteractive: Boolean(opts.nonInteractive),
          dryRun: Boolean(opts.dryRun),
        });
      });
    });
}
