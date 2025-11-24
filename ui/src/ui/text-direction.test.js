import { describe, expect, it } from "vitest";
import { detectTextDirection } from "./text-direction.js";
describe("detectTextDirection", () => {
  it("returns ltr for null and empty input", () => {
    expect(detectTextDirection(null)).toBe("ltr");
    expect(detectTextDirection("")).toBe("ltr");
  });
  it("detects rtl when first significant char is rtl script", () => {
    expect(detectTextDirection("\u05E9\u05DC\u05D5\u05DD \u05E2\u05D5\u05DC\u05DD")).toBe("rtl");
    expect(detectTextDirection("\u0645\u0631\u062D\u0628\u0627")).toBe("rtl");
  });
  it("detects ltr when first significant char is ltr", () => {
    expect(detectTextDirection("Hello world")).toBe("ltr");
  });
  it("skips punctuation and markdown prefix characters before detection", () => {
    expect(detectTextDirection("**\u05E9\u05DC\u05D5\u05DD")).toBe("rtl");
    expect(detectTextDirection("# \u0645\u0631\u062D\u0628\u0627")).toBe("rtl");
    expect(detectTextDirection("- hello")).toBe("ltr");
  });
});
