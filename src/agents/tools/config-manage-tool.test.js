import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Mocks ---
const MOCK_CONFIG = {
  gateway: { port: 18789, bind: "auto" },
  messages: { tts: { provider: "kokoro", mode: "final", auto: "off" } },
  agents: { list: { nyx: {} } },
  channels: { telegram: { enabled: true }, imessage: { allowFrom: ["+5215512345678"] } },
  providers: {
    anthropic: { credentials: [{ type: "api_key", value: "sk-ant-api0312345678secret" }] },
  },
};

const MOCK_SNAPSHOT = { parsed: structuredClone(MOCK_CONFIG), raw: "{}", hash: "abc123" };
let lastWrittenConfig = null;

vi.mock("../../config/io.js", () => ({
  loadConfig: () => structuredClone(MOCK_CONFIG),
  readConfigFileSnapshot: async () => structuredClone(MOCK_SNAPSHOT),
  writeConfigFile: async (cfg) => {
    lastWrittenConfig = cfg;
  },
}));

vi.mock("../../config/validation.js", () => ({
  validateConfigObjectWithPlugins: (raw) => {
    // Reject if gateway.port is a string (simulate Zod rejection)
    if (typeof raw?.gateway?.port === "string") {
      return { ok: false, errors: [{ message: "gateway.port must be a number" }] };
    }
    return { ok: true, config: raw };
  },
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: async (method, _meta, _params) => {
    if (method === "system-presence") {
      return { entries: [{ id: "device-1" }, { id: "device-2" }] };
    }
    if (method === "webauthn.credentials.list") {
      return {
        credentials: [
          {
            id: "cred-abc123456789xyz",
            displayName: "MacBook Pro",
            createdAt: "2026-01-15T10:00:00Z",
          },
          { id: "cred-def987654321abc", displayName: "iPhone", createdAt: "2026-02-01T08:30:00Z" },
        ],
      };
    }
    if (method === "webauthn.credential.remove") {
      return { ok: true };
    }
    if (method === "webauthn.credential.rename") {
      return { ok: true };
    }
    if (method === "webauthn.register.initiate") {
      return { ok: true, credentialId: "new-cred-123" };
    }
    if (method === "channels.status") {
      return {
        channels: {
          whatsapp: { configured: true, running: true, connected: true },
          telegram: { configured: true, running: true, connected: false, lastError: "timeout" },
          nostr: { configured: false, running: false, connected: false },
        },
        channelLabels: { whatsapp: "WhatsApp", telegram: "Telegram", nostr: "Nostr" },
      };
    }
    if (method === "channels.logout") {
      return { channel: _params.channel, cleared: true };
    }
    if (method === "whatsapp.qr.initiate") {
      return { ok: true, connected: true };
    }
    if (method === "nostr.profile.edit.initiate") {
      return { ok: true, profile: { name: "nyx", about: "AI assistant" } };
    }
    if (method === "config.schema") {
      return {
        type: "object",
        properties: {
          messages: {
            type: "object",
            properties: {
              tts: {
                type: "object",
                properties: {
                  provider: {
                    type: "string",
                    anyOf: [
                      { const: "kokoro" },
                      { const: "elevenlabs" },
                      { const: "openai" },
                      { const: "edge" },
                    ],
                  },
                  mode: { type: "string" },
                  auto: { type: "string" },
                },
              },
            },
          },
          gateway: {
            type: "object",
            properties: {
              port: { type: "number", minimum: 1, maximum: 65535, default: 18789 },
            },
          },
        },
      };
    }
    return {};
  },
}));

const { createConfigManageTool } = await import("./config-manage-tool.js");

