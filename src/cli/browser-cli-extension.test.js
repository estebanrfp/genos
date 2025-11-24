let setFile = function (p, content = "") {
    const resolved = abs(p);
    state.entries.set(resolved, { kind: "file", content });
    setDir(path.dirname(resolved));
  },
  setDir = function (p) {
    const resolved = abs(p);
    if (!state.entries.has(resolved)) {
      state.entries.set(resolved, { kind: "dir" });
    }
  },
  copyTree = function (src, dest) {
    const srcAbs = abs(src);
    const destAbs = abs(dest);
    const srcPrefix = `${srcAbs}${path.sep}`;
    for (const [key, entry] of state.entries.entries()) {
      if (key === srcAbs || key.startsWith(srcPrefix)) {
        const rel = key === srcAbs ? "" : key.slice(srcPrefix.length);
        const next = rel ? path.join(destAbs, rel) : destAbs;
        state.entries.set(next, entry);
      }
    }
  },
  writeManifest = function (dir) {
    setDir(dir);
    setFile(path.join(dir, "manifest.json"), JSON.stringify({ manifest_version: 3 }));
  };
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const copyToClipboard = vi.fn();
const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};
const state = vi.hoisted(() => ({
  entries: new Map(),
  counter: 0,
}));
const abs = (p) => path.resolve(p);
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  const pathMod = await import("node:path");
  const absInMock = (p) => pathMod.resolve(p);
  const wrapped = {
    ...actual,
    existsSync: (p) => state.entries.has(absInMock(p)),
    mkdirSync: (p, _opts) => {
      setDir(p);
    },
    writeFileSync: (p, content) => {
      setFile(p, content);
    },
    renameSync: (from, to) => {
      const fromAbs = absInMock(from);
      const toAbs = absInMock(to);
      const entry = state.entries.get(fromAbs);
      if (!entry) {
        throw new Error(`ENOENT: no such file or directory, rename '${from}' -> '${to}'`);
      }
      state.entries.delete(fromAbs);
      state.entries.set(toAbs, entry);
    },
    rmSync: (p) => {
      const root = absInMock(p);
      const prefix = `${root}${pathMod.sep}`;
      const keys = Array.from(state.entries.keys());
      for (const key of keys) {
        if (key === root || key.startsWith(prefix)) {
          state.entries.delete(key);
        }
      }
    },
    mkdtempSync: (prefix) => {
      const dir = `${prefix}${state.counter++}`;
      setDir(dir);
      return dir;
    },
    promises: {
      ...actual.promises,
      cp: async (src, dest, _opts) => {
        copyTree(src, dest);
      },
    },
  };
  return { ...wrapped, default: wrapped };
});
vi.mock("../infra/clipboard.js", () => ({
  copyToClipboard,
}));
vi.mock("../runtime.js", () => ({
  defaultRuntime: runtime,
}));
let resolveBundledExtensionRootDir;
let installChromeExtension;
let registerBrowserExtensionCommands;
beforeAll(async () => {
  ({ resolveBundledExtensionRootDir, installChromeExtension, registerBrowserExtensionCommands } =
    await import("./browser-cli-extension.js"));
});
beforeEach(() => {
  state.entries.clear();
  state.counter = 0;
  copyToClipboard.mockReset();
  runtime.log.mockReset();
  runtime.error.mockReset();
  runtime.exit.mockReset();
  vi.clearAllMocks();
});
describe("bundled extension resolver (fs-mocked)", () => {
  it("walks up to find the assets directory", () => {
    const root = abs("/tmp/genosos-ext-root");
    const here = path.join(root, "dist", "cli");
    const assets = path.join(root, "assets", "chrome-extension");
    writeManifest(assets);
    setDir(here);
    expect(resolveBundledExtensionRootDir(here)).toBe(assets);
  });
  it("prefers the nearest assets directory", () => {
    const root = abs("/tmp/genosos-ext-root-nearest");
    const here = path.join(root, "dist", "cli");
    const distAssets = path.join(root, "dist", "assets", "chrome-extension");
    const rootAssets = path.join(root, "assets", "chrome-extension");
    writeManifest(distAssets);
    writeManifest(rootAssets);
    setDir(here);
    expect(resolveBundledExtensionRootDir(here)).toBe(distAssets);
  });
});
describe("browser extension install (fs-mocked)", () => {
  it("installs into the state dir (never node_modules)", async () => {
    const tmp = abs("/tmp/genosos-ext-install");
    const sourceDir = path.join(tmp, "source-ext");
    writeManifest(sourceDir);
    setFile(path.join(sourceDir, "test.txt"), "ok");
    const result = await installChromeExtension({ stateDir: tmp, sourceDir });
    expect(result.path).toBe(path.join(tmp, "browser", "chrome-extension"));
    expect(state.entries.has(abs(path.join(result.path, "manifest.json")))).toBe(true);
    expect(state.entries.has(abs(path.join(result.path, "test.txt")))).toBe(true);
    expect(result.path.includes("node_modules")).toBe(false);
  });
  it("copies extension path to clipboard", async () => {
    const prev = process.env.GENOS_STATE_DIR;
    const tmp = abs("/tmp/genosos-ext-path");
    process.env.GENOS_STATE_DIR = tmp;
    try {
      copyToClipboard.mockResolvedValue(true);
      const dir = path.join(tmp, "browser", "chrome-extension");
      writeManifest(dir);
      const { Command } = await import("commander");
      const program = new Command();
      const browser = program.command("browser").option("--json", "JSON output", false);
      registerBrowserExtensionCommands(browser, (cmd) => cmd.parent?.opts?.());
      await program.parseAsync(["browser", "extension", "path"], { from: "user" });
      expect(copyToClipboard).toHaveBeenCalledWith(dir);
    } finally {
      if (prev === undefined) {
        delete process.env.GENOS_STATE_DIR;
      } else {
        process.env.GENOS_STATE_DIR = prev;
      }
    }
  });
});
