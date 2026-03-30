import { describe, expect, it, beforeEach } from "vitest";
import {
  inferToolProfile,
  applyToolProfile,
  hardenSecurityConfig,
  detectMissingCredentials,
  applySessionDefaults,
  applyRoutingDefaults,
  clearCatalogCache,
} from "./auto-config.js";

describe("inferToolProfile", () => {
  it("returns 'coding' for developer-related names", () => {
    expect(inferToolProfile("code-reviewer")).toBe("coding");
    expect(inferToolProfile("DevOps Agent")).toBe("coding");
    expect(inferToolProfile("test-runner")).toBe("coding");
    expect(inferToolProfile("Script Helper")).toBe("coding");
    expect(inferToolProfile("Linter")).toBe("coding");
    expect(inferToolProfile("deploy-bot")).toBe("coding");
    expect(inferToolProfile("debug-assistant")).toBe("coding");
    expect(inferToolProfile("Refactor Agent")).toBe("coding");
  });

  it("returns 'messaging' for communication-related names", () => {
    expect(inferToolProfile("chat-support")).toBe("messaging");
    expect(inferToolProfile("Helpdesk Bot")).toBe("messaging");
    expect(inferToolProfile("broadcast-agent")).toBe("messaging");
    expect(inferToolProfile("Community Manager")).toBe("messaging");
    expect(inferToolProfile("social-bot")).toBe("messaging");
  });

  it("returns 'minimal' for monitoring-related names", () => {
    expect(inferToolProfile("health-monitor")).toBe("minimal");
    expect(inferToolProfile("Status Checker")).toBe("minimal");
    expect(inferToolProfile("ping-probe")).toBe("minimal");
    expect(inferToolProfile("Heartbeat Watcher")).toBe("minimal");
    expect(inferToolProfile("sensor-agent")).toBe("minimal");
  });

  it("returns 'full' for unrecognized names", () => {
    expect(inferToolProfile("General Assistant")).toBe("full");
    expect(inferToolProfile("Research Agent")).toBe("full");
    expect(inferToolProfile("Nyx")).toBe("full");
  });
});

describe("applyToolProfile", () => {
  it("sets profile on matching agent", () => {
    const cfg = { agents: { list: [{ id: "test-agent", tools: {} }] } };
    const { config, applied } = applyToolProfile(cfg, "test-agent", "coding");
    expect(config.agents.list[0].tools.profile).toBe("coding");
    expect(applied).toEqual(["tools.profile=coding"]);
  });

  it("creates tools object if missing", () => {
    const cfg = { agents: { list: [{ id: "test-agent" }] } };
    const { config, applied } = applyToolProfile(cfg, "test-agent", "minimal");
    expect(config.agents.list[0].tools.profile).toBe("minimal");
    expect(applied).toHaveLength(1);
  });

  it("returns empty applied when agent not found", () => {
    const cfg = { agents: { list: [{ id: "other" }] } };
    const { applied } = applyToolProfile(cfg, "nonexistent", "coding");
    expect(applied).toEqual([]);
  });

  it("does not mutate original config", () => {
    const cfg = { agents: { list: [{ id: "a" }] } };
    applyToolProfile(cfg, "a", "coding");
    expect(cfg.agents.list[0].tools).toBeUndefined();
  });
});

describe("hardenSecurityConfig", () => {
  it("fills fortress defaults when vault is enabled", () => {
    const cfg = { security: { vault: { enabled: true } } };
    const { config, applied } = hardenSecurityConfig(cfg);
    expect(config.security.fortress.enabled).toBe(true);
    expect(config.security.fortress.auditLog).toBe(true);
    expect(config.security.fortress.rateLimiting).toBe(true);
    expect(config.security.vault.autoLockMinutes).toBe(30);
    expect(applied).toHaveLength(4);
  });

  it("does not overwrite explicit user values", () => {
    const cfg = {
      security: {
        vault: { enabled: true, autoLockMinutes: 60 },
        fortress: { enabled: false, auditLog: true },
      },
    };
    const { config, applied } = hardenSecurityConfig(cfg);
    expect(config.security.fortress.enabled).toBe(false);
    expect(config.security.fortress.auditLog).toBe(true);
    expect(config.security.vault.autoLockMinutes).toBe(60);
    expect(config.security.fortress.rateLimiting).toBe(true);
    expect(applied).toEqual(["security.fortress.rateLimiting=true"]);
  });

  it("returns empty applied when vault is disabled", () => {
    const cfg = { security: { vault: { enabled: false } } };
    const { applied } = hardenSecurityConfig(cfg);
    expect(applied).toEqual([]);
  });

  it("returns empty applied when no security config", () => {
    const { applied } = hardenSecurityConfig({});
    expect(applied).toEqual([]);
  });

  it("does not mutate original config", () => {
    const cfg = { security: { vault: { enabled: true } } };
    hardenSecurityConfig(cfg);
    expect(cfg.security.fortress).toBeUndefined();
  });
});

