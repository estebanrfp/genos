let row = function (overrides) {
  return { kind: "direct", updatedAt: 0, ...overrides };
};
import { describe, expect, it } from "vitest";
import { parseSessionKey, resolveSessionDisplayName } from "./app-render.helpers.js";
describe("parseSessionKey", () => {
  it("identifies main session (bare 'main')", () => {
    expect(parseSessionKey("main")).toEqual({ prefix: "", fallbackName: "Main Session" });
  });
  it("identifies main session (agent:main:main)", () => {
    expect(parseSessionKey("agent:main:main")).toEqual({
      prefix: "",
      fallbackName: "Main Session",
    });
  });
  it("identifies subagent sessions", () => {
    expect(parseSessionKey("agent:main:subagent:18abfefe-1fa6-43cb-8ba8-ebdc9b43e253")).toEqual({
      prefix: "",
      fallbackName: "Subagent",
    });
  });
  it("identifies cron sessions", () => {
    expect(parseSessionKey("agent:main:cron:daily-briefing-uuid")).toEqual({
      prefix: "Cron:",
      fallbackName: "Cron Job:",
    });
  });
  it("identifies direct chat with known channel", () => {
    expect(parseSessionKey("agent:main:bluebubbles:direct:+19257864429")).toEqual({
      prefix: "",
      fallbackName: "IMESSAGE: +19257864429",
    });
  });
  it("identifies direct chat with telegram", () => {
    expect(parseSessionKey("agent:main:telegram:direct:user123")).toEqual({
      prefix: "",
      fallbackName: "TELEGRAM: user123",
    });
  });
  it("identifies group chat with known channel", () => {
    expect(parseSessionKey("agent:main:discord:group:guild-chan")).toEqual({
      prefix: "",
      fallbackName: "Discord Group",
    });
  });
  it("capitalises unknown channels in direct/group patterns", () => {
    expect(parseSessionKey("agent:main:mychannel:direct:user1")).toEqual({
      prefix: "",
      fallbackName: "MYCHANNEL: user1",
    });
  });
  it("extracts identifier from flat gateway direct keys", () => {
    expect(parseSessionKey("bluebubbles:g-agent-main-bluebubbles-direct-+19257864429")).toEqual({
      prefix: "",
      fallbackName: "IMESSAGE: +19257864429",
    });
    expect(parseSessionKey("whatsapp:g-agent-main-whatsapp-direct-+34660777328")).toEqual({
      prefix: "",
      fallbackName: "WHATSAPP: +34660777328",
    });
  });
  it("extracts group from flat gateway group keys", () => {
    expect(parseSessionKey("discord:g-agent-main-discord-group-guild123")).toEqual({
      prefix: "",
      fallbackName: "Discord Group",
    });
  });
  it("identifies channel-prefixed legacy keys without direct/group", () => {
    expect(parseSessionKey("discord:123:456")).toEqual({
      prefix: "",
      fallbackName: "Discord Session",
    });
  });
  it("handles bare channel name as key", () => {
    expect(parseSessionKey("telegram")).toEqual({
      prefix: "",
      fallbackName: "Telegram Session",
    });
  });
  it("returns raw key for unknown patterns", () => {
    expect(parseSessionKey("something-unknown")).toEqual({
      prefix: "",
      fallbackName: "something-unknown",
    });
  });
});
describe("resolveSessionDisplayName", () => {
  it("returns 'Main Session' for agent:main:main key", () => {
    expect(resolveSessionDisplayName("agent:main:main")).toBe("Main Session");
  });
  it("returns 'Main Session' for bare 'main' key", () => {
    expect(resolveSessionDisplayName("main")).toBe("Main Session");
  });
  it("returns 'Subagent' for subagent key without row", () => {
    expect(resolveSessionDisplayName("agent:main:subagent:abc-123")).toBe("Subagent");
  });
  it("returns 'Cron Job:' for cron key without row", () => {
    expect(resolveSessionDisplayName("agent:main:cron:abc-123")).toBe("Cron Job:");
  });
  it("parses direct chat key with channel", () => {
    expect(resolveSessionDisplayName("agent:main:bluebubbles:direct:+19257864429")).toBe(
      "IMESSAGE: +19257864429",
    );
  });
  it("parses channel-prefixed legacy key", () => {
    expect(resolveSessionDisplayName("discord:123:456")).toBe("Discord Session");
  });
  it("returns raw key for unknown patterns", () => {
    expect(resolveSessionDisplayName("something-custom")).toBe("something-custom");
  });
  it("returns parsed fallback when row has no label or displayName", () => {
    expect(resolveSessionDisplayName("agent:main:main", row({ key: "agent:main:main" }))).toBe(
      "Main Session",
    );
  });
  it("returns parsed fallback when displayName matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", displayName: "mykey" }))).toBe(
      "mykey",
    );
  });
  it("returns parsed fallback when label matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", label: "mykey" }))).toBe("mykey");
  });
  it("ignores label that is just the key in different case", () => {
    expect(
      resolveSessionDisplayName(
        "whatsapp:g-agent-main-whatsapp-direct-+34660777328",
        row({
          key: "whatsapp:g-agent-main-whatsapp-direct-+34660777328",
          label: "WHATSAPP:G-AGENT-MAIN-WHATSAPP-DIRECT-+34660777328",
        }),
      ),
    ).toBe("WHATSAPP: +34660777328");
  });
  it("uses label alone when available", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", label: "General" }),
      ),
    ).toBe("General");
  });
  it("falls back to displayName when label is absent", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat" }),
      ),
    ).toBe("My Chat");
  });
  it("prefers label over displayName when both are present", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat", label: "General" }),
      ),
    ).toBe("General");
  });
  it("ignores whitespace-only label and falls back to displayName", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat", label: "   " }),
      ),
    ).toBe("My Chat");
  });
  it("uses parsed fallback when whitespace-only label and no displayName", () => {
    expect(
      resolveSessionDisplayName("discord:123:456", row({ key: "discord:123:456", label: "   " })),
    ).toBe("Discord Session");
  });
  it("trims label and displayName", () => {
    expect(resolveSessionDisplayName("k", row({ key: "k", label: "  General  " }))).toBe("General");
    expect(resolveSessionDisplayName("k", row({ key: "k", displayName: "  My Chat  " }))).toBe(
      "My Chat",
    );
  });
  it("uses subagent label directly (no prefix)", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", label: "maintainer-v2" }),
      ),
    ).toBe("maintainer-v2");
  });
  it("uses subagent displayName directly (no prefix)", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", displayName: "Task Runner" }),
      ),
    ).toBe("Task Runner");
  });
  it("prefixes cron label with Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", label: "daily-briefing" }),
      ),
    ).toBe("Cron: daily-briefing");
  });
  it("prefixes cron displayName with Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", displayName: "Nightly Sync" }),
      ),
    ).toBe("Cron: Nightly Sync");
  });
  it("does not double-prefix cron labels that already include Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", label: "Cron: Nightly Sync" }),
      ),
    ).toBe("Cron: Nightly Sync");
  });
  it("uses subagent displayName as-is even if it includes Subagent:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", displayName: "Subagent: Runner" }),
      ),
    ).toBe("Subagent: Runner");
  });
  it("does not prefix non-typed sessions with labels", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:bluebubbles:direct:+19257864429",
        row({ key: "agent:main:bluebubbles:direct:+19257864429", label: "Tyler" }),
      ),
    ).toBe("Tyler");
  });
});
