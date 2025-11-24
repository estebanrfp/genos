import { describe, expect, it } from "vitest";
import { resolveAckReaction } from "./identity.js";
describe("resolveAckReaction", () => {
  it("prefers account-level overrides", () => {
    const cfg = {
      messages: { ackReaction: "\uD83D\uDC40" },
      agents: { list: [{ id: "main", identity: { emoji: "\u2705" } }] },
      channels: {
        slack: {
          ackReaction: "eyes",
          accounts: {
            acct1: { ackReaction: " party_parrot " },
          },
        },
      },
    };
    expect(resolveAckReaction(cfg, "main", { channel: "slack", accountId: "acct1" })).toBe(
      "party_parrot",
    );
  });
  it("falls back to channel-level overrides", () => {
    const cfg = {
      messages: { ackReaction: "\uD83D\uDC40" },
      agents: { list: [{ id: "main", identity: { emoji: "\u2705" } }] },
      channels: {
        slack: {
          ackReaction: "eyes",
          accounts: {
            acct1: { ackReaction: "party_parrot" },
          },
        },
      },
    };
    expect(resolveAckReaction(cfg, "main", { channel: "slack", accountId: "missing" })).toBe(
      "eyes",
    );
  });
  it("uses the global ackReaction when channel overrides are missing", () => {
    const cfg = {
      messages: { ackReaction: "\u2705" },
      agents: { list: [{ id: "main", identity: { emoji: "\uD83D\uDE3A" } }] },
    };
    expect(resolveAckReaction(cfg, "main", { channel: "discord" })).toBe("\u2705");
  });
  it("falls back to the agent identity emoji when global config is unset", () => {
    const cfg = {
      agents: { list: [{ id: "main", identity: { emoji: "\uD83D\uDD25" } }] },
    };
    expect(resolveAckReaction(cfg, "main", { channel: "discord" })).toBe("\uD83D\uDD25");
  });
  it("returns the default emoji when no config is present", () => {
    const cfg = {};
    expect(resolveAckReaction(cfg, "main")).toBe("\uD83D\uDC40");
  });
  it("allows empty strings to disable reactions", () => {
    const cfg = {
      messages: { ackReaction: "\uD83D\uDC40" },
      channels: {
        telegram: {
          ackReaction: "",
        },
      },
    };
    expect(resolveAckReaction(cfg, "main", { channel: "telegram" })).toBe("");
  });
});
