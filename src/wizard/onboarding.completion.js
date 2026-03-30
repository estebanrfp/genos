let formatReloadHint = function (shell, profileHint) {
  if (shell === "powershell") {
    return "Restart your shell (or reload your PowerShell profile).";
  }
  return `Restart your shell or run: source ${profileHint}`;
};
import os from "node:os";
import path from "node:path";
import { resolveCliName } from "../cli/cli-name.js";
import {
  checkShellCompletionStatus,
  ensureCompletionCacheExists,
} from "../cli/completion-check.js";
import { installCompletion } from "../cli/completion-cli.js";
import { pathExists } from "../utils.js";
async function resolveProfileHint(shell) {
  const home = process.env.HOME || os.homedir();
  if (shell === "zsh") {
    return "~/.zshrc";
  }
  if (shell === "bash") {
    const bashrc = path.join(home, ".bashrc");
    return (await pathExists(bashrc)) ? "~/.bashrc" : "~/.bash_profile";
  }
  if (shell === "fish") {
    return "~/.config/fish/config.fish";
  }
  return "$PROFILE";
}
export async function setupOnboardingShellCompletion(params) {
  const deps = {
    resolveCliName,
    checkShellCompletionStatus,
    ensureCompletionCacheExists,
    installCompletion,
    ...params.deps,
  };
  const cliName = deps.resolveCliName();
  const completionStatus = await deps.checkShellCompletionStatus(cliName);
  if (completionStatus.usesSlowPattern) {
    const cacheGenerated = await deps.ensureCompletionCacheExists(cliName);
    if (cacheGenerated) {
      await deps.installCompletion(completionStatus.shell, true, cliName);
    }
    return;
  }
  if (completionStatus.profileInstalled && !completionStatus.cacheExists) {
    await deps.ensureCompletionCacheExists(cliName);
    return;
  }
  if (!completionStatus.profileInstalled) {
    const shouldInstall =
      params.flow === "quickstart"
        ? true
        : await params.prompter.confirm({
            message: `Enable ${completionStatus.shell} shell completion for ${cliName}?`,
            initialValue: true,
          });
    if (!shouldInstall) {
      return;
    }
    const cacheGenerated = await deps.ensureCompletionCacheExists(cliName);
    if (!cacheGenerated) {
      await params.prompter.note(
        `Failed to generate completion cache. Run \`${cliName} completion --install\` later.`,
        "Shell completion",
      );
      return;
    }
    await deps.installCompletion(completionStatus.shell, true, cliName);
    const profileHint = await resolveProfileHint(completionStatus.shell);
    await params.prompter.note(
      `Shell completion installed. ${formatReloadHint(completionStatus.shell, profileHint)}`,
      "Shell completion",
    );
  }
}
