import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHomePrefix, resolveEffectiveHomeDir, resolveRequiredHomeDir } from "./home-dir.js";
describe("resolveEffectiveHomeDir", () => {
  it("prefers GENOS_HOME over HOME and USERPROFILE", () => {
    const env = {
      GENOS_HOME: "/srv/genosos-home",
      HOME: "/home/other",
      USERPROFILE: "C:/Users/other",
    };
    expect(resolveEffectiveHomeDir(env, () => "/fallback")).toBe(path.resolve("/srv/genosos-home"));
  });
  it("falls back to HOME then USERPROFILE then homedir", () => {
    expect(resolveEffectiveHomeDir({ HOME: "/home/alice" })).toBe(path.resolve("/home/alice"));
    expect(resolveEffectiveHomeDir({ USERPROFILE: "C:/Users/alice" })).toBe(
      path.resolve("C:/Users/alice"),
    );
    expect(resolveEffectiveHomeDir({}, () => "/fallback")).toBe(path.resolve("/fallback"));
  });
  it("expands GENOS_HOME when set to ~", () => {
    const env = {
      GENOS_HOME: "~/svc",
      HOME: "/home/alice",
    };
    expect(resolveEffectiveHomeDir(env)).toBe(path.resolve("/home/alice/svc"));
  });
});
describe("resolveRequiredHomeDir", () => {
  it("returns cwd when no home source is available", () => {
    expect(
      resolveRequiredHomeDir({}, () => {
        throw new Error("no home");
      }),
    ).toBe(process.cwd());
  });
  it("returns a fully resolved path for GENOS_HOME", () => {
    const result = resolveRequiredHomeDir({ GENOS_HOME: "/custom/home" }, () => "/fallback");
    expect(result).toBe(path.resolve("/custom/home"));
  });
  it("returns cwd when GENOS_HOME is tilde-only and no fallback home exists", () => {
    expect(
      resolveRequiredHomeDir({ GENOS_HOME: "~" }, () => {
        throw new Error("no home");
      }),
    ).toBe(process.cwd());
  });
});
describe("expandHomePrefix", () => {
  it("expands tilde using effective home", () => {
    const value = expandHomePrefix("~/x", {
      env: { GENOS_HOME: "/srv/genosos-home" },
    });
    expect(value).toBe(`${path.resolve("/srv/genosos-home")}/x`);
  });
  it("keeps non-tilde values unchanged", () => {
    expect(expandHomePrefix("/tmp/x")).toBe("/tmp/x");
  });
});
