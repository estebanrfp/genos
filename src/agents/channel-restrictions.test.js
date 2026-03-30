import { describe, expect, it } from "vitest";
import { resolveChannelRestrictions } from "./pi-tools.policy.js";

describe("resolveChannelRestrictions", () => {
  const baseConfig = { agents: { list: [{ id: "main" }] } };

  it("returns undefined for webchat (no restriction)", () => {
    expect(resolveChannelRestrictions({ config: baseConfig, messageProvider: "webchat" })).toBe(
      undefined,
    );
  });

  it("returns undefined when no messageProvider", () => {
    expect(resolveChannelRestrictions({ config: baseConfig })).toBe(undefined);
  });

  it("denies exec/bash/process for whatsapp by default", () => {
    const result = resolveChannelRestrictions({ config: baseConfig, messageProvider: "whatsapp" });
    expect(result.deny).toEqual(["exec", "bash", "process"]);
  });

  it("denies heavy tools for voice by default", () => {
    const result = resolveChannelRestrictions({ config: baseConfig, messageProvider: "voice" });
    expect(result.deny).toContain("exec");
    expect(result.deny).toContain("read");
    expect(result.deny).toContain("browser");
    expect(result.deny.length).toBeGreaterThan(5);
  });

  it("denies exec/bash/process for telegram by default", () => {
    const result = resolveChannelRestrictions({ config: baseConfig, messageProvider: "telegram" });
    expect(result.deny).toEqual(["exec", "bash", "process"]);
  });

  it("uses global channelRestrictions config when present", () => {
    const config = {
      ...baseConfig,
      tools: { channelRestrictions: { whatsapp: { deny: ["exec", "write"] } } },
    };
    const result = resolveChannelRestrictions({ config, messageProvider: "whatsapp" });
    expect(result.deny).toEqual(["exec", "write"]);
  });

  it("per-agent override takes precedence over global", () => {
    const config = {
      tools: { channelRestrictions: { whatsapp: { deny: ["exec", "bash"] } } },
      agents: {
        list: [{ id: "devops", tools: { channelRestrictions: { whatsapp: { deny: [] } } } }],
      },
    };
    const result = resolveChannelRestrictions({
      config,
      agentId: "devops",
      messageProvider: "whatsapp",
    });
    // Empty deny array means no restrictions — pickToolPolicy returns undefined
    // since the array is empty (no allow, no deny entries)
    expect(result?.deny ?? []).toEqual([]);
  });

  it("per-agent override with custom deny", () => {
    const config = {
      agents: {
        list: [
          { id: "sales", tools: { channelRestrictions: { whatsapp: { deny: ["browser"] } } } },
        ],
      },
    };
    const result = resolveChannelRestrictions({
      config,
      agentId: "sales",
      messageProvider: "whatsapp",
    });
    expect(result.deny).toEqual(["browser"]);
  });

  it("unknown external channels get default deny", () => {
    const result = resolveChannelRestrictions({ config: baseConfig, messageProvider: "matrix" });
    expect(result.deny).toEqual(["exec", "bash", "process"]);
  });
});