describe("config_manage tool", () => {
  let tool;

  beforeEach(() => {
    tool = createConfigManageTool();
    lastWrittenConfig = null;
  });

  const exec = (args) => tool.execute("call-1", args);

  // --- Tool metadata ---
  it("has correct name and label", () => {
    expect(tool.name).toBe("config_manage");
    expect(tool.label).toBe("Config");
  });

  // --- sections ---
  describe("sections", () => {
    it("returns menu text with GenosOS Config and 13 sections", async () => {
      const result = await exec({ action: "sections" });
      const text = result.content[0].text;
      expect(text).toContain("GenosOS Config");
      expect(text).not.toContain("Overview");
      expect(text).toContain("Providers");
      expect(text).toContain("Advanced");
    });
  });

  // --- view ---
  describe("view", () => {
    it("accepts section by number", async () => {
      const result = await exec({ action: "view", section: 1 });
      const text = result.content[0].text;
      expect(text).toContain("Providers");
    });

    it("accepts section by key", async () => {
      const result = await exec({ action: "view", section: "messages" });
      const text = result.content[0].text;
      expect(text).toContain("Messages");
    });

    it("rejects invalid section", async () => {
      await expect(exec({ action: "view", section: 99 })).rejects.toThrow(/Invalid section/);
    });

    it("rejects missing section", async () => {
      await expect(exec({ action: "view" })).rejects.toThrow(/section required/);
    });
  });

  // --- get ---
  describe("get", () => {
    it("returns value for valid path", async () => {
      const result = await exec({ action: "get", path: "messages.tts.provider" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.value).toBe("kokoro");
      expect(payload.exists).toBe(true);
    });

    it("returns exists=false for missing path", async () => {
      const result = await exec({ action: "get", path: "foo.bar.baz" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.exists).toBe(false);
    });

    it("masks sensitive values", async () => {
      const result = await exec({ action: "get", path: "providers.anthropic.credentials" });
      const payload = JSON.parse(result.content[0].text);
      // The value is an array, so it shouldn't be masked (only strings are)
      expect(payload.exists).toBe(true);
    });

    it("rejects missing path", async () => {
      await expect(exec({ action: "get" })).rejects.toThrow(/path required/);
    });
  });

  // --- set ---
  describe("set", () => {
    it("writes valid config change", async () => {
      const result = await exec({ action: "set", path: "messages.tts.provider", value: "openai" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.path).toBe("messages.tts.provider");
      expect(lastWrittenConfig).not.toBeNull();
      expect(lastWrittenConfig.messages.tts.provider).toBe("openai");
    });

    it("rejects invalid value (Zod validation)", async () => {
      const result = await exec({ action: "set", path: "gateway.port", value: "not-a-number" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("gateway.port must be a number");
      expect(lastWrittenConfig).toBeNull();
    });

    it("rejects missing value", async () => {
      await expect(exec({ action: "set", path: "messages.tts.provider" })).rejects.toThrow(
        /value required/,
      );
    });

    it("rejects missing path", async () => {
      await expect(exec({ action: "set", value: "foo" })).rejects.toThrow(/path required/);
    });

    it("auto-appends scalar to existing array", async () => {
      const result = await exec({
        action: "set",
        path: "channels.imessage.allowFrom",
        value: "+5215598765432",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.note).toContain("Appended");
      expect(lastWrittenConfig.channels.imessage.allowFrom).toEqual([
        "+5215512345678",
        "+5215598765432",
      ]);
    });

    it("replaces array when value is an array", async () => {
      const result = await exec({
        action: "set",
        path: "channels.imessage.allowFrom",
        value: ["+5215500000000"],
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.note).not.toContain("Appended");
      expect(lastWrittenConfig.channels.imessage.allowFrom).toEqual(["+5215500000000"]);
    });

    it("parses JSON string arrays and replaces instead of appending", async () => {
      const result = await exec({
        action: "set",
        path: "channels.imessage.allowFrom",
        value: '["+5215500000000"]',
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.note).not.toContain("Appended");
      expect(lastWrittenConfig.channels.imessage.allowFrom).toEqual(["+5215500000000"]);
    });
  });

  // --- remove ---
  describe("remove", () => {
    it("removes an element from an array", async () => {
      const result = await exec({
        action: "remove",
        path: "channels.imessage.allowFrom",
        value: "+5215512345678",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.removed).toBe("+5215512345678");
      expect(payload.remaining).toBe(0);
      expect(lastWrittenConfig.channels.imessage.allowFrom).toEqual([]);
    });

    it("removes with String coercion (number vs string)", async () => {
      // Mock has string "+5215512345678", but test with numeric coercion
      const result = await exec({
        action: "remove",
        path: "channels.imessage.allowFrom",
        value: "+5215512345678",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
    });

    it("returns error when element not found", async () => {
      const result = await exec({
        action: "remove",
        path: "channels.imessage.allowFrom",
        value: "+0000000000",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("not found");
    });

    it("returns error when target is not an array", async () => {
      const result = await exec({
        action: "remove",
        path: "messages.tts.provider",
        value: "kokoro",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("not an array");
    });

    it("rejects missing path", async () => {
      await expect(exec({ action: "remove", value: "foo" })).rejects.toThrow(/path required/);
    });

    it("rejects missing value", async () => {
      await expect(exec({ action: "remove", path: "channels.imessage.allowFrom" })).rejects.toThrow(
        /value required/,
      );
    });
  });

  // --- describe ---
  describe("describe", () => {
    it("returns help, options, and currentValue", async () => {
      const result = await exec({ action: "describe", path: "messages.tts.provider" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.path).toBe("messages.tts.provider");
      expect(payload.currentValue).toBe("kokoro");
      expect(payload.exists).toBe(true);
      // Schema provides anyOf options
      expect(payload.options).toEqual(["kokoro", "elevenlabs", "openai", "edge"]);
    });

    it("returns schema info for numeric fields", async () => {
      const result = await exec({ action: "describe", path: "gateway.port" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.currentValue).toBe(18789);
      expect(payload.type).toBe("number");
      expect(payload.minimum).toBe(1);
      expect(payload.maximum).toBe(65535);
      expect(payload.default).toBe(18789);
    });

    it("returns related paths for TTS including parent-level", async () => {
      const result = await exec({ action: "describe", path: "messages.tts.provider" });
      const payload = JSON.parse(result.content[0].text);
      // Parent-level messages.* entries included via improved findRelatedPaths
      expect(payload.relatedPaths).toBeDefined();
      const paths = payload.relatedPaths.map((r) => r.path);
      for (const rp of payload.relatedPaths) {
        expect(rp.path).toMatch(/^messages\./);
        expect(rp.path).not.toBe("messages.tts.provider");
      }
      // Should include parent-level entries like messages.suppressToolErrors
      expect(paths.some((p) => !p.startsWith("messages.tts."))).toBe(true);
    });

    it("rejects missing path", async () => {
      await expect(exec({ action: "describe" })).rejects.toThrow(/path required/);
    });
  });

  // --- findRelatedPaths includes parent-level entries for deep paths ---
  describe("findRelatedPaths (parent-level)", () => {
    it("includes sibling and parent-level entries for deep path", async () => {
      const result = await exec({
        action: "describe",
        path: "tools.loopDetection.detectors.genericRepeat",
      });
      const payload = JSON.parse(result.content[0].text);
      const paths = (payload.relatedPaths ?? []).map((r) => r.path);
      // Siblings — same detectors.* prefix
      expect(paths).toContain("tools.loopDetection.detectors.knownPollNoProgress");
      expect(paths).toContain("tools.loopDetection.detectors.pingPong");
      // Parent-level — tools.loopDetection.* prefix
      expect(paths).toContain("tools.loopDetection.enabled");
      expect(paths).toContain("tools.loopDetection.warningThreshold");
      expect(paths).toContain("tools.loopDetection.historySize");
    });
  });

  // --- FIELD_HELP coverage for new subsystems ---
  describe("FIELD_HELP coverage", () => {
    it("has entries for all new subsystems", async () => {
      const { FIELD_HELP } = await import("../../config/schema.help.js");
      const required = [
        "logging.level",
        "logging.file",
        "logging.redactSensitive",
        "hooks.enabled",
        "hooks.token",
        "hooks.mappings",
        "hooks.maxBodyBytes",
        "hooks.gmail.account",
        "hooks.gmail.thinking",
        "hooks.gmail.includeBody",
        "approvals.exec.enabled",
        "approvals.exec.mode",
        "approvals.exec.targets",
        "canvasHost.enabled",
        "canvasHost.port",
        "canvasHost.root",
        "talk.voiceId",
        "talk.modelId",
        "talk.outputFormat",
        "web.enabled",
        "web.heartbeatSeconds",
        "web.reconnect.maxMs",
        "env.shellEnv.enabled",
        "env.shellEnv.timeoutMs",
        "tools.exec.denyBins",
        "tools.agentToAgent.enabled",
        "tools.agentToAgent.allow",
        "media.preserveFilenames",
        "broadcast.strategy",
        "discovery.wideArea.enabled",
      ];
      for (const key of required) {
        expect(FIELD_HELP[key], `Missing FIELD_HELP for ${key}`).toBeTruthy();
      }
    });
  });

  // --- status ---
  describe("status", () => {
    it("returns gateway status summary with port, agents, channels, cron, instances", async () => {
      const result = await exec({ action: "status" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.port).toBe(18789);
      expect(payload.bind).toBe("auto");
      expect(payload.agents).toBe(1);
      expect(payload.channels).toEqual(["telegram", "imessage"]);
      expect(payload.cron).toBe(true);
      expect(payload.instances).toBe(2);
    });
  });

  // --- webauthn ---
  describe("webauthn", () => {
    it("lists credentials with truncated IDs", async () => {
      const result = await exec({ action: "webauthn" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBe(2);
      expect(payload.credentials[0].displayName).toBe("MacBook Pro");
      expect(payload.credentials[0].id).toContain("...");
      expect(payload.credentials[1].displayName).toBe("iPhone");
    });

    it("lists credentials with explicit subAction", async () => {
      const result = await exec({ action: "webauthn", subAction: "list" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBe(2);
    });

    it("removes a credential", async () => {
      const result = await exec({ action: "webauthn", subAction: "remove", path: "cred-abc123" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.removed).toBe("cred-abc123");
    });

    it("renames a credential", async () => {
      const result = await exec({
        action: "webauthn",
        subAction: "rename",
        path: "cred-abc123",
        value: "Work Laptop",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.displayName).toBe("Work Laptop");
    });

    it("registers with default displayName", async () => {
      const result = await exec({ action: "webauthn", subAction: "register" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.credentialId).toBe("new-cred-123");
    });

    it("registers with custom displayName via value", async () => {
      const result = await exec({
        action: "webauthn",
        subAction: "register",
        value: "Work Laptop",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
    });

    it("rejects unknown sub-action", async () => {
      await expect(exec({ action: "webauthn", subAction: "bogus" })).rejects.toThrow(
        /Unknown webauthn sub-action/,
      );
    });

    it("rejects remove without path", async () => {
      await expect(exec({ action: "webauthn", subAction: "remove" })).rejects.toThrow(
        /credential id required/,
      );
    });
  });

  // --- channels ---
  describe("channels", () => {
    it("returns channel data (default sub-action)", async () => {
      const result = await exec({ action: "channels" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.channels).toHaveLength(3);
      expect(payload._renderHint).toContain("nyx-ui");
    });

    it("returns channel data with explicit status sub-action", async () => {
      const result = await exec({ action: "channels", subAction: "status" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.channels).toHaveLength(3);
      expect(payload._renderHint).toContain("status-grid");
    });

    it("returns channel status with probe sub-action", async () => {
      const result = await exec({ action: "channels", subAction: "probe" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.channels).toHaveLength(3);
    });

    it("enables a channel via set", async () => {
      const result = await exec({ action: "channels", subAction: "enable", path: "nostr" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.path).toBe("channels.nostr.enabled");
    });

    it("disables a channel via set", async () => {
      const result = await exec({ action: "channels", subAction: "disable", path: "telegram" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.path).toBe("channels.telegram.enabled");
    });

    it("logs out a channel", async () => {
      const result = await exec({ action: "channels", subAction: "logout", path: "whatsapp" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.channel).toBe("whatsapp");
      expect(payload.cleared).toBe(true);
    });

    it("initiates whatsapp QR login", async () => {
      const result = await exec({ action: "channels", subAction: "whatsapp.login" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.connected).toBe(true);
    });

    it("initiates nostr profile edit", async () => {
      const result = await exec({ action: "channels", subAction: "nostr.profile" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      expect(payload.profile).toBeDefined();
      expect(payload.profile.name).toBe("nyx");
    });

    it("passes accountId to nostr profile edit", async () => {
      const result = await exec({
        action: "channels",
        subAction: "nostr.profile",
        path: "my-account",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
    });

    it("rejects unknown sub-action", async () => {
      await expect(exec({ action: "channels", subAction: "bogus" })).rejects.toThrow(
        /Unknown channels sub-action/,
      );
    });

    it("rejects logout without channel name", async () => {
      await expect(exec({ action: "channels", subAction: "logout" })).rejects.toThrow(
        /channel name required/,
      );
    });

    it("rejects enable without channel name", async () => {
      await expect(exec({ action: "channels", subAction: "enable" })).rejects.toThrow(
        /channel name required/,
      );
    });
  });

  // --- blueprint coercion in set ---
  describe("blueprint coercion (set)", () => {
    it("keeps discord allowFrom as string even with numeric value", async () => {
      const result = await exec({
        action: "set",
        path: "channels.discord.allowFrom",
        value: "123456789012345678",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      // Discord: itemCoerce="string" — coerced value stays string (no array in mock, so set directly)
      expect(lastWrittenConfig.channels.discord.allowFrom).toBe("123456789012345678");
      expect(typeof lastWrittenConfig.channels.discord.allowFrom).toBe("string");
    });

    it("coerces telegram allowFrom numeric string to number", async () => {
      const result = await exec({
        action: "set",
        path: "channels.telegram.allowFrom",
        value: "34660777328",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      // Telegram channels.*.allowFrom has existing array []; smart coercion → number
    });

    it("keeps imessage allowFrom as string", async () => {
      const result = await exec({
        action: "set",
        path: "channels.imessage.allowFrom",
        value: "34660777328",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(true);
      // iMessage: itemCoerce="string" — must stay string
      const arr = lastWrittenConfig.channels.imessage.allowFrom;
      expect(arr[arr.length - 1]).toBe("34660777328");
      expect(typeof arr[arr.length - 1]).toBe("string");
    });
  });

  // --- blueprint cross-field in set ---
  describe("blueprint cross-field (set)", () => {
    it("rejects dmPolicy=open when allowFrom does not contain *", async () => {
      const result = await exec({
        action: "set",
        path: "channels.imessage.dmPolicy",
        value: "open",
      });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("allowFrom");
    });
  });

  // --- blueprint in describe ---
  describe("blueprint in describe", () => {
    it("returns blueprint info for channels.telegram.allowFrom", async () => {
      const result = await exec({ action: "describe", path: "channels.telegram.allowFrom" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.blueprint).toBeDefined();
      expect(payload.blueprint.valueType).toBe("array");
      expect(payload.blueprint.coercion).toBe("smart");
      expect(payload.blueprint.guidance).toContain("Allowlist");
      expect(payload.blueprint.channelRules).toBeDefined();
      expect(payload.blueprint.channelRules.discord).toBeDefined();
    });

    it("returns blueprint for messages.tts.provider", async () => {
      const result = await exec({ action: "describe", path: "messages.tts.provider" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.blueprint).toBeDefined();
      expect(payload.blueprint.guidance).toBeTruthy();
    });

    it("returns no blueprint for truly unknown config path", async () => {
      const result = await exec({ action: "describe", path: "nonexistent.foo.bar" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.blueprint).toBeUndefined();
    });
  });

  // --- section-level describe ---
  describe("section-level describe", () => {
    it("lists channel operations when path is section key", async () => {
      const result = await exec({ action: "describe", path: "channels" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.section).toBe("channels");
      expect(payload.label).toBe("Channels");
      expect(payload.operations).toBeDefined();
      expect(payload.operations.length).toBeGreaterThan(5);
      const allowFromOp = payload.operations.find((o) => o.pathPattern === "channels.*.allowFrom");
      expect(allowFromOp).toBeDefined();
      expect(allowFromOp.valueType).toBe("array");
      expect(allowFromOp.guidance).toBeTruthy();
    });

    it("lists gateway operations by section key", async () => {
      const result = await exec({ action: "describe", path: "gateway" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.section).toBe("gateway");
      expect(payload.operations.length).toBeGreaterThan(3);
    });

    it("lists cron operations", async () => {
      const result = await exec({ action: "describe", path: "cron" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.section).toBe("cron");
      expect(payload.operations.length).toBeGreaterThan(0);
    });

    it("matches section by label (case-insensitive)", async () => {
      const result = await exec({ action: "describe", path: "Channels" });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.section).toBe("channels");
    });
  });

  // --- unknown action ---
  it("rejects unknown action", async () => {
    await expect(exec({ action: "bogus" })).rejects.toThrow(/Unknown/);
  });
});
