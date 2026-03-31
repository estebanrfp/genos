import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import { createGenosOSCodingTools } from "./pi-tools.js";
describe("Agent-specific tool filtering", () => {
  const sandboxFsBridgeStub = {
    resolvePath: () => ({
      hostPath: "/tmp/sandbox",
      relativePath: "",
      containerPath: "/workspace",
    }),
    readFile: async () => Buffer.from(""),
    writeFile: async () => {},
    mkdirp: async () => {},
    remove: async () => {},
    rename: async () => {},
    stat: async () => null,
  };
  async function withApplyPatchEscapeCase(opts, run) {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-pi-tools-"));
    const escapedPath = path.join(
      path.dirname(workspaceDir),
      `escaped-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    );
    const relativeEscape = path.relative(workspaceDir, escapedPath);
    try {
      const cfg = {
        tools: {
          allow: ["read", "exec"],
          exec: {
            applyPatch: {
              enabled: true,
              ...(opts.workspaceOnly === false ? { workspaceOnly: false } : {}),
            },
          },
        },
      };
      const tools = createGenosOSCodingTools({
        config: cfg,
        sessionKey: "agent:default:main",
        workspaceDir,
        agentDir: "/tmp/agent",
        modelProvider: "openai",
        modelId: "gpt-5.2",
      });
      const applyPatchTool = tools.find((t) => t.name === "apply_patch");
      if (!applyPatchTool) {
        throw new Error("apply_patch tool missing");
      }
      const patch = `*** Begin Patch
*** Add File: ${relativeEscape}
+escaped
*** End Patch`;
      await run({
        applyPatchTool,
        escapedPath,
        patch,
      });
    } finally {
      await fs.rm(escapedPath, { force: true });
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  }
  it("should apply global tool policy when no agent-specific policy exists", () => {
    const cfg = {
      tools: {
        allow: ["read", "write"],
        deny: ["bash"],
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/genosos",
          },
        ],
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("apply_patch");
  });
  it("should keep global tool policy when agent only sets tools.elevated", () => {
    const cfg = {
      tools: {
        deny: ["write"],
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/genosos",
            tools: {
              elevated: {
                enabled: true,
                allowFrom: { whatsapp: ["+15555550123"] },
              },
            },
          },
        ],
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("exec");
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
  });
  it("should allow apply_patch when exec is allow-listed and applyPatch is enabled", () => {
    const cfg = {
      tools: {
        allow: ["read", "exec"],
        exec: {
          applyPatch: { enabled: true },
        },
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
      modelProvider: "openai",
      modelId: "gpt-5.2",
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("exec");
    expect(toolNames).toContain("apply_patch");
  });
  it("defaults apply_patch to workspace-only (blocks traversal)", async () => {
    await withApplyPatchEscapeCase({}, async ({ applyPatchTool, escapedPath, patch }) => {
      await expect(applyPatchTool.execute("tc1", { input: patch })).rejects.toThrow(
        /Path escapes sandbox root/,
      );
      await expect(fs.readFile(escapedPath, "utf8")).rejects.toBeDefined();
    });
  });
  it("allows disabling apply_patch workspace-only via config (dangerous)", async () => {
    await withApplyPatchEscapeCase(
      { workspaceOnly: false },
      async ({ applyPatchTool, escapedPath, patch }) => {
        await applyPatchTool.execute("tc2", { input: patch });
        const contents = await fs.readFile(escapedPath, "utf8");
        expect(contents).toBe("escaped\n");
      },
    );
  });
  it("should apply agent-specific tool policy", () => {
    const cfg = {
      tools: {
        allow: ["read", "write", "exec"],
        deny: [],
      },
      agents: {
        list: [
          {
            id: "restricted",
            workspace: "~/genosos-restricted",
            tools: {
              allow: ["read"],
              deny: ["exec", "write", "edit"],
            },
          },
        ],
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:restricted:main",
      workspaceDir: "/tmp/test-restricted",
      agentDir: "/tmp/agent-restricted",
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
    expect(toolNames).not.toContain("edit");
  });
  it("should apply provider-specific tool policy", () => {
    const cfg = {
      tools: {
        allow: ["read", "write", "exec"],
        byProvider: {
          "google-antigravity": {
            allow: ["read"],
          },
        },
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test-provider",
      agentDir: "/tmp/agent-provider",
      modelProvider: "google-antigravity",
      modelId: "claude-opus-4-6-thinking",
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
  });
  it("should apply provider-specific tool profile overrides", () => {
    const cfg = {
      tools: {
        profile: "coding",
        byProvider: {
          "google-antigravity": {
            profile: "minimal",
          },
        },
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test-provider-profile",
      agentDir: "/tmp/agent-provider-profile",
      modelProvider: "google-antigravity",
      modelId: "claude-opus-4-6-thinking",
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual(["session_status"]);
  });
  it("should allow different tool policies for different agents", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/genosos",
          },
          {
            id: "family",
            workspace: "~/genosos-family",
            tools: {
              allow: ["read"],
              deny: ["exec", "write", "edit", "process"],
            },
          },
        ],
      },
    };
    const mainTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test-main",
      agentDir: "/tmp/agent-main",
    });
    const mainToolNames = mainTools.map((t) => t.name);
    expect(mainToolNames).toContain("exec");
    expect(mainToolNames).toContain("write");
    expect(mainToolNames).toContain("edit");
    expect(mainToolNames).not.toContain("apply_patch");
    const familyTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:family:whatsapp:group:123",
      workspaceDir: "/tmp/test-family",
      agentDir: "/tmp/agent-family",
    });
    const familyToolNames = familyTools.map((t) => t.name);
    expect(familyToolNames).toContain("read");
    expect(familyToolNames).not.toContain("exec");
    expect(familyToolNames).not.toContain("write");
    expect(familyToolNames).not.toContain("edit");
    expect(familyToolNames).not.toContain("apply_patch");
  });
  it("should apply group tool policy overrides (group-specific beats wildcard)", () => {
    const cfg = {
      channels: {
        whatsapp: {
          groups: {
            "*": {
              tools: { allow: ["read"] },
            },
            trusted: {
              tools: { allow: ["read", "exec"] },
            },
          },
        },
      },
    };
    const trustedTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:whatsapp:group:trusted",
      messageProvider: "whatsapp",
      workspaceDir: "/tmp/test-group-trusted",
      agentDir: "/tmp/agent-group",
    });
    const trustedNames = trustedTools.map((t) => t.name);
    expect(trustedNames).toContain("read");
    expect(trustedNames).toContain("exec");
    const defaultTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:whatsapp:group:unknown",
      messageProvider: "whatsapp",
      workspaceDir: "/tmp/test-group-default",
      agentDir: "/tmp/agent-group",
    });
    const defaultNames = defaultTools.map((t) => t.name);
    expect(defaultNames).toContain("read");
    expect(defaultNames).not.toContain("exec");
  });
  it("should apply per-sender tool policies for group tools", () => {
    const cfg = {
      channels: {
        whatsapp: {
          groups: {
            "*": {
              tools: { allow: ["read"] },
              toolsBySender: {
                alice: { allow: ["read", "exec"] },
              },
            },
          },
        },
      },
    };
    const aliceTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:whatsapp:group:family",
      senderId: "alice",
      workspaceDir: "/tmp/test-group-sender",
      agentDir: "/tmp/agent-group-sender",
    });
    const aliceNames = aliceTools.map((t) => t.name);
    expect(aliceNames).toContain("read");
    expect(aliceNames).toContain("exec");
    const bobTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:whatsapp:group:family",
      senderId: "bob",
      workspaceDir: "/tmp/test-group-sender-bob",
      agentDir: "/tmp/agent-group-sender",
    });
    const bobNames = bobTools.map((t) => t.name);
    expect(bobNames).toContain("read");
    expect(bobNames).not.toContain("exec");
  });
  it("should not let default sender policy override group tools", () => {
    const cfg = {
      channels: {
        whatsapp: {
          groups: {
            "*": {
              toolsBySender: {
                admin: { allow: ["read", "exec"] },
              },
            },
            locked: {
              tools: { allow: ["read"] },
            },
          },
        },
      },
    };
    const adminTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:whatsapp:group:locked",
      senderId: "admin",
      workspaceDir: "/tmp/test-group-default-override",
      agentDir: "/tmp/agent-group-default-override",
    });
    const adminNames = adminTools.map((t) => t.name);
    expect(adminNames).toContain("read");
    expect(adminNames).not.toContain("exec");
  });
  it("should resolve telegram group tool policy for topic session keys", () => {
    const cfg = {
      channels: {
        telegram: {
          groups: {
            123: {
              tools: { allow: ["read"] },
            },
          },
        },
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:telegram:group:123:topic:456",
      messageProvider: "telegram",
      workspaceDir: "/tmp/test-telegram-topic",
      agentDir: "/tmp/agent-telegram",
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).not.toContain("exec");
  });
  it("should inherit group tool policy for subagents from spawnedBy session keys", () => {
    const cfg = {
      channels: {
        whatsapp: {
          groups: {
            trusted: {
              tools: { allow: ["read"] },
            },
          },
        },
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:subagent:test",
      spawnedBy: "agent:default:whatsapp:group:trusted",
      workspaceDir: "/tmp/test-subagent-group",
      agentDir: "/tmp/agent-subagent",
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).not.toContain("exec");
  });
  it("should apply global tool policy before agent-specific policy", () => {
    const cfg = {
      tools: {
        deny: ["browser"],
      },
      agents: {
        list: [
          {
            id: "work",
            workspace: "~/genosos-work",
            tools: {
              deny: ["exec", "process"],
            },
          },
        ],
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:work:slack:dm:user123",
      workspaceDir: "/tmp/test-work",
      agentDir: "/tmp/agent-work",
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("browser");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("process");
    expect(toolNames).not.toContain("apply_patch");
  });
  it("should work with sandbox tools filtering", () => {
    const cfg = {
      agents: {
        defaults: {
          sandbox: {
            mode: "all",
            scope: "agent",
          },
        },
        list: [
          {
            id: "restricted",
            workspace: "~/genosos-restricted",
            sandbox: {
              mode: "all",
              scope: "agent",
            },
            tools: {
              allow: ["read"],
              deny: ["exec", "write"],
            },
          },
        ],
      },
      tools: {
        sandbox: {
          tools: {
            allow: ["read", "write", "exec"],
            deny: [],
          },
        },
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:restricted:main",
      workspaceDir: "/tmp/test-restricted",
      agentDir: "/tmp/agent-restricted",
      sandbox: {
        enabled: true,
        sessionKey: "agent:restricted:main",
        workspaceDir: "/tmp/sandbox",
        agentWorkspaceDir: "/tmp/test-restricted",
        workspaceAccess: "none",
        containerName: "test-container",
        containerWorkdir: "/workspace",
        docker: {
          image: "test-image",
          containerPrefix: "test-",
          workdir: "/workspace",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
        },
        tools: {
          allow: ["read", "write", "exec"],
          deny: [],
        },
        fsBridge: sandboxFsBridgeStub,
        browserAllowHostControl: false,
      },
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
  });
  it("should run exec synchronously when process is denied", async () => {
    const cfg = {
      tools: {
        deny: ["process"],
      },
    };
    const tools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test-main",
      agentDir: "/tmp/agent-main",
    });
    const execTool = tools.find((tool) => tool.name === "exec");
    expect(execTool).toBeDefined();
    const result = await execTool?.execute("call1", {
      command: "echo done",
      yieldMs: 10,
    });
    const resultDetails = result?.details;
    expect(resultDetails?.status).toBe("completed");
  });
  it("should apply agent-specific exec host defaults over global defaults", async () => {
    const cfg = {
      tools: {
        exec: {
          host: "sandbox",
        },
      },
      agents: {
        list: [
          {
            id: "main",
            tools: {
              exec: {
                host: "gateway",
              },
            },
          },
          {
            id: "helper",
          },
        ],
      },
    };
    const mainTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:default:main",
      workspaceDir: "/tmp/test-main-exec-defaults",
      agentDir: "/tmp/agent-main-exec-defaults",
    });
    const mainExecTool = mainTools.find((tool) => tool.name === "exec");
    expect(mainExecTool).toBeDefined();
    await expect(
      mainExecTool.execute("call-main", {
        command: "echo done",
        host: "sandbox",
      }),
    ).rejects.toThrow("exec host not allowed");
    const helperTools = createGenosOSCodingTools({
      config: cfg,
      sessionKey: "agent:helper:main",
      workspaceDir: "/tmp/test-helper-exec-defaults",
      agentDir: "/tmp/agent-helper-exec-defaults",
    });
    const helperExecTool = helperTools.find((tool) => tool.name === "exec");
    expect(helperExecTool).toBeDefined();
    const helperResult = await helperExecTool.execute("call-helper", {
      command: "echo done",
      host: "sandbox",
      yieldMs: 1000,
    });
    const helperDetails = helperResult?.details;
    expect(helperDetails?.status).toBe("completed");
  });
});
