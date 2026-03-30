let makeStore = function (usageStats) {
  return {
    version: 1,
    profiles: {},
    usageStats,
  };
};
import { describe, expect, it } from "vitest";
import { getSoonestCooldownExpiry } from "./auth-profiles.js";
describe("getSoonestCooldownExpiry", () => {
  it("returns null when no cooldown timestamps exist", () => {
    const store = makeStore();
    expect(getSoonestCooldownExpiry(store, ["openai:p1"])).toBeNull();
  });
  it("returns earliest unusable time across profiles", () => {
    const store = makeStore({
      "openai:p1": {
        cooldownUntil: 1700000002000,
        disabledUntil: 1700000004000,
      },
      "openai:p2": {
        cooldownUntil: 1700000003000,
      },
      "openai:p3": {
        disabledUntil: 1700000001000,
      },
    });
    expect(getSoonestCooldownExpiry(store, ["openai:p1", "openai:p2", "openai:p3"])).toBe(
      1700000001000,
    );
  });
  it("ignores unknown profiles and invalid cooldown values", () => {
    const store = makeStore({
      "openai:p1": {
        cooldownUntil: -1,
      },
      "openai:p2": {
        cooldownUntil: Infinity,
      },
      "openai:p3": {
        disabledUntil: NaN,
      },
      "openai:p4": {
        cooldownUntil: 1700000005000,
      },
    });
    expect(
      getSoonestCooldownExpiry(store, [
        "missing",
        "openai:p1",
        "openai:p2",
        "openai:p3",
        "openai:p4",
      ]),
    ).toBe(1700000005000);
  });
  it("returns past timestamps when cooldown already expired", () => {
    const store = makeStore({
      "openai:p1": {
        cooldownUntil: 1700000000000,
      },
      "openai:p2": {
        disabledUntil: 1700000010000,
      },
    });
    expect(getSoonestCooldownExpiry(store, ["openai:p1", "openai:p2"])).toBe(1700000000000);
  });
});
