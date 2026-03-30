let makeCfg = function (overrides = {}) {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
    ...overrides,
  };
};
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./auth-profiles.js", () => ({
  ensureAuthProfileStore: vi.fn(),
  getSoonestCooldownExpiry: vi.fn(),
  isProfileInCooldown: vi.fn(),
  resolveAuthProfileOrder: vi.fn(),
}));
import {
  ensureAuthProfileStore,
  getSoonestCooldownExpiry,
  isProfileInCooldown,
  resolveAuthProfileOrder,
} from "./auth-profiles.js";
import { _probeThrottleInternals, runWithModelFallback } from "./model-fallback.js";
const mockedEnsureAuthProfileStore = vi.mocked(ensureAuthProfileStore);
const mockedGetSoonestCooldownExpiry = vi.mocked(getSoonestCooldownExpiry);
const mockedIsProfileInCooldown = vi.mocked(isProfileInCooldown);
const mockedResolveAuthProfileOrder = vi.mocked(resolveAuthProfileOrder);
describe("runWithModelFallback \u2013 probe logic", () => {
  let realDateNow;
  const NOW = 1700000000000;
  beforeEach(() => {
    realDateNow = Date.now;
    Date.now = vi.fn(() => NOW);
    _probeThrottleInternals.lastProbeAttempt.clear();
    const fakeStore = {
      version: 1,
      profiles: {},
    };
    mockedEnsureAuthProfileStore.mockReturnValue(fakeStore);
    mockedResolveAuthProfileOrder.mockImplementation(({ provider }) => {
      if (provider === "openai") {
        return ["openai-profile-1"];
      }
      if (provider === "anthropic") {
        return ["anthropic-profile-1"];
      }
      if (provider === "google") {
        return ["google-profile-1"];
      }
      return [];
    });
    mockedIsProfileInCooldown.mockImplementation((_store, profileId) => {
      return profileId.startsWith("openai");
    });
  });
  afterEach(() => {
    Date.now = realDateNow;
    vi.restoreAllMocks();
  });
  it("skips primary model when far from cooldown expiry (30 min remaining)", async () => {
    const cfg = makeCfg();
    const expiresIn30Min = NOW + 1800000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(expiresIn30Min);
    const run = vi.fn().mockResolvedValue("ok");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("anthropic", "claude-haiku-3-5");
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });
  it("probes primary model when within 2-min margin of cooldown expiry", async () => {
    const cfg = makeCfg();
    const expiresIn1Min = NOW + 60000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(expiresIn1Min);
    const run = vi.fn().mockResolvedValue("probed-ok");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("probed-ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("openai", "gpt-4.1-mini");
  });
  it("probes primary model when cooldown already expired", async () => {
    const cfg = makeCfg();
    const expiredAlready = NOW - 300000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(expiredAlready);
    const run = vi.fn().mockResolvedValue("recovered");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("recovered");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("openai", "gpt-4.1-mini");
  });
  it("does NOT probe non-primary candidates during cooldown", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
            fallbacks: ["anthropic/claude-haiku-3-5", "google/gemini-2-flash"],
          },
        },
      },
    });
    mockedIsProfileInCooldown.mockReturnValue(true);
    const almostExpired = NOW + 30000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(almostExpired);
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValue("should-not-reach");
    try {
      await runWithModelFallback({
        cfg,
        provider: "openai",
        model: "gpt-4.1-mini",
        run,
      });
      expect.unreachable("should have thrown since all candidates exhausted");
    } catch {
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith("openai", "gpt-4.1-mini");
    }
  });
  it("throttles probe when called within 30s interval", async () => {
    const cfg = makeCfg();
    const almostExpired = NOW + 30000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(almostExpired);
    _probeThrottleInternals.lastProbeAttempt.set("openai", NOW - 1e4);
    const run = vi.fn().mockResolvedValue("ok");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("anthropic", "claude-haiku-3-5");
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });
  it("allows probe when 30s have passed since last probe", async () => {
    const cfg = makeCfg();
    const almostExpired = NOW + 30000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(almostExpired);
    _probeThrottleInternals.lastProbeAttempt.set("openai", NOW - 31000);
    const run = vi.fn().mockResolvedValue("probed-ok");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("probed-ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("openai", "gpt-4.1-mini");
  });
  it("handles non-finite soonest safely (treats as probe-worthy)", async () => {
    const cfg = makeCfg();
    mockedGetSoonestCooldownExpiry.mockReturnValue(Infinity);
    const run = vi.fn().mockResolvedValue("ok-infinity");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("ok-infinity");
    expect(run).toHaveBeenCalledWith("openai", "gpt-4.1-mini");
  });
  it("handles NaN soonest safely (treats as probe-worthy)", async () => {
    const cfg = makeCfg();
    mockedGetSoonestCooldownExpiry.mockReturnValue(NaN);
    const run = vi.fn().mockResolvedValue("ok-nan");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("ok-nan");
    expect(run).toHaveBeenCalledWith("openai", "gpt-4.1-mini");
  });
  it("handles null soonest safely (treats as probe-worthy)", async () => {
    const cfg = makeCfg();
    mockedGetSoonestCooldownExpiry.mockReturnValue(null);
    const run = vi.fn().mockResolvedValue("ok-null");
    const result = await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    });
    expect(result.result).toBe("ok-null");
    expect(run).toHaveBeenCalledWith("openai", "gpt-4.1-mini");
  });
  it("single candidate skips with rate_limit and exhausts candidates", async () => {
    const cfg = makeCfg({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-4.1-mini",
            fallbacks: [],
          },
        },
      },
    });
    const almostExpired = NOW + 30000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(almostExpired);
    const run = vi.fn().mockResolvedValue("unreachable");
    await expect(
      runWithModelFallback({
        cfg,
        provider: "openai",
        model: "gpt-4.1-mini",
        fallbacksOverride: [],
        run,
      }),
    ).rejects.toThrow("All models failed");
    expect(run).not.toHaveBeenCalled();
  });
  it("scopes probe throttling by agentDir to avoid cross-agent suppression", async () => {
    const cfg = makeCfg();
    const almostExpired = NOW + 30000;
    mockedGetSoonestCooldownExpiry.mockReturnValue(almostExpired);
    const run = vi.fn().mockResolvedValue("probed-ok");
    await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir: "/tmp/agent-a",
      run,
    });
    await runWithModelFallback({
      cfg,
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir: "/tmp/agent-b",
      run,
    });
    expect(run).toHaveBeenNthCalledWith(1, "openai", "gpt-4.1-mini");
    expect(run).toHaveBeenNthCalledWith(2, "openai", "gpt-4.1-mini");
  });
});
