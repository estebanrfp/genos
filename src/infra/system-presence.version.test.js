import { describe, expect, it, vi } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
async function withPresenceModule(env, run) {
  return withEnvAsync(env, async () => {
    vi.resetModules();
    try {
      const module = await import("./system-presence.js");
      return await run(module);
    } finally {
      vi.resetModules();
    }
  });
}
describe("system-presence version fallback", () => {
  it("uses GENOS_SERVICE_VERSION when GENOS_VERSION is not set", async () => {
    await withPresenceModule(
      {
        GENOS_SERVICE_VERSION: "2.4.6-service",
        npm_package_version: "1.0.0-package",
      },
      ({ listSystemPresence }) => {
        const selfEntry = listSystemPresence().find((entry) => entry.reason === "self");
        expect(selfEntry?.version).toBe("2.4.6-service");
      },
    );
  });
  it("prefers GENOS_VERSION over GENOS_SERVICE_VERSION", async () => {
    await withPresenceModule(
      {
        GENOS_VERSION: "9.9.9-cli",
        GENOS_SERVICE_VERSION: "2.4.6-service",
        npm_package_version: "1.0.0-package",
      },
      ({ listSystemPresence }) => {
        const selfEntry = listSystemPresence().find((entry) => entry.reason === "self");
        expect(selfEntry?.version).toBe("9.9.9-cli");
      },
    );
  });
  it("uses npm_package_version when GENOS_VERSION and GENOS_SERVICE_VERSION are blank", async () => {
    await withPresenceModule(
      {
        GENOS_VERSION: " ",
        GENOS_SERVICE_VERSION: "\t",
        npm_package_version: "1.0.0-package",
      },
      ({ listSystemPresence }) => {
        const selfEntry = listSystemPresence().find((entry) => entry.reason === "self");
        expect(selfEntry?.version).toBe("1.0.0-package");
      },
    );
  });
});
