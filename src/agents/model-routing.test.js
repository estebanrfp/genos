import { describe, expect, it } from "vitest";
import {
  classifyPromptTier,
  classifyTierEscalation,
  isRoutingExcluded,
  resolveRoutedModel,
} from "./model-routing.js";

describe("classifyTierEscalation", () => {
  it("escalates config tasks — create agent", () => {
    expect(classifyTierEscalation("crea un agente especialista en seo")).toBe("complex");
  });

  it("escalates config tasks — configure channel", () => {
    expect(classifyTierEscalation("configura el canal de whatsapp")).toBe("complex");
  });

  it("escalates config tasks — install service", () => {
    expect(classifyTierEscalation("instala el servicio de stripe")).toBe("complex");
  });

  it("escalates config tasks — security", () => {
    expect(classifyTierEscalation("securiza el vault y protege las credenciales")).toBe("complex");
  });

  it("escalates config tasks — deploy", () => {
    expect(classifyTierEscalation("despliega el bot en discord")).toBe("complex");
  });

  it("escalates destructive tasks — delete agent", () => {
    expect(classifyTierEscalation("elimina el agente seo specialist")).toBe("complex");
  });

  it("escalates destructive tasks — remove service", () => {
    expect(classifyTierEscalation("borra el servicio de stripe")).toBe("complex");
  });

  it("escalates modification tasks — update/rename", () => {
    expect(classifyTierEscalation("renombra el agente marketing")).toBe("complex");
    expect(classifyTierEscalation("actualiza la configuración del canal whatsapp")).toBe("complex");
  });

  it("does NOT escalate management/query tasks", () => {
    expect(classifyTierEscalation("muestra el estado del agente")).toBeNull();
    expect(classifyTierEscalation("lista los canales activos")).toBeNull();
  });

  it("does NOT escalate general conversation", () => {
    expect(classifyTierEscalation("hola, cómo estás?")).toBeNull();
    expect(classifyTierEscalation("qué hora es?")).toBeNull();
  });

  it("does NOT escalate action without target", () => {
    expect(classifyTierEscalation("crea una historia bonita")).toBeNull();
    expect(classifyTierEscalation("configura mi mente")).toBeNull();
  });

  it("returns null for empty prompt", () => {
    expect(classifyTierEscalation("")).toBeNull();
    expect(classifyTierEscalation(null)).toBeNull();
  });
});

describe("classifyPromptTier", () => {
  it("returns normal for short prompts (two-tier: normal minimum)", () => {
    expect(classifyPromptTier("hola")).toBe("normal");
    expect(classifyPromptTier("qué hora es?")).toBe("normal");
  });

  it("returns normal for multiple analysis keywords", () => {
    // 2 analysis hits (+3) = score 3 → normal
    expect(classifyPromptTier("analyse and compare this data")).toBe("normal");
  });

  it("returns normal for reasoning keywords", () => {
    // 1 reasoning hit (+4) = score 4 → normal (3-7 range)
    expect(classifyPromptTier("think carefully step-by-step about this")).toBe("normal");
  });

  it("never assigns simple tier (two-tier system)", () => {
    expect(classifyPromptTier("hola", { sessionKey: "cron:check" })).toBe("normal");
    expect(classifyPromptTier("hi")).toBe("normal");
    expect(classifyPromptTier("")).toBe("normal");
  });

  it("returns normal for empty prompt (two-tier minimum)", () => {
    expect(classifyPromptTier("")).toBe("normal");
    expect(classifyPromptTier(null)).toBe("normal");
  });
});

describe("isRoutingExcluded", () => {
  it("excludes configured agent sessions (not subagent keys)", () => {
    expect(isRoutingExcluded("agent:main:main")).toBe(true);
    expect(isRoutingExcluded("agent:seo-specialist:main")).toBe(true);
    expect(isRoutingExcluded("agent:leaf-bot:main")).toBe(true);
  });

  it("excludes undefined/empty session keys", () => {
    expect(isRoutingExcluded(undefined)).toBe(true);
    expect(isRoutingExcluded("")).toBe(true);
  });

  it("includes spawned subagent sessions", () => {
    expect(isRoutingExcluded("agent:main:subagent:task-xyz")).toBe(false);
    expect(isRoutingExcluded("agent:seo-specialist:subagent:research")).toBe(false);
    expect(isRoutingExcluded("subagent:quick-task")).toBe(false);
  });
});

