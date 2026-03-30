let buildSnapshot = function (params) {
    return {
      path: "/tmp/genosos.json",
      exists: true,
      raw: JSON.stringify(params.resolved),
      parsed: params.resolved,
      resolved: params.resolved,
      valid: true,
      config: params.config,
      issues: [],
      warnings: [],
      legacyIssues: [],
    };
  },
  setSnapshot = function (resolved, config) {
    mockReadConfigFileSnapshot.mockResolvedValueOnce(buildSnapshot({ resolved, config }));
  };
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mockReadConfigFileSnapshot = vi.fn();
const mockWriteConfigFile = vi.fn(async () => {});
vi.mock("../config/config.js", () => ({
  readConfigFileSnapshot: () => mockReadConfigFileSnapshot(),
  writeConfigFile: (cfg) => mockWriteConfigFile(cfg),
}));
const mockLog = vi.fn();
const mockError = vi.fn();
const mockExit = vi.fn((code) => {
  const errorMessages = mockError.mock.calls.map((c) => c.join(" ")).join("; ");
  throw new Error(`__exit__:${code} - ${errorMessages}`);
});
vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: (...args) => mockLog(...args),
    error: (...args) => mockError(...args),
    exit: (code) => mockExit(code),
  },
}));
async function runConfigCommand(args) {
  const { registerConfigCli } = await import("./config-cli.js");
  const program = new Command();
  program.exitOverride();
  registerConfigCli(program);
  await program.parseAsync(args, { from: "user" });
}
describe("config cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe("config set - issue #6070", () => {
    it("preserves existing config keys when setting a new value", async () => {
      const resolved = {
        agents: {
          list: [{ id: "main" }, { id: "oracle", workspace: "~/oracle-workspace" }],
        },
        gateway: { port: 18789 },
        tools: { allow: ["group:fs"] },
        logging: { level: "debug" },
      };
      const runtimeMerged = {
        ...resolved,
        agents: {
          ...resolved.agents,
          defaults: {
            model: "gpt-5.2",
          },
        },
      };
      setSnapshot(resolved, runtimeMerged);
      await runConfigCommand(["config", "set", "gateway.auth.mode", "token"]);
      expect(mockWriteConfigFile).toHaveBeenCalledTimes(1);
      const written = mockWriteConfigFile.mock.calls[0]?.[0];
      expect(written.gateway?.auth).toEqual({ mode: "token" });
      expect(written.gateway?.port).toBe(18789);
      expect(written.agents).toEqual(resolved.agents);
      expect(written.tools).toEqual(resolved.tools);
      expect(written.logging).toEqual(resolved.logging);
      expect(written.agents).not.toHaveProperty("defaults");
    });
    it("does not inject runtime defaults into the written config", async () => {
      const resolved = {
        gateway: { port: 18789 },
      };
      const runtimeMerged = {
        ...resolved,
        agents: {
          defaults: {
            model: "gpt-5.2",
            contextWindow: 128000,
            maxTokens: 16000,
          },
        },
        messages: { ackReaction: "\u2705" },
        sessions: { persistence: { enabled: true } },
      };
      setSnapshot(resolved, runtimeMerged);
      await runConfigCommand(["config", "set", "gateway.auth.mode", "token"]);
      expect(mockWriteConfigFile).toHaveBeenCalledTimes(1);
      const written = mockWriteConfigFile.mock.calls[0]?.[0];
      expect(written).not.toHaveProperty("agents.defaults.model");
      expect(written).not.toHaveProperty("agents.defaults.contextWindow");
      expect(written).not.toHaveProperty("agents.defaults.maxTokens");
      expect(written).not.toHaveProperty("messages.ackReaction");
      expect(written).not.toHaveProperty("sessions.persistence");
      expect(written.gateway?.port).toBe(18789);
      expect(written.gateway?.auth).toEqual({ mode: "token" });
    });
  });
  describe("config unset - issue #6070", () => {
    it("preserves existing config keys when unsetting a value", async () => {
      const resolved = {
        agents: { list: [{ id: "main" }] },
        gateway: { port: 18789 },
        tools: {
          profile: "coding",
          alsoAllow: ["agents_list"],
        },
        logging: { level: "debug" },
      };
      const runtimeMerged = {
        ...resolved,
        agents: {
          ...resolved.agents,
          defaults: {
            model: "gpt-5.2",
          },
        },
      };
      setSnapshot(resolved, runtimeMerged);
      await runConfigCommand(["config", "unset", "tools.alsoAllow"]);
      expect(mockWriteConfigFile).toHaveBeenCalledTimes(1);
      const written = mockWriteConfigFile.mock.calls[0]?.[0];
      expect(written.tools).not.toHaveProperty("alsoAllow");
      expect(written.agents).not.toHaveProperty("defaults");
      expect(written.agents?.list).toEqual(resolved.agents?.list);
      expect(written.gateway).toEqual(resolved.gateway);
      expect(written.tools?.profile).toBe("coding");
      expect(written.logging).toEqual(resolved.logging);
    });
  });
});
