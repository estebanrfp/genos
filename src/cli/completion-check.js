import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveCliName } from "../cli/cli-name.js";
import {
  completionCacheExists,
  installCompletion,
  isCompletionInstalled,
  resolveCompletionCachePath,
  resolveShellFromEnv,
  usesSlowDynamicCompletion,
} from "../cli/completion-cli.js";
import { resolveGenosOSPackageRoot } from "../infra/genosos-root.js";
import { note } from "../terminal/note.js";
async function generateCompletionCache() {
  const root = await resolveGenosOSPackageRoot({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });
  if (!root) {
    return false;
  }
  const binPath = path.join(root, "genosos.mjs");
  const result = spawnSync(process.execPath, [binPath, "completion", "--write-state"], {
    cwd: root,
    env: process.env,
    encoding: "utf-8",
  });
  return result.status === 0;
}
export async function checkShellCompletionStatus(binName = "genosos") {
  const shell = resolveShellFromEnv();
  const profileInstalled = await isCompletionInstalled(shell, binName);
  const cacheExists = await completionCacheExists(shell, binName);
  const cachePath = resolveCompletionCachePath(shell, binName);
  const usesSlowPattern = await usesSlowDynamicCompletion(shell, binName);
  return {
    shell,
    profileInstalled,
    cacheExists,
    cachePath,
    usesSlowPattern,
  };
}
export async function doctorShellCompletion(runtime, prompter, options = {}) {
  const cliName = resolveCliName();
  const status = await checkShellCompletionStatus(cliName);
  if (status.usesSlowPattern) {
    note(
      `Your ${status.shell} profile uses slow dynamic completion (source <(...)).\nUpgrading to cached completion for faster shell startup...`,
      "Shell completion",
    );
    if (!status.cacheExists) {
      const generated = await generateCompletionCache();
      if (!generated) {
        note(
          `Failed to generate completion cache. Run \`${cliName} completion --write-state\` manually.`,
          "Shell completion",
        );
        return;
      }
    }
    await installCompletion(status.shell, true, cliName);
    note(
      `Shell completion upgraded. Restart your shell or run: source ~/.${status.shell === "zsh" ? "zshrc" : status.shell === "bash" ? "bashrc" : "config/fish/config.fish"}`,
      "Shell completion",
    );
    return;
  }
  if (status.profileInstalled && !status.cacheExists) {
    note(
      `Shell completion is configured in your ${status.shell} profile but the cache is missing.\nRegenerating cache...`,
      "Shell completion",
    );
    const generated = await generateCompletionCache();
    if (generated) {
      note(`Completion cache regenerated at ${status.cachePath}`, "Shell completion");
    } else {
      note(
        `Failed to regenerate completion cache. Run \`${cliName} completion --write-state\` manually.`,
        "Shell completion",
      );
    }
    return;
  }
  if (!status.profileInstalled) {
    if (options.nonInteractive) {
      return;
    }
    const shouldInstall = await prompter.confirm({
      message: `Enable ${status.shell} shell completion for ${cliName}?`,
      initialValue: true,
    });
    if (shouldInstall) {
      const generated = await generateCompletionCache();
      if (!generated) {
        note(
          `Failed to generate completion cache. Run \`${cliName} completion --write-state\` manually.`,
          "Shell completion",
        );
        return;
      }
      await installCompletion(status.shell, true, cliName);
      note(
        `Shell completion installed. Restart your shell or run: source ~/.${status.shell === "zsh" ? "zshrc" : status.shell === "bash" ? "bashrc" : "config/fish/config.fish"}`,
        "Shell completion",
      );
    }
  }
}
export async function ensureCompletionCacheExists(binName = "genosos") {
  const shell = resolveShellFromEnv();
  const cacheExists = await completionCacheExists(shell, binName);
  if (cacheExists) {
    return true;
  }
  return generateCompletionCache();
}
