import { describe, expect, it } from "vitest";
import { renameAgentConfig } from "./agents.config.js";

describe("renameAgentConfig", () => {
  const baseCfg = {
    agents: {
      list: [
        { id: "main", name: "Nyx" },
        {
          id: "amigo-nyx",
          name: "Lumina",
          workspace: "/ws/amigo-nyx",
          subagents: { allowAgents: ["main"] },
        },
        { id: "researcher", name: "Researcher", subagents: { allowAgents: ["amigo-nyx", "main"] } },
      ],
    },
    bindings: [
      { channel: "whatsapp", agentId: "amigo-nyx" },
      { channel: "telegram", agentId: "main" },
    ],
    tools: {
      agentToAgent: { enabled: true, allow: ["main", "amigo-nyx", "researcher"] },
    },
  };

  it("renames the agent id in agents.list", () => {
    const result = renameAgentConfig(baseCfg, "amigo-nyx", "lumina");
    const ids = result.agents.list.map((a) => a.id);
    expect(ids).toContain("lumina");
    expect(ids).not.toContain("amigo-nyx");
  });

  it("preserves other agents unchanged", () => {
    const result = renameAgentConfig(baseCfg, "amigo-nyx", "lumina");
    const main = result.agents.list.find((a) => a.id === "main");
    expect(main.name).toBe("Nyx");
  });

  it("updates bindings[].agentId", () => {
    const result = renameAgentConfig(baseCfg, "amigo-nyx", "lumina");
    const waBinding = result.bindings.find((b) => b.channel === "whatsapp");
    expect(waBinding.agentId).toBe("lumina");
    const tgBinding = result.bindings.find((b) => b.channel === "telegram");
    expect(tgBinding.agentId).toBe("main");
  });

  it("updates tools.agentToAgent.allow[]", () => {
    const result = renameAgentConfig(baseCfg, "amigo-nyx", "lumina");
    expect(result.tools.agentToAgent.allow).toContain("lumina");
    expect(result.tools.agentToAgent.allow).not.toContain("amigo-nyx");
    expect(result.tools.agentToAgent.allow).toContain("main");
  });

  it("updates subagents.allowAgents[] in other agents", () => {
    const result = renameAgentConfig(baseCfg, "amigo-nyx", "lumina");
    const researcher = result.agents.list.find((a) => a.id === "researcher");
    expect(researcher.subagents.allowAgents).toContain("lumina");
    expect(researcher.subagents.allowAgents).not.toContain("amigo-nyx");
    expect(researcher.subagents.allowAgents).toContain("main");
  });

  it("updates workspace and agentDir when opts provided", () => {
    const result = renameAgentConfig(baseCfg, "amigo-nyx", "lumina", {
      workspace: "/ws/lumina",
      agentDir: "/agents/lumina/agent",
    });
    const lumina = result.agents.list.find((a) => a.id === "lumina");
    expect(lumina.workspace).toBe("/ws/lumina");
    expect(lumina.agentDir).toBe("/agents/lumina/agent");
  });

  it("keeps display name intact", () => {
    const result = renameAgentConfig(baseCfg, "amigo-nyx", "lumina");
    const lumina = result.agents.list.find((a) => a.id === "lumina");
    expect(lumina.name).toBe("Lumina");
  });
});
