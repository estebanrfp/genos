import { describe, expect, it } from "vitest";
import { resolveImageSanitizationLimits } from "./image-sanitization.js";
describe("image sanitization config", () => {
  it("defaults when no config value exists", () => {
    expect(resolveImageSanitizationLimits(undefined)).toEqual({});
    expect(resolveImageSanitizationLimits({ agents: { defaults: {} } })).toEqual({});
  });
  it("reads and normalizes agents.defaults.imageMaxDimensionPx", () => {
    expect(
      resolveImageSanitizationLimits({
        agents: { defaults: { imageMaxDimensionPx: 1600.9 } },
      }),
    ).toEqual({ maxDimensionPx: 1600 });
  });
});
