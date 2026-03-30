let setFile = function (p, content = "") {
    state.entries.set(abs(p), { kind: "file", content });
  },
  setDir = function (p) {
    state.entries.set(abs(p), { kind: "dir" });
  };
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  entries: new Map(),
  realpaths: new Map(),
}));
const abs = (p) => path.resolve(p);
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  const pathMod = await import("node:path");
  const absInMock = (p) => pathMod.resolve(p);
  const fixturesRoot = `${absInMock("fixtures")}${pathMod.sep}`;
  const isFixturePath = (p) => {
    const resolved = absInMock(p);
    return resolved === fixturesRoot.slice(0, -1) || resolved.startsWith(fixturesRoot);
  };
  const readFixtureEntry = (p) => state.entries.get(absInMock(p));
  const wrapped = {
    ...actual,
    existsSync: (p) => (isFixturePath(p) ? state.entries.has(absInMock(p)) : actual.existsSync(p)),
    readFileSync: (p, encoding) => {
      if (!isFixturePath(p)) {
        return actual.readFileSync(p, encoding);
      }
      const entry = readFixtureEntry(p);
      if (entry?.kind === "file") {
        return entry.content;
      }
      throw new Error(`ENOENT: no such file, open '${p}'`);
    },
    statSync: (p) => {
      if (!isFixturePath(p)) {
        return actual.statSync(p);
      }
      const entry = readFixtureEntry(p);
      if (entry?.kind === "file") {
        return { isFile: () => true, isDirectory: () => false };
      }
      if (entry?.kind === "dir") {
        return { isFile: () => false, isDirectory: () => true };
      }
      throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
    },
    realpathSync: (p) =>
      isFixturePath(p)
        ? (state.realpaths.get(absInMock(p)) ?? absInMock(p))
        : actual.realpathSync(p),
  };
  return { ...wrapped, default: wrapped };
});
vi.mock("./genosos-root.js", () => ({
  resolveGenosOSPackageRoot: vi.fn(async () => null),
  resolveGenosOSPackageRootSync: vi.fn(() => null),
}));
describe("control UI assets helpers (fs-mocked)", () => {
  beforeEach(() => {
    state.entries.clear();
    state.realpaths.clear();
    vi.clearAllMocks();
  });
  it("resolves repo root from src argv1", async () => {
    const { resolveControlUiRepoRoot } = await import("./control-ui-assets.js");
    const root = abs("fixtures/ui-src");
    setFile(path.join(root, "ui", "vite.config.js"), "export {};\n");
    const argv1 = path.join(root, "src", "index.js");
    expect(resolveControlUiRepoRoot(argv1)).toBe(root);
  });
  it("resolves repo root by traversing up (dist argv1)", async () => {
    const { resolveControlUiRepoRoot } = await import("./control-ui-assets.js");
    const root = abs("fixtures/ui-dist");
    setFile(path.join(root, "package.json"), "{}\n");
    setFile(path.join(root, "ui", "vite.config.js"), "export {};\n");
    const argv1 = path.join(root, "dist", "index.js");
    expect(resolveControlUiRepoRoot(argv1)).toBe(root);
  });
  it("resolves dist control-ui index path for dist argv1", async () => {
    const { resolveControlUiDistIndexPath } = await import("./control-ui-assets.js");
    const argv1 = abs(path.join("fixtures", "pkg", "dist", "index.js"));
    const distDir = path.dirname(argv1);
    await expect(resolveControlUiDistIndexPath(argv1)).resolves.toBe(
      path.join(distDir, "control-ui", "index.html"),
    );
  });
  it("uses resolveGenosOSPackageRoot when available", async () => {
    const genososRoot = await import("./genosos-root.js");
    const { resolveControlUiDistIndexPath } = await import("./control-ui-assets.js");
    const pkgRoot = abs("fixtures/genosos");
    genososRoot.resolveGenosOSPackageRoot.mockResolvedValueOnce(pkgRoot);
    await expect(resolveControlUiDistIndexPath(abs("fixtures/bin/genosos"))).resolves.toBe(
      path.join(pkgRoot, "dist", "control-ui", "index.html"),
    );
  });
  it("falls back to package.json name matching when root resolution fails", async () => {
    const { resolveControlUiDistIndexPath } = await import("./control-ui-assets.js");
    const root = abs("fixtures/fallback");
    setFile(path.join(root, "package.json"), JSON.stringify({ name: "genosos" }));
    setFile(path.join(root, "dist", "control-ui", "index.html"), "<html></html>\n");
    await expect(resolveControlUiDistIndexPath(path.join(root, "genosos.mjs"))).resolves.toBe(
      path.join(root, "dist", "control-ui", "index.html"),
    );
  });
  it("returns null when fallback package name does not match", async () => {
    const { resolveControlUiDistIndexPath } = await import("./control-ui-assets.js");
    const root = abs("fixtures/not-genosos");
    setFile(path.join(root, "package.json"), JSON.stringify({ name: "malicious-pkg" }));
    setFile(path.join(root, "dist", "control-ui", "index.html"), "<html></html>\n");
    await expect(resolveControlUiDistIndexPath(path.join(root, "index.mjs"))).resolves.toBeNull();
  });
  it("reports health for missing + existing dist assets", async () => {
    const { resolveControlUiDistIndexHealth } = await import("./control-ui-assets.js");
    const root = abs("fixtures/health");
    const indexPath = path.join(root, "dist", "control-ui", "index.html");
    await expect(resolveControlUiDistIndexHealth({ root })).resolves.toEqual({
      indexPath,
      exists: false,
    });
    setFile(indexPath, "<html></html>\n");
    await expect(resolveControlUiDistIndexHealth({ root })).resolves.toEqual({
      indexPath,
      exists: true,
    });
  });
  it("resolves control-ui root from override file or directory", async () => {
    const { resolveControlUiRootOverrideSync } = await import("./control-ui-assets.js");
    const root = abs("fixtures/override");
    const uiDir = path.join(root, "dist", "control-ui");
    const indexPath = path.join(uiDir, "index.html");
    setDir(uiDir);
    setFile(indexPath, "<html></html>\n");
    expect(resolveControlUiRootOverrideSync(uiDir)).toBe(uiDir);
    expect(resolveControlUiRootOverrideSync(indexPath)).toBe(uiDir);
    expect(resolveControlUiRootOverrideSync(path.join(uiDir, "missing.html"))).toBeNull();
  });
  it("resolves control-ui root for dist bundle argv1 and moduleUrl candidates", async () => {
    const genososRoot = await import("./genosos-root.js");
    const { resolveControlUiRootSync } = await import("./control-ui-assets.js");
    const pkgRoot = abs("fixtures/genosos-bundle");
    genososRoot.resolveGenosOSPackageRootSync.mockReturnValueOnce(pkgRoot);
    const uiDir = path.join(pkgRoot, "dist", "control-ui");
    setFile(path.join(uiDir, "index.html"), "<html></html>\n");
    expect(resolveControlUiRootSync({ argv1: path.join(pkgRoot, "dist", "bundle.js") })).toBe(
      uiDir,
    );
    const moduleUrl = pathToFileURL(path.join(pkgRoot, "dist", "bundle.js")).toString();
    expect(resolveControlUiRootSync({ moduleUrl })).toBe(uiDir);
  });
});
