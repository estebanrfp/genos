import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveAgentConfig,
  resolveAgentDir,
  resolveEffectiveModelFallbacks,
  resolveAgentModelFallbacksOverride,
  resolveAgentModelPrimary,
  resolveAgentWorkspaceDir,
} from "./agent-scope.js";
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("resolveAgentConfig", () => {
  it("should return undefined when no agents config exists", () => {
    const cfg = {};
    const result = resolveAgentConfig(cfg, "main");
    expect(result).toBeUndefined();
  });
  it("should return undefined when agent id does not exist", () => {
    const cfg = {
      agents: {
        list: [{ id: "main", workspace: "~/genosos" }],
      },
    };
    const result = resolveAgentConfig(cfg, "nonexistent");
    expect(result).toBeUndefined();
  });
  it("should return basic agent config", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "main",
            name: "Main Agent",
            workspace: "~/genosos",
            agentDir: "~/.genosv1/agents/main",
            model: "anthropic/claude-opus-4",
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "main");
    expect(result).toEqual({
      name: "Main Agent",
      workspace: "~/genosos",
      agentDir: "~/.genosv1/agents/main",
      model: "anthropic/claude-opus-4",
      identity: undefined,
      groupChat: undefined,
      subagents: undefined,
      sandbox: undefined,
      tools: undefined,
    });
  });
  it("supports per-agent model primary+fallbacks", () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4",
            fallbacks: ["openai/gpt-4.1"],
          },
        },
        list: [
          {
            id: "linus",
            model: {
              primary: "anthropic/claude-opus-4",
              fallbacks: ["openai/gpt-5.2"],
            },
          },
        ],
      },
    };
    expect(resolveAgentModelPrimary(cfg, "linus")).toBe("anthropic/claude-opus-4");
    expect(resolveAgentModelFallbacksOverride(cfg, "linus")).toEqual(["openai/gpt-5.2"]);
    const cfgNoOverride = {
      agents: {
        list: [
          {
            id: "linus",
            model: {
              primary: "anthropic/claude-opus-4",
            },
          },
        ],
      },
    };
    expect(resolveAgentModelFallbacksOverride(cfgNoOverride, "linus")).toBe(undefined);
    const cfgDisable = {
      agents: {
        list: [
          {
            id: "linus",
            model: {
              primary: "anthropic/claude-opus-4",
              fallbacks: [],
            },
          },
        ],
      },
    };
    expect(resolveAgentModelFallbacksOverride(cfgDisable, "linus")).toEqual([]);
    expect(
      resolveEffectiveModelFallbacks({
        cfg,
        agentId: "linus",
        hasSessionModelOverride: false,
      }),
    ).toEqual(["openai/gpt-5.2"]);
    expect(
      resolveEffectiveModelFallbacks({
        cfg,
        agentId: "linus",
        hasSessionModelOverride: true,
      }),
    ).toEqual(["openai/gpt-5.2"]);
    expect(
      resolveEffectiveModelFallbacks({
        cfg: cfgNoOverride,
        agentId: "linus",
        hasSessionModelOverride: true,
      }),
    ).toEqual([]);
    const cfgInheritDefaults = {
      agents: {
        defaults: {
          model: {
            fallbacks: ["openai/gpt-4.1"],
          },
        },
        list: [
          {
            id: "linus",
            model: {
              primary: "anthropic/claude-opus-4",
            },
          },
        ],
      },
    };
    expect(
      resolveEffectiveModelFallbacks({
        cfg: cfgInheritDefaults,
        agentId: "linus",
        hasSessionModelOverride: true,
      }),
    ).toEqual(["openai/gpt-4.1"]);
    expect(
      resolveEffectiveModelFallbacks({
        cfg: cfgDisable,
        agentId: "linus",
        hasSessionModelOverride: true,
      }),
    ).toEqual([]);
  });
  it("should return agent-specific sandbox config", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "work",
            workspace: "~/genosos-work",
            sandbox: {
              mode: "all",
              scope: "agent",
              perSession: false,
              workspaceAccess: "ro",
              workspaceRoot: "~/sandboxes",
            },
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "work");
    expect(result?.sandbox).toEqual({
      mode: "all",
      scope: "agent",
      perSession: false,
      workspaceAccess: "ro",
      workspaceRoot: "~/sandboxes",
    });
  });
  it("should return agent-specific tools config", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "restricted",
            workspace: "~/genosos-restricted",
            tools: {
              allow: ["read"],
              deny: ["exec", "write", "edit"],
              elevated: {
                enabled: false,
                allowFrom: { whatsapp: ["+15555550123"] },
              },
            },
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "restricted");
    expect(result?.tools).toEqual({
      allow: ["read"],
      deny: ["exec", "write", "edit"],
      elevated: {
        enabled: false,
        allowFrom: { whatsapp: ["+15555550123"] },
      },
    });
  });
  it("should return both sandbox and tools config", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "family",
            workspace: "~/genosos-family",
            sandbox: {
              mode: "all",
              scope: "agent",
            },
            tools: {
              allow: ["read"],
              deny: ["exec"],
            },
          },
        ],
      },
    };
    const result = resolveAgentConfig(cfg, "family");
    expect(result?.sandbox?.mode).toBe("all");
    expect(result?.tools?.allow).toEqual(["read"]);
  });
  it("should normalize agent id", () => {
    const cfg = {
      agents: {
        list: [{ id: "main", workspace: "~/genosos" }],
      },
    };
    const result = resolveAgentConfig(cfg, "");
    expect(result).toBeDefined();
    expect(result?.workspace).toBe("~/genosos");
  });
  it("uses GENOS_HOME for default agent workspace", () => {
    const home = path.join(path.sep, "srv", "genosos-home");
    vi.stubEnv("GENOS_HOME", home);
    const workspace = resolveAgentWorkspaceDir({}, "main");
    expect(workspace).toBe(path.join(path.resolve(home), ".genosv1", "workspace"));
  });
  it("uses GENOS_HOME for default agentDir", () => {
    const home = path.join(path.sep, "srv", "genosos-home");
    vi.stubEnv("GENOS_HOME", home);
    vi.stubEnv("GENOS_STATE_DIR", "");
    const agentDir = resolveAgentDir({}, "main");
    expect(agentDir).toBe(path.join(path.resolve(home), ".genosv1", "agents", "main", "agent"));
  });
});
