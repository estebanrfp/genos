import { afterEach, describe, expect, it, vi } from "vitest";
import { findDuplicateAgentDirs } from "./agent-dirs.js";
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("resolveEffectiveAgentDir via findDuplicateAgentDirs", () => {
  it("uses GENOS_HOME for default agent dir resolution", () => {
    const cfg = {
      agents: {
        list: [{ id: "alpha" }, { id: "beta" }],
      },
    };
    const env = {
      GENOS_HOME: "/srv/genosos-home",
      HOME: "/home/other",
    };
    const dupes = findDuplicateAgentDirs(cfg, { env });
    expect(dupes).toHaveLength(0);
  });
  it("resolves agent dir under GENOS_HOME state dir", () => {
    const cfg = {};
    const env = {
      GENOS_HOME: "/srv/genosos-home",
    };
    const dupes = findDuplicateAgentDirs(cfg, { env });
    expect(dupes).toHaveLength(0);
  });
});
