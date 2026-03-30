let createPrompter = function (confirmValue = false) {
    return {
      confirm: vi.fn(async () => confirmValue),
      note: vi.fn(async () => {}),
    };
  },
  createDeps = function () {
    const deps = {
      resolveCliName: () => "genosos",
      checkShellCompletionStatus: vi.fn(async (_binName) => ({
        shell: "zsh",
        profileInstalled: false,
        cacheExists: false,
        cachePath: "/tmp/genosos.zsh",
        usesSlowPattern: false,
      })),
      ensureCompletionCacheExists: vi.fn(async (_binName) => true),
      installCompletion: vi.fn(async () => {}),
    };
    return deps;
  };
import { describe, expect, it, vi } from "vitest";
import { setupOnboardingShellCompletion } from "./onboarding.completion.js";
describe("setupOnboardingShellCompletion", () => {
  it("QuickStart: installs without prompting", async () => {
    const prompter = createPrompter();
    const deps = createDeps();
    await setupOnboardingShellCompletion({ flow: "quickstart", prompter, deps });
    expect(prompter.confirm).not.toHaveBeenCalled();
    expect(deps.ensureCompletionCacheExists).toHaveBeenCalledWith("genosos");
    expect(deps.installCompletion).toHaveBeenCalledWith("zsh", true, "genosos");
    expect(prompter.note).toHaveBeenCalled();
  });
  it("Advanced: prompts; skip means no install", async () => {
    const prompter = createPrompter();
    const deps = createDeps();
    await setupOnboardingShellCompletion({ flow: "advanced", prompter, deps });
    expect(prompter.confirm).toHaveBeenCalledTimes(1);
    expect(deps.ensureCompletionCacheExists).not.toHaveBeenCalled();
    expect(deps.installCompletion).not.toHaveBeenCalled();
    expect(prompter.note).not.toHaveBeenCalled();
  });
});