describe("resolveRoutedModel", () => {
  const baseConfig = {
    agents: {
      defaults: {
        model: {
          routing: {
            enabled: true,
            tiers: {
              simple: "anthropic/claude-haiku-4-5",
              normal: "anthropic/claude-sonnet-4-6",
              complex: "anthropic/claude-opus-4-6",
            },
          },
        },
      },
      list: [
        { id: "main", name: "Nyx", default: true },
        {
          id: "seo-specialist",
          name: "SEO Specialist",
          subagents: { allowAgents: ["main"] },
        },
        { id: "leaf-bot", name: "Leaf Bot" },
      ],
    },
    tools: {
      agentToAgent: { enabled: true, allow: ["main", "seo-specialist"] },
    },
  };

  it("excludes configured agents from routing (main)", () => {
    const result = resolveRoutedModel({
      config: baseConfig,
      prompt: "hola",
      sessionKey: "agent:main:main",
      agentId: "main",
      defaultProvider: "anthropic",
    });
    expect(result).toBeNull();
  });

  it("excludes configured specialist agents from routing", () => {
    const result = resolveRoutedModel({
      config: baseConfig,
      prompt: "hola",
      sessionKey: "agent:seo-specialist:main",
      agentId: "seo-specialist",
      defaultProvider: "anthropic",
    });
    expect(result).toBeNull();
  });

  it("routes spawned subagents — upgrades simple → normal for orchestrator", () => {
    const result = resolveRoutedModel({
      config: baseConfig,
      prompt: "hola",
      sessionKey: "agent:main:subagent:quick-task",
      agentId: "main",
      defaultProvider: "anthropic",
    });
    expect(result.tier).toBe("normal");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("routes spawned subagents — normal minimum for leaf agent parent", () => {
    const result = resolveRoutedModel({
      config: baseConfig,
      prompt: "hola",
      sessionKey: "agent:leaf-bot:subagent:task-1",
      agentId: "leaf-bot",
      defaultProvider: "anthropic",
    });
    expect(result.tier).toBe("normal");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("routes spawned subagents — complex prompt gets complex tier", () => {
    const result = resolveRoutedModel({
      config: baseConfig,
      prompt:
        "Please analyse step-by-step and compare the following long architecture document that describes how to refactor our system. ".repeat(
          10,
        ),
      sessionKey: "agent:main:subagent:analysis",
      agentId: "main",
      defaultProvider: "anthropic",
    });
    expect(result.tier).toBe("complex");
    expect(result.model).toBe("claude-opus-4-6");
  });

  it("returns profile fields from object tier values", () => {
    const profileConfig = {
      ...baseConfig,
      agents: {
        ...baseConfig.agents,
        defaults: {
          model: {
            routing: {
              enabled: true,
              tiers: {
                simple: { model: "anthropic/claude-haiku-4-5", thinking: "off" },
                normal: { model: "anthropic/claude-sonnet-4-6", thinking: "low" },
                complex: {
                  model: "anthropic/claude-opus-4-6",
                  thinking: "high",
                  verbose: "on",
                  reasoning: "stream",
                },
              },
            },
          },
        },
      },
    };
    const result = resolveRoutedModel({
      config: profileConfig,
      prompt:
        "Please analyse step-by-step and compare the following long architecture document that describes how to refactor our system. ".repeat(
          10,
        ),
      sessionKey: "agent:main:subagent:analysis",
      agentId: "main",
      defaultProvider: "anthropic",
    });
    expect(result.tier).toBe("complex");
    expect(result.model).toBe("claude-opus-4-6");
    expect(result.thinking).toBe("high");
    expect(result.verbose).toBe("on");
    expect(result.reasoning).toBe("stream");
  });

  it("omits capability fields for string tier values", () => {
    const result = resolveRoutedModel({
      config: baseConfig,
      prompt: "hola",
      sessionKey: "agent:leaf-bot:subagent:task-1",
      agentId: "leaf-bot",
      defaultProvider: "anthropic",
    });
    expect(result.tier).toBe("normal");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.thinking).toBe("medium");
    expect(result.verbose).toBeUndefined();
    expect(result.reasoning).toBeUndefined();
  });

  it("returns null when routing is disabled", () => {
    const config = {
      ...baseConfig,
      agents: {
        ...baseConfig.agents,
        defaults: { model: { routing: { enabled: false } } },
      },
    };
    const result = resolveRoutedModel({
      config,
      prompt: "hola",
      sessionKey: "agent:leaf-bot:subagent:task",
      agentId: "leaf-bot",
      defaultProvider: "anthropic",
    });
    expect(result).toBeNull();
  });

  it("excludes requests without sessionKey", () => {
    const result = resolveRoutedModel({
      config: baseConfig,
      prompt: "hola",
      defaultProvider: "anthropic",
    });
    expect(result).toBeNull();
  });
});
