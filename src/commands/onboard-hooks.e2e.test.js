import { describe, expect, it, vi, beforeEach } from "vitest";
import { setupInternalHooks } from "./onboard-hooks.js";
vi.mock("../hooks/hooks-status.js", () => ({
  buildWorkspaceHookStatus: vi.fn(),
}));
vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/mock/workspace"),
  resolveDefaultAgentId: vi.fn().mockReturnValue("main"),
}));
describe("onboard-hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const createMockPrompter = (multiselectValue) => ({
    confirm: vi.fn().mockResolvedValue(true),
    note: vi.fn().mockResolvedValue(undefined),
    intro: vi.fn().mockResolvedValue(undefined),
    outro: vi.fn().mockResolvedValue(undefined),
    text: vi.fn().mockResolvedValue(""),
    select: vi.fn().mockResolvedValue(""),
    multiselect: vi.fn().mockResolvedValue(multiselectValue),
    progress: vi.fn().mockReturnValue({
      stop: vi.fn(),
      update: vi.fn(),
    }),
  });
  const createMockRuntime = () => ({
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  });
  const createMockHook = (params, eligible) => ({
    ...params,
    source: "genosos-bundled",
    pluginId: undefined,
    homepage: undefined,
    always: false,
    disabled: false,
    eligible,
    managedByPlugin: false,
    requirements: {
      bins: [],
      anyBins: [],
      env: [],
      config: ["workspace.dir"],
      os: [],
    },
    missing: {
      bins: [],
      anyBins: [],
      env: [],
      config: eligible ? [] : ["workspace.dir"],
      os: [],
    },
    configChecks: [],
    install: [],
  });
  const createMockHookReport = (eligible = true) => ({
    workspaceDir: "/mock/workspace",
    managedHooksDir: "/mock/.genos/hooks",
    hooks: [
      createMockHook(
        {
          name: "session-memory",
          description: "Save session context to memory when /new command is issued",
          filePath: "/mock/workspace/hooks/session-memory/HOOK.md",
          baseDir: "/mock/workspace/hooks/session-memory",
          handlerPath: "/mock/workspace/hooks/session-memory/handler.js",
          hookKey: "session-memory",
          emoji: "\uD83D\uDCBE",
          events: ["command:new"],
        },
        eligible,
      ),
      createMockHook(
        {
          name: "command-logger",
          description: "Log all command events to a centralized audit file",
          filePath: "/mock/workspace/hooks/command-logger/HOOK.md",
          baseDir: "/mock/workspace/hooks/command-logger",
          handlerPath: "/mock/workspace/hooks/command-logger/handler.js",
          hookKey: "command-logger",
          emoji: "\uD83D\uDCDD",
          events: ["command"],
        },
        eligible,
      ),
    ],
  });
  async function runSetupInternalHooks(params) {
    const { buildWorkspaceHookStatus } = await import("../hooks/hooks-status.js");
    vi.mocked(buildWorkspaceHookStatus).mockReturnValue(
      createMockHookReport(params.eligible ?? true),
    );
    const cfg = params.cfg ?? {};
    const prompter = createMockPrompter(params.selected);
    const runtime = createMockRuntime();
    const result = await setupInternalHooks(cfg, runtime, prompter);
    return { result, cfg, prompter };
  }
  describe("setupInternalHooks", () => {
    it("should enable hooks when user selects them", async () => {
      const { result, prompter } = await runSetupInternalHooks({
        selected: ["session-memory"],
      });
      expect(result.hooks?.internal?.enabled).toBe(true);
      expect(result.hooks?.internal?.entries).toEqual({
        "session-memory": { enabled: true },
      });
      expect(prompter.note).toHaveBeenCalledTimes(2);
      expect(prompter.multiselect).toHaveBeenCalledWith({
        message: "Enable hooks?",
        options: [
          { value: "__skip__", label: "Skip for now" },
          {
            value: "session-memory",
            label: "\uD83D\uDCBE session-memory",
            hint: "Save session context to memory when /new command is issued",
          },
          {
            value: "command-logger",
            label: "\uD83D\uDCDD command-logger",
            hint: "Log all command events to a centralized audit file",
          },
        ],
      });
    });
    it("should not enable hooks when user skips", async () => {
      const { result, prompter } = await runSetupInternalHooks({
        selected: ["__skip__"],
      });
      expect(result.hooks?.internal).toBeUndefined();
      expect(prompter.note).toHaveBeenCalledTimes(1);
    });
    it("should handle no eligible hooks", async () => {
      const { result, cfg, prompter } = await runSetupInternalHooks({
        selected: [],
        eligible: false,
      });
      expect(result).toEqual(cfg);
      expect(prompter.multiselect).not.toHaveBeenCalled();
      expect(prompter.note).toHaveBeenCalledWith(
        "No eligible hooks found. You can configure hooks later in your config.",
        "No Hooks Available",
      );
    });
    it("should preserve existing hooks config when enabled", async () => {
      const cfg = {
        hooks: {
          enabled: true,
          path: "/webhook",
          token: "existing-token",
        },
      };
      const { result } = await runSetupInternalHooks({
        selected: ["session-memory"],
        cfg,
      });
      expect(result.hooks?.enabled).toBe(true);
      expect(result.hooks?.path).toBe("/webhook");
      expect(result.hooks?.token).toBe("existing-token");
      expect(result.hooks?.internal?.enabled).toBe(true);
      expect(result.hooks?.internal?.entries).toEqual({
        "session-memory": { enabled: true },
      });
    });
    it("should preserve existing config when user skips", async () => {
      const cfg = {
        agents: { defaults: { workspace: "/workspace" } },
      };
      const { result } = await runSetupInternalHooks({
        selected: ["__skip__"],
        cfg,
      });
      expect(result).toEqual(cfg);
      expect(result.agents?.defaults?.workspace).toBe("/workspace");
    });
    it("should show informative notes to user", async () => {
      const { prompter } = await runSetupInternalHooks({
        selected: ["session-memory"],
      });
      const noteCalls = prompter.note.mock.calls;
      expect(noteCalls).toHaveLength(2);
      expect(noteCalls[0][0]).toContain("Hooks let you automate actions");
      expect(noteCalls[0][0]).toContain("automate actions");
      expect(noteCalls[1][0]).toContain("Enabled 1 hook: session-memory");
      expect(noteCalls[1][0]).toMatch(/(?:genosos|genosos)( --profile isolated)? hooks list/);
    });
  });
});
