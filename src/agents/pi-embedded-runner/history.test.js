import { describe, expect, it } from "vitest";
import { getHistoryLimitFromSessionKey, limitHistoryTurns } from "./history.js";

describe("getHistoryLimitFromSessionKey", () => {
  it("returns undefined when no config is provided", () => {
    expect(getHistoryLimitFromSessionKey("agent:default:telegram:dm:123", null)).toBeUndefined();
  });

  it("returns channel-specific dmHistoryLimit", () => {
    const config = { channels: { telegram: { dmHistoryLimit: 10 } } };
    const limit = getHistoryLimitFromSessionKey("agent:default:telegram:dm:123", config);
    expect(limit).toBe(10);
  });

  it("returns channel-specific historyLimit for group/channel kind", () => {
    const config = { channels: { discord: { historyLimit: 15 } } };
    const limit = getHistoryLimitFromSessionKey("agent:default:discord:channel:abc", config);
    expect(limit).toBe(15);
  });

  it("returns per-user DM historyLimit", () => {
    const config = { channels: { telegram: { dms: { 123: { historyLimit: 5 } } } } };
    const limit = getHistoryLimitFromSessionKey("agent:default:telegram:dm:123", config);
    expect(limit).toBe(5);
  });

  it("falls back to global agents.defaults.historyLimit", () => {
    const config = { agents: { defaults: { historyLimit: 5 } } };
    const limit = getHistoryLimitFromSessionKey("agent:default:telegram:dm:123", config);
    expect(limit).toBe(5);
  });

  it("channel-specific limit overrides global default", () => {
    const config = {
      agents: { defaults: { historyLimit: 30 } },
      channels: { telegram: { dmHistoryLimit: 10 } },
    };
    const limit = getHistoryLimitFromSessionKey("agent:default:telegram:dm:123", config);
    expect(limit).toBe(10);
  });

  it("returns undefined when no channel config and no global default", () => {
    const config = { channels: {} };
    const limit = getHistoryLimitFromSessionKey("agent:default:telegram:dm:123", config);
    expect(limit).toBeUndefined();
  });

  it("global fallback applies to group/channel kind too", () => {
    const config = { agents: { defaults: { historyLimit: 20 } } };
    const limit = getHistoryLimitFromSessionKey("agent:default:discord:channel:abc", config);
    expect(limit).toBe(20);
  });

  it("ignores non-positive global historyLimit", () => {
    const config = { agents: { defaults: { historyLimit: 0 } } };
    const limit = getHistoryLimitFromSessionKey("agent:default:telegram:dm:123", config);
    expect(limit).toBeUndefined();
  });
});

describe("limitHistoryTurns", () => {
  it("returns all messages when no limit", () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    expect(limitHistoryTurns(messages, 0)).toEqual(messages);
    expect(limitHistoryTurns(messages, undefined)).toEqual(messages);
  });

  it("returns all messages when under limit", () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    expect(limitHistoryTurns(messages, 5)).toEqual(messages);
  });

  it("prepends truncation notice when messages are dropped", () => {
    const messages = [
      { role: "user", content: "msg1" },
      { role: "assistant", content: "reply1" },
      { role: "user", content: "msg2" },
      { role: "assistant", content: "reply2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "reply3" },
    ];
    const result = limitHistoryTurns(messages, 2);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("truncated");
    expect(result[0].timestamp).toBeGreaterThan(0);
    expect(result[1].content).toBe("msg2");
    expect(result[2].content).toBe("reply2");
    expect(result[3].content).toBe("msg3");
    expect(result[4].content).toBe("reply3");
    expect(result).toHaveLength(5);
  });

  it("truncation notice includes dropped count", () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
    ];
    const result = limitHistoryTurns(messages, 1);
    expect(result[0].content).toContain("4 earlier messages");
  });

  it("returns empty array for empty input", () => {
    expect(limitHistoryTurns([], 5)).toEqual([]);
  });
});
