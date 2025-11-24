let makeFile = function (name = DEFAULT_SOUL_FILENAME) {
  return {
    name,
    path: `/tmp/${name}`,
    content: "base",
    missing: false,
  };
};
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearInternalHooks, registerInternalHook } from "../hooks/internal-hooks.js";
import { applyBootstrapHookOverrides } from "./bootstrap-hooks.js";
import { DEFAULT_SOUL_FILENAME } from "./workspace.js";
describe("applyBootstrapHookOverrides", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());
  it("returns updated files when a hook mutates the context", async () => {
    registerInternalHook("agent:bootstrap", (event) => {
      const context = event.context;
      context.bootstrapFiles = [
        ...context.bootstrapFiles,
        {
          name: "EXTRA.md",
          path: "/tmp/EXTRA.md",
          content: "extra",
          missing: false,
        },
      ];
    });
    const updated = await applyBootstrapHookOverrides({
      files: [makeFile()],
      workspaceDir: "/tmp",
    });
    expect(updated).toHaveLength(2);
    expect(updated[1]?.path).toBe("/tmp/EXTRA.md");
  });
});
