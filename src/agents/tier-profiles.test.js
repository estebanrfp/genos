import { describe, expect, it } from "vitest";
import {
  extractTierModel,
  normalizeTierProfile,
  TIER_CAPABILITY_DEFAULTS,
} from "./tier-profiles.js";

describe("normalizeTierProfile", () => {
  it("string without tierName — no defaults", () => {
    expect(normalizeTierProfile("anthropic/claude-sonnet-4-6")).toEqual({
      model: "anthropic/claude-sonnet-4-6",
    });
  });

  it("string + tierName=normal → thinking: medium", () => {
    expect(normalizeTierProfile("anthropic/claude-sonnet-4-6", "normal")).toEqual({
      model: "anthropic/claude-sonnet-4-6",
      thinking: "medium",
    });
  });

  it("string + tierName=complex → full power", () => {
    expect(normalizeTierProfile("anthropic/claude-opus-4-6", "complex")).toEqual({
      model: "anthropic/claude-opus-4-6",
      thinking: "high",
      verbose: "on",
      reasoning: "on",
    });
  });

  it("string + tierName=simple → no capabilities", () => {
    expect(normalizeTierProfile("anthropic/claude-haiku-4-5", "simple")).toEqual({
      model: "anthropic/claude-haiku-4-5",
    });
  });

  it("object profile ignores tierName — user config wins", () => {
    const input = { model: "anthropic/claude-sonnet-4-6", thinking: "off" };
    expect(normalizeTierProfile(input, "normal")).toEqual(input);
  });

  it("returns full profile from object", () => {
    const input = {
      model: "anthropic/claude-opus-4-6",
      thinking: "high",
      verbose: "on",
      reasoning: "stream",
    };
    expect(normalizeTierProfile(input)).toEqual(input);
  });

  it("handles null/undefined gracefully", () => {
    expect(normalizeTierProfile(null)).toEqual({ model: "" });
    expect(normalizeTierProfile(undefined)).toEqual({ model: "" });
  });
});

describe("TIER_CAPABILITY_DEFAULTS", () => {
  it("simple has no capabilities", () => {
    expect(TIER_CAPABILITY_DEFAULTS.simple).toEqual({});
  });

  it("normal defaults to thinking medium", () => {
    expect(TIER_CAPABILITY_DEFAULTS.normal).toEqual({ thinking: "medium" });
  });

  it("complex defaults to full power", () => {
    expect(TIER_CAPABILITY_DEFAULTS.complex).toEqual({
      thinking: "high",
      verbose: "on",
      reasoning: "on",
    });
  });
});

describe("extractTierModel", () => {
  it("returns string as-is", () => {
    expect(extractTierModel("anthropic/claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
  });

  it("extracts model from object", () => {
    expect(extractTierModel({ model: "anthropic/claude-opus-4-6", thinking: "high" })).toBe(
      "anthropic/claude-opus-4-6",
    );
  });

  it("returns empty string for null", () => {
    expect(extractTierModel(null)).toBe("");
  });
});
