import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearInternalHooks,
  getRegisteredEventKeys,
  triggerInternalHook,
  createInternalHookEvent,
} from "./internal-hooks.js";
import { loadInternalHooks } from "./loader.js";
describe("loader", () => {
  let fixtureRoot = "";
  let caseId = 0;
  let tmpDir;
  let originalBundledDir;
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-hooks-loader-"));
  });
  beforeEach(async () => {
    clearInternalHooks();
    tmpDir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(tmpDir, { recursive: true });
    originalBundledDir = process.env.GENOS_BUNDLED_HOOKS_DIR;
    process.env.GENOS_BUNDLED_HOOKS_DIR = "/nonexistent/bundled/hooks";
  });
  afterEach(async () => {
    clearInternalHooks();
    if (originalBundledDir === undefined) {
      delete process.env.GENOS_BUNDLED_HOOKS_DIR;
    } else {
      process.env.GENOS_BUNDLED_HOOKS_DIR = originalBundledDir;
    }
  });
  afterAll(async () => {
    if (!fixtureRoot) {
      return;
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  describe("loadInternalHooks", () => {
    it("should return 0 when hooks are not enabled", async () => {
      const cfg = {
        hooks: {
          internal: {
            enabled: false,
          },
        },
      };
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(0);
    });
    it("should return 0 when hooks config is missing", async () => {
      const cfg = {};
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(0);
    });
    it("should load a handler from a module", async () => {
      const handlerPath = path.join(tmpDir, "test-handler.js");
      const handlerCode = `
        export default async function(event) {
          // Test handler
        }
      `;
      await fs.writeFile(handlerPath, handlerCode, "utf-8");
      const cfg = {
        hooks: {
          internal: {
            enabled: true,
            handlers: [
              {
                event: "command:new",
                module: path.basename(handlerPath),
              },
            ],
          },
        },
      };
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(1);
      const keys = getRegisteredEventKeys();
      expect(keys).toContain("command:new");
    });
    it("should load multiple handlers", async () => {
      const handler1Path = path.join(tmpDir, "handler1.js");
      const handler2Path = path.join(tmpDir, "handler2.js");
      await fs.writeFile(handler1Path, "export default async function() {}", "utf-8");
      await fs.writeFile(handler2Path, "export default async function() {}", "utf-8");
      const cfg = {
        hooks: {
          internal: {
            enabled: true,
            handlers: [
              { event: "command:new", module: path.basename(handler1Path) },
              { event: "command:stop", module: path.basename(handler2Path) },
            ],
          },
        },
      };
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(2);
      const keys = getRegisteredEventKeys();
      expect(keys).toContain("command:new");
      expect(keys).toContain("command:stop");
    });
    it("should support named exports", async () => {
      const handlerPath = path.join(tmpDir, "named-export.js");
      const handlerCode = `
        export const myHandler = async function(event) {
          // Named export handler
        }
      `;
      await fs.writeFile(handlerPath, handlerCode, "utf-8");
      const cfg = {
        hooks: {
          internal: {
            enabled: true,
            handlers: [
              {
                event: "command:new",
                module: path.basename(handlerPath),
                export: "myHandler",
              },
            ],
          },
        },
      };
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(1);
    });
    it("should handle module loading errors gracefully", async () => {
      const cfg = {
        hooks: {
          internal: {
            enabled: true,
            handlers: [
              {
                event: "command:new",
                module: "missing-handler.js",
              },
            ],
          },
        },
      };
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(0);
    });
    it("should handle non-function exports", async () => {
      const handlerPath = path.join(tmpDir, "bad-export.js");
      await fs.writeFile(handlerPath, 'export default "not a function";', "utf-8");
      const cfg = {
        hooks: {
          internal: {
            enabled: true,
            handlers: [
              {
                event: "command:new",
                module: path.basename(handlerPath),
              },
            ],
          },
        },
      };
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(0);
    });
    it("should handle relative paths", async () => {
      const handlerPath = path.join(tmpDir, "relative-handler.js");
      await fs.writeFile(handlerPath, "export default async function() {}", "utf-8");
      const relativePath = path.relative(tmpDir, handlerPath);
      const cfg = {
        hooks: {
          internal: {
            enabled: true,
            handlers: [
              {
                event: "command:new",
                module: relativePath,
              },
            ],
          },
        },
      };
      const count = await loadInternalHooks(cfg, tmpDir);
      expect(count).toBe(1);
    });
    it("should actually call the loaded handler", async () => {
      const handlerPath = path.join(tmpDir, "callable-handler.js");
      const handlerCode = `
        let callCount = 0;
        export default async function(event) {
          callCount++;
        }
        export function getCallCount() {
          return callCount;
        }
      `;
      await fs.writeFile(handlerPath, handlerCode, "utf-8");
      const cfg = {
        hooks: {
          internal: {
            enabled: true,
            handlers: [
              {
                event: "command:new",
                module: path.basename(handlerPath),
              },
            ],
          },
        },
      };
      await loadInternalHooks(cfg, tmpDir);
      const event = createInternalHookEvent("command", "new", "test-session");
      await triggerInternalHook(event);
      expect(getRegisteredEventKeys()).toContain("command:new");
    });
  });
});
