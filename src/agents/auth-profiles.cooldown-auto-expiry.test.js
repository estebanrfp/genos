let makeStoreWithProfiles = function () {
  return {
    version: 1,
    profiles: {
      "anthropic:default": { type: "api_key", provider: "anthropic", key: "sk-1" },
      "anthropic:secondary": { type: "api_key", provider: "anthropic", key: "sk-2" },
      "openai:default": { type: "api_key", provider: "openai", key: "sk-oi" },
    },
    usageStats: {},
  };
};
import { describe, expect, it } from "vitest";
import { resolveAuthProfileOrder } from "./auth-profiles/order.js";
import { isProfileInCooldown } from "./auth-profiles/usage.js";
describe("resolveAuthProfileOrder \u2014 cooldown auto-expiry", () => {
  it("places profile with expired cooldown in available list (round-robin path)", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthropic:default": {
        cooldownUntil: Date.now() - 1e4,
        errorCount: 4,
        failureCounts: { rate_limit: 4 },
        lastFailureAt: Date.now() - 70000,
      },
    };
    const order = resolveAuthProfileOrder({ store, provider: "anthropic" });
    expect(order).toContain("anthropic:default");
    expect(isProfileInCooldown(store, "anthropic:default")).toBe(false);
    expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(0);
    expect(store.usageStats?.["anthropic:default"]?.cooldownUntil).toBeUndefined();
  });
  it("places profile with expired cooldown in available list (explicit-order path)", () => {
    const store = makeStoreWithProfiles();
    store.order = { anthropic: ["anthropic:secondary", "anthropic:default"] };
    store.usageStats = {
      "anthropic:default": {
        cooldownUntil: Date.now() - 5000,
        errorCount: 3,
      },
    };
    const order = resolveAuthProfileOrder({ store, provider: "anthropic" });
    expect(order[0]).toBe("anthropic:secondary");
    expect(order).toContain("anthropic:default");
    expect(store.usageStats?.["anthropic:default"]?.cooldownUntil).toBeUndefined();
    expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(0);
  });
  it("keeps profile with active cooldown in cooldown list", () => {
    const futureMs = Date.now() + 300000;
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthropic:default": {
        cooldownUntil: futureMs,
        errorCount: 3,
      },
    };
    const order = resolveAuthProfileOrder({ store, provider: "anthropic" });
    expect(order).toContain("anthropic:default");
    expect(isProfileInCooldown(store, "anthropic:default")).toBe(true);
    expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(3);
  });
  it("expired cooldown resets error count \u2014 prevents escalation on next failure", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthropic:default": {
        cooldownUntil: Date.now() - 1000,
        errorCount: 4,
        failureCounts: { rate_limit: 4 },
        lastFailureAt: Date.now() - 3700000,
      },
    };
    resolveAuthProfileOrder({ store, provider: "anthropic" });
    expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(0);
    expect(store.usageStats?.["anthropic:default"]?.failureCounts).toBeUndefined();
  });
  it("mixed active and expired cooldowns across profiles", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthropic:default": {
        cooldownUntil: Date.now() - 1000,
        errorCount: 3,
      },
      "anthropic:secondary": {
        cooldownUntil: Date.now() + 300000,
        errorCount: 2,
      },
    };
    const order = resolveAuthProfileOrder({ store, provider: "anthropic" });
    expect(store.usageStats?.["anthropic:default"]?.cooldownUntil).toBeUndefined();
    expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(0);
    expect(store.usageStats?.["anthropic:secondary"]?.cooldownUntil).toBeGreaterThan(Date.now());
    expect(store.usageStats?.["anthropic:secondary"]?.errorCount).toBe(2);
    expect(order[0]).toBe("anthropic:default");
  });
  it("does not affect profiles from other providers", () => {
    const store = makeStoreWithProfiles();
    store.usageStats = {
      "anthropic:default": {
        cooldownUntil: Date.now() - 1000,
        errorCount: 4,
      },
      "openai:default": {
        cooldownUntil: Date.now() - 1000,
        errorCount: 3,
      },
    };
    resolveAuthProfileOrder({ store, provider: "anthropic" });
    expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(0);
    expect(store.usageStats?.["openai:default"]?.errorCount).toBe(0);
  });
});