describe("detectMissingCredentials", () => {
  it("detects missing telegram token", () => {
    const { missing, hint } = detectMissingCredentials("telegram", {});
    expect(missing).toEqual(["token"]);
    expect(hint).toContain("channels.telegram.token");
  });

  it("detects missing discord token", () => {
    const { missing } = detectMissingCredentials("discord", {});
    expect(missing).toEqual(["token"]);
  });

  it("detects missing signal path", () => {
    const { missing } = detectMissingCredentials("signal", {});
    expect(missing).toEqual(["signalCliPath"]);
  });

  it("returns empty for whatsapp (native flow)", () => {
    const { missing, hint } = detectMissingCredentials("whatsapp", {});
    expect(missing).toEqual([]);
    expect(hint).toBe("");
  });

  it("returns empty for imessage (native flow)", () => {
    const { missing } = detectMissingCredentials("imessage", {});
    expect(missing).toEqual([]);
  });

  it("returns empty when all credentials present", () => {
    const { missing } = detectMissingCredentials("telegram", { token: "abc123" });
    expect(missing).toEqual([]);
  });

  it("returns empty for unknown channel", () => {
    const { missing } = detectMissingCredentials("unknown-channel", {});
    expect(missing).toEqual([]);
  });
});

describe("applySessionDefaults", () => {
  it("fills atHour=4 when reset.mode=daily", () => {
    const cfg = { session: { reset: { mode: "daily" } } };
    const { config, applied } = applySessionDefaults(cfg, "session.reset.mode", "daily");
    expect(config.session.reset.atHour).toBe(4);
    expect(applied).toEqual(["session.reset.atHour=4"]);
  });

  it("fills idleMinutes=30 when reset.mode=idle", () => {
    const cfg = { session: { reset: { mode: "idle" } } };
    const { config, applied } = applySessionDefaults(cfg, "session.reset.mode", "idle");
    expect(config.session.reset.idleMinutes).toBe(30);
    expect(applied).toEqual(["session.reset.idleMinutes=30"]);
  });

  it("fills pruneAfter=7d when maintenance.mode=enforce", () => {
    const cfg = { session: { maintenance: { mode: "enforce" } } };
    const { config, applied } = applySessionDefaults(cfg, "session.maintenance.mode", "enforce");
    expect(config.session.maintenance.pruneAfter).toBe("7d");
    expect(applied).toEqual(["session.maintenance.pruneAfter=7d"]);
  });

  it("does not overwrite existing atHour", () => {
    const cfg = { session: { reset: { mode: "daily", atHour: 6 } } };
    const { config, applied } = applySessionDefaults(cfg, "session.reset.mode", "daily");
    expect(config.session.reset.atHour).toBe(6);
    expect(applied).toEqual([]);
  });

  it("does nothing for manual mode", () => {
    const cfg = { session: { reset: { mode: "manual" } } };
    const { applied } = applySessionDefaults(cfg, "session.reset.mode", "manual");
    expect(applied).toEqual([]);
  });

  it("does nothing for unrelated paths", () => {
    const cfg = {};
    const { applied } = applySessionDefaults(cfg, "gateway.port", 18789);
    expect(applied).toEqual([]);
  });

  it("does not mutate original config", () => {
    const cfg = { session: { reset: { mode: "daily" } } };
    applySessionDefaults(cfg, "session.reset.mode", "daily");
    expect(cfg.session.reset.atHour).toBeUndefined();
  });
});

describe("applyRoutingDefaults", () => {
  beforeEach(() => clearCatalogCache());

  it("fills tier models from catalog based on primary provider", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            routing: { enabled: true },
          },
        },
      },
    };
    const { config, applied } = await applyRoutingDefaults(cfg);
    expect(config.agents.defaults.model.routing.tiers.simple).toMatch(/^anthropic\//);
    expect(config.agents.defaults.model.routing.tiers.normal).toMatch(/^anthropic\//);
    expect(config.agents.defaults.model.routing.tiers.complex).toMatch(/^anthropic\//);
    expect(applied).toHaveLength(4); // 3 tiers + defaultTier
  });

  it("defaults to anthropic when no primary model", async () => {
    const cfg = {
      agents: { defaults: { model: { routing: { enabled: true } } } },
    };
    const { config, applied } = await applyRoutingDefaults(cfg);
    expect(config.agents.defaults.model.routing.tiers.simple).toMatch(/^anthropic\//);
    expect(applied).toHaveLength(4); // 3 tiers + defaultTier
  });

  it("does not overwrite existing tier models", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            routing: {
              enabled: true,
              tiers: { simple: "openai/gpt-5-nano" },
            },
          },
        },
      },
    };
    const { config, applied } = await applyRoutingDefaults(cfg);
    expect(config.agents.defaults.model.routing.tiers.simple).toBe("openai/gpt-5-nano");
    expect(applied).toHaveLength(3); // normal + complex + defaultTier
  });

  it("does nothing when routing is disabled", async () => {
    const cfg = {
      agents: { defaults: { model: { routing: { enabled: false } } } },
    };
    const { applied } = await applyRoutingDefaults(cfg);
    expect(applied).toEqual([]);
  });

  it("uses openai models for openai primary", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.2",
            routing: { enabled: true },
          },
        },
      },
    };
    const { config } = await applyRoutingDefaults(cfg);
    expect(config.agents.defaults.model.routing.tiers.simple).toMatch(/^openai\//);
  });

  it("does not mutate original config", async () => {
    const cfg = {
      agents: { defaults: { model: { routing: { enabled: true } } } },
    };
    await applyRoutingDefaults(cfg);
    expect(cfg.agents.defaults.model.routing.tiers).toBeUndefined();
  });
});
