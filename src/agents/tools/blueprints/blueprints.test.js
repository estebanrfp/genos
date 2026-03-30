import { describe, expect, it, beforeEach } from "vitest";
import {
  matchPath,
  resolveSection,
  applyCoercion,
  checkCrossField,
  findBlueprint,
  listBlueprintsForSection,
  extractChannelId,
  clearBlueprintCache,
} from "./index.js";

describe("blueprints infrastructure", () => {
  beforeEach(() => clearBlueprintCache());

  // --- matchPath ---
  describe("matchPath", () => {
    it("matches exact paths", () => {
      expect(matchPath("gateway.port", "gateway.port")).toBe(true);
    });

    it("matches wildcard segments", () => {
      expect(matchPath("channels.*.allowFrom", "channels.imessage.allowFrom")).toBe(true);
      expect(matchPath("channels.*.allowFrom", "channels.discord.allowFrom")).toBe(true);
      expect(matchPath("channels.*.allowFrom", "channels.telegram.allowFrom")).toBe(true);
    });

    it("rejects length mismatch", () => {
      expect(matchPath("channels.*.allowFrom", "channels.telegram")).toBe(false);
      expect(matchPath("channels.*", "channels.telegram.allowFrom")).toBe(false);
    });

    it("rejects non-matching segments", () => {
      expect(matchPath("channels.*.allowFrom", "channels.telegram.dmPolicy")).toBe(false);
      expect(matchPath("gateway.port", "gateway.bind")).toBe(false);
    });

    it("handles multiple wildcards", () => {
      expect(matchPath("a.*.c.*", "a.b.c.d")).toBe(true);
      expect(matchPath("a.*.c.*", "a.b.x.d")).toBe(false);
    });
  });

  // --- resolveSection ---
  describe("resolveSection", () => {
    it("resolves channels paths", () => {
      expect(resolveSection("channels.telegram.enabled")).toBe("channels");
      expect(resolveSection("channels.discord.allowFrom")).toBe("channels");
    });

    it("resolves gateway paths", () => {
      expect(resolveSection("gateway.port")).toBe("gateway");
      expect(resolveSection("gateway.auth.token")).toBe("gateway");
    });

    it("resolves security paths", () => {
      expect(resolveSection("security.vault.enabled")).toBe("security");
    });

    it("resolves advanced section paths", () => {
      expect(resolveSection("env.vars")).toBe("advanced");
      expect(resolveSection("plugins.enabled")).toBe("advanced");
    });

    it("resolves logging/hooks/commands to their own sections", () => {
      expect(resolveSection("logging.level")).toBe("logging");
      expect(resolveSection("hooks.onMessage")).toBe("hooks");
      expect(resolveSection("commands.prefix")).toBe("commands");
    });

    it("resolves agents.defaults.model prefix to models section", () => {
      expect(resolveSection("agents.defaults.model.primary")).toBe("models");
      expect(resolveSection("agents.defaults.imageModel")).toBe("models");
    });

    it("resolves providers paths", () => {
      expect(resolveSection("providers.anthropic.credentials")).toBe("providers");
    });

    it("returns undefined for unknown root", () => {
      expect(resolveSection("unknown.path")).toBeUndefined();
    });
  });

  // --- extractChannelId ---
  describe("extractChannelId", () => {
    it("extracts channel name from channels paths", () => {
      expect(extractChannelId("channels.discord.allowFrom")).toBe("discord");
      expect(extractChannelId("channels.telegram.dmPolicy")).toBe("telegram");
    });

    it("returns undefined for non-channel paths", () => {
      expect(extractChannelId("gateway.port")).toBeUndefined();
      expect(extractChannelId("channels")).toBeUndefined();
    });
  });

  // --- applyCoercion ---
  describe("applyCoercion", () => {
    it("returns value unchanged when no coercion", () => {
      const bp = { pathPattern: "x.y", valueType: "scalar" };
      expect(applyCoercion(bp, "hello")).toBe("hello");
      expect(applyCoercion(bp, 42)).toBe(42);
    });

    it("coerces to string", () => {
      const bp = { pathPattern: "x.y", valueType: "array", itemCoerce: "string" };
      expect(applyCoercion(bp, 123456789)).toBe("123456789");
      expect(applyCoercion(bp, "hello")).toBe("hello");
    });

    it("coerces to number for numeric strings", () => {
      const bp = { pathPattern: "x.y", valueType: "array", itemCoerce: "number" };
      expect(applyCoercion(bp, "34660777328")).toBe(34660777328);
    });

    it("keeps non-numeric strings as-is with number coercion", () => {
      const bp = { pathPattern: "x.y", valueType: "array", itemCoerce: "number" };
      expect(applyCoercion(bp, "hello")).toBe("hello");
    });

    it("smart coercion converts numeric to number", () => {
      const bp = { pathPattern: "x.y", valueType: "array", itemCoerce: "smart" };
      expect(applyCoercion(bp, "34660777328")).toBe(34660777328);
    });

    it("smart coercion keeps non-numeric as string", () => {
      const bp = { pathPattern: "x.y", valueType: "array", itemCoerce: "smart" };
      expect(applyCoercion(bp, "hello")).toBe("hello");
    });

    it("uses channel-specific rules — discord forces string", () => {
      const bp = {
        pathPattern: "channels.*.allowFrom",
        valueType: "array",
        itemCoerce: "smart",
        channelRules: { discord: { itemCoerce: "string" } },
      };
      expect(applyCoercion(bp, "123456789", "discord")).toBe("123456789");
      expect(applyCoercion(bp, 123456789, "discord")).toBe("123456789");
    });

    it("uses channel-specific rules — telegram smart coercion", () => {
      const bp = {
        pathPattern: "channels.*.allowFrom",
        valueType: "array",
        itemCoerce: "smart",
        channelRules: { telegram: { itemCoerce: "smart" } },
      };
      expect(applyCoercion(bp, "34660777328", "telegram")).toBe(34660777328);
      expect(applyCoercion(bp, "@username", "telegram")).toBe("@username");
    });

    it("uses channel-specific rules — imessage forces string", () => {
      const bp = {
        pathPattern: "channels.*.allowFrom",
        valueType: "array",
        itemCoerce: "smart",
        channelRules: { imessage: { itemCoerce: "string" } },
      };
      expect(applyCoercion(bp, "34660777328", "imessage")).toBe("34660777328");
    });

    it("falls back to base coercion for unknown channel", () => {
      const bp = {
        pathPattern: "channels.*.allowFrom",
        valueType: "array",
        itemCoerce: "smart",
        channelRules: { discord: { itemCoerce: "string" } },
      };
      expect(applyCoercion(bp, "12345", "unknownChannel")).toBe(12345);
    });
  });

  // --- checkCrossField ---
  describe("checkCrossField", () => {
    it("returns empty for blueprints without cross-field rules", () => {
      const bp = { pathPattern: "x.y", valueType: "scalar" };
      expect(checkCrossField(bp, {}, "x.y", "val")).toEqual([]);
    });

    it("returns empty for blueprints with empty cross-field", () => {
      const bp = { pathPattern: "x.y", valueType: "scalar", crossField: [] };
      expect(checkCrossField(bp, {}, "x.y", "val")).toEqual([]);
    });

    it("detects dmPolicy=open cross-field violation", () => {
      const bp = {
        pathPattern: "channels.*.dmPolicy",
        valueType: "scalar",
        crossField: [
          { field: "allowFrom", eq: "open", message: "dmPolicy='open' requires allowFrom=['*']" },
        ],
      };
      const cfg = { channels: { telegram: { dmPolicy: "open" } } };
      const errors = checkCrossField(bp, cfg, "channels.telegram.dmPolicy", "open");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("allowFrom");
    });

    it("passes when dmPolicy is not open", () => {
      const bp = {
        pathPattern: "channels.*.dmPolicy",
        valueType: "scalar",
        crossField: [
          { field: "allowFrom", eq: "open", message: "dmPolicy='open' requires allowFrom=['*']" },
        ],
      };
      const cfg = { channels: { telegram: { dmPolicy: "allowlist" } } };
      const errors = checkCrossField(bp, cfg, "channels.telegram.dmPolicy", "allowlist");
      expect(errors).toHaveLength(0);
    });

    it("detects Discord activityType=1 without URL", () => {
      const bp = {
        pathPattern: "channels.discord.activityType",
        valueType: "scalar",
        crossField: [
          { field: "activityUrl", eq: 1, message: "activityType=1 requires activityUrl" },
        ],
      };
      const cfg = { channels: { discord: { activityType: 1 } } };
      const errors = checkCrossField(bp, cfg, "channels.discord.activityType", 1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("activityUrl");
    });

    it("detects IRC register=true without email", () => {
      const bp = {
        pathPattern: "channels.irc.nickserv.register",
        valueType: "scalar",
        crossField: [
          { field: "registerEmail", eq: true, message: "register=true requires registerEmail" },
        ],
      };
      const cfg = { channels: { irc: { nickserv: { register: true } } } };
      const errors = checkCrossField(bp, cfg, "channels.irc.nickserv.register", true);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("registerEmail");
    });

    it("detects cross-field 'when' rule violation", () => {
      const bp = {
        pathPattern: "channels.*.allowFrom",
        valueType: "array",
        crossField: [{ field: "dmPolicy", when: "open", requires: '["*"]' }],
      };
      const cfg = { channels: { telegram: { dmPolicy: "open", allowFrom: [] } } };
      const errors = checkCrossField(bp, cfg, "channels.telegram.allowFrom", undefined);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("dmPolicy=open");
    });

    it("passes cross-field 'when' rule when requirement met", () => {
      const bp = {
        pathPattern: "channels.*.allowFrom",
        valueType: "array",
        crossField: [{ field: "dmPolicy", when: "open", requires: '["*"]' }],
      };
      const cfg = { channels: { telegram: { dmPolicy: "open", allowFrom: ["*"] } } };
      const errors = checkCrossField(bp, cfg, "channels.telegram.allowFrom", undefined);
      expect(errors).toHaveLength(0);
    });
  });

  // --- crossField: session reset/maintenance ---
  describe("crossField session rules", () => {
    it("fires advisory for session.reset.mode=daily", () => {
      const bp = {
        pathPattern: "session.reset.mode",
        valueType: "scalar",
        crossField: [
          { eq: "daily", message: "reset.mode='daily' requires reset.atHour (0–23). Default: 4." },
          { eq: "idle", message: "reset.mode='idle' requires reset.idleMinutes. Default: 30." },
        ],
      };
      const cfg = { session: { reset: { mode: "daily" } } };
      const errors = checkCrossField(bp, cfg, "session.reset.mode", "daily");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("atHour");
    });

    it("fires advisory for session.reset.mode=idle", () => {
      const bp = {
        pathPattern: "session.reset.mode",
        valueType: "scalar",
        crossField: [
          { eq: "daily", message: "reset.mode='daily' requires reset.atHour (0–23). Default: 4." },
          { eq: "idle", message: "reset.mode='idle' requires reset.idleMinutes. Default: 30." },
        ],
      };
      const errors = checkCrossField(bp, {}, "session.reset.mode", "idle");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("idleMinutes");
    });

    it("does not fire for session.reset.mode=manual", () => {
      const bp = {
        pathPattern: "session.reset.mode",
        valueType: "scalar",
        crossField: [
          { eq: "daily", message: "reset.mode='daily' requires reset.atHour (0–23). Default: 4." },
          { eq: "idle", message: "reset.mode='idle' requires reset.idleMinutes. Default: 30." },
        ],
      };
      const errors = checkCrossField(bp, {}, "session.reset.mode", "manual");
      expect(errors).toHaveLength(0);
    });

    it("fires advisory for maintenance.mode=enforce", () => {
      const bp = {
        pathPattern: "session.maintenance.mode",
        valueType: "scalar",
        crossField: [
          {
            eq: "enforce",
            message: "maintenance.mode='enforce' requires maintenance.pruneAfter (e.g. '7d').",
          },
        ],
      };
      const errors = checkCrossField(bp, {}, "session.maintenance.mode", "enforce");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("pruneAfter");
    });
  });

  // --- crossField: models routing ---
  describe("crossField models routing rules", () => {
    it("fires advisory for routing.enabled=true", () => {
      const bp = {
        pathPattern: "agents.defaults.model.routing.enabled",
        valueType: "scalar",
        crossField: [
          {
            eq: true,
            message:
              "routing.enabled=true requires tier models. Set routing.tiers.simple, .normal, and .complex.",
          },
        ],
      };
      const errors = checkCrossField(bp, {}, "agents.defaults.model.routing.enabled", true);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("tier models");
    });

    it("does not fire for routing.enabled=false", () => {
      const bp = {
        pathPattern: "agents.defaults.model.routing.enabled",
        valueType: "scalar",
        crossField: [{ eq: true, message: "routing.enabled=true requires tier models." }],
      };
      const errors = checkCrossField(bp, {}, "agents.defaults.model.routing.enabled", false);
      expect(errors).toHaveLength(0);
    });
  });

  // --- crossField: security fortress ---
  describe("crossField security fortress rules", () => {
    it("fires advisory for fortress.enabled=true", () => {
      const bp = {
        pathPattern: "security.fortress.enabled",
        valueType: "scalar",
        crossField: [
          {
            eq: true,
            message:
              "Fortress Mode is most effective with vault. Consider enabling security.vault.enabled.",
          },
        ],
      };
      const errors = checkCrossField(bp, {}, "security.fortress.enabled", true);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("vault");
    });
  });

  // --- findBlueprint ---
  describe("findBlueprint", () => {
    it("finds channel allowFrom blueprint", async () => {
      const bp = await findBlueprint("channels.discord.allowFrom");
      expect(bp).toBeDefined();
      expect(bp.pathPattern).toBe("channels.*.allowFrom");
      expect(bp.valueType).toBe("array");
      expect(bp.channelRules?.discord).toBeDefined();
    });

    it("finds channel dmPolicy blueprint", async () => {
      const bp = await findBlueprint("channels.telegram.dmPolicy");
      expect(bp).toBeDefined();
      expect(bp.pathPattern).toBe("channels.*.dmPolicy");
      expect(bp.enumValues).toContain("open");
    });

    it("finds gateway port blueprint", async () => {
      const bp = await findBlueprint("gateway.port");
      expect(bp).toBeDefined();
      expect(bp.itemCoerce).toBe("number");
    });

    it("returns undefined for unknown path", async () => {
      const bp = await findBlueprint("nonexistent.path.here");
      expect(bp).toBeUndefined();
    });

    it("returns undefined for path without blueprint", async () => {
      const bp = await findBlueprint("channels.telegram.someUnknownField");
      expect(bp).toBeUndefined();
    });

    it("caches blueprints after first load", async () => {
      const bp1 = await findBlueprint("channels.discord.allowFrom");
      const bp2 = await findBlueprint("channels.telegram.dmPolicy");
      // Both come from channels section — second call uses cache
      expect(bp1).toBeDefined();
      expect(bp2).toBeDefined();
    });
  });

  // --- subagent delegation blueprints ---
  describe("subagent delegation blueprints", () => {
    it("finds agents.defaults.subagents.maxSpawnDepth", async () => {
      const bp = await findBlueprint("agents.defaults.subagents.maxSpawnDepth");
      expect(bp).toBeDefined();
      expect(bp.valueType).toBe("scalar");
      expect(bp.itemCoerce).toBe("number");
    });

    it("finds agents.defaults.subagents.maxChildrenPerAgent", async () => {
      const bp = await findBlueprint("agents.defaults.subagents.maxChildrenPerAgent");
      expect(bp).toBeDefined();
      expect(bp.itemCoerce).toBe("number");
    });

    it("finds agents.defaults.subagents.maxConcurrent", async () => {
      const bp = await findBlueprint("agents.defaults.subagents.maxConcurrent");
      expect(bp).toBeDefined();
      expect(bp.itemCoerce).toBe("number");
    });

    it("finds agents.defaults.subagents.archiveAfterMinutes", async () => {
      const bp = await findBlueprint("agents.defaults.subagents.archiveAfterMinutes");
      expect(bp).toBeDefined();
      expect(bp.itemCoerce).toBe("number");
    });

    it("finds agents.defaults.subagents.thinking with enumValues", async () => {
      const bp = await findBlueprint("agents.defaults.subagents.thinking");
      expect(bp).toBeDefined();
      expect(bp.enumValues).toContain("off");
      expect(bp.enumValues).toContain("high");
    });

    it("finds per-agent subagents.allowAgents via wildcard", async () => {
      const bp = await findBlueprint("agents.list.seo.subagents.allowAgents");
      expect(bp).toBeDefined();
      expect(bp.pathPattern).toBe("agents.list.*.subagents.allowAgents");
      expect(bp.valueType).toBe("array");
      expect(bp.itemCoerce).toBe("string");
    });

    it("finds per-agent subagents.model via wildcard", async () => {
      const bp = await findBlueprint("agents.list.researcher.subagents.model");
      expect(bp).toBeDefined();
      expect(bp.pathPattern).toBe("agents.list.*.subagents.model");
    });

    it("finds per-agent subagents.thinking via wildcard", async () => {
      const bp = await findBlueprint("agents.list.writer.subagents.thinking");
      expect(bp).toBeDefined();
      expect(bp.enumValues).toContain("medium");
    });

    it("finds tools.agentToAgent.enabled", async () => {
      const bp = await findBlueprint("tools.agentToAgent.enabled");
      expect(bp).toBeDefined();
      expect(bp.itemCoerce).toBe("smart");
    });

    it("finds tools.agentToAgent.allow", async () => {
      const bp = await findBlueprint("tools.agentToAgent.allow");
      expect(bp).toBeDefined();
      expect(bp.valueType).toBe("array");
      expect(bp.itemCoerce).toBe("string");
    });

    it("finds session.agentToAgent.maxPingPongTurns", async () => {
      const bp = await findBlueprint("session.agentToAgent.maxPingPongTurns");
      expect(bp).toBeDefined();
      expect(bp.valueType).toBe("scalar");
      expect(bp.itemCoerce).toBe("number");
    });

    it("routes tools.agentToAgent to agents section", () => {
      expect(resolveSection("tools.agentToAgent.enabled")).toBe("agents");
      expect(resolveSection("tools.agentToAgent.allow")).toBe("agents");
    });

    it("routes session.agentToAgent to session section", () => {
      expect(resolveSection("session.agentToAgent.maxPingPongTurns")).toBe("session");
    });

    it("routes agents.defaults.subagents.model prefix to models section", () => {
      expect(resolveSection("agents.defaults.subagents.model")).toBe("models");
    });

    it("routes agents.defaults.subagents.maxSpawnDepth to agents section", () => {
      expect(resolveSection("agents.defaults.subagents.maxSpawnDepth")).toBe("agents");
    });
  });

  // --- listBlueprintsForSection ---
  describe("listBlueprintsForSection", () => {
    it("lists all channel blueprints", async () => {
      const bps = await listBlueprintsForSection("channels");
      expect(bps.length).toBeGreaterThan(10);
      expect(bps.every((bp) => bp.pathPattern && bp.valueType && bp.guidance)).toBe(true);
    });

    it("lists gateway blueprints", async () => {
      const bps = await listBlueprintsForSection("gateway");
      expect(bps.length).toBeGreaterThan(5);
    });

    it("lists cron blueprints", async () => {
      const bps = await listBlueprintsForSection("cron");
      expect(bps.length).toBeGreaterThan(0);
    });

    it("lists advanced blueprints", async () => {
      const bps = await listBlueprintsForSection("advanced");
      expect(bps.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown section", async () => {
      const bps = await listBlueprintsForSection("nonexistent");
      expect(bps).toEqual([]);
    });
  });
});
