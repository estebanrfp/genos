let setFile = function (p, content = "") {
  state.entries.set(abs(p), { kind: "file", content });
};
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
const VITEST_FS_BASE = path.join(path.parse(process.cwd()).root, "__genosos_vitest__");
const FIXTURE_BASE = path.join(VITEST_FS_BASE, "genosos-root");
const state = vi.hoisted(() => ({
  entries: new Map(),
  realpaths: new Map(),
}));
const abs = (p) => path.resolve(p);
const fx = (...parts) => path.join(FIXTURE_BASE, ...parts);
const vitestRootWithSep = `${abs(VITEST_FS_BASE)}${path.sep}`;
const isFixturePath = (p) => {
  const resolved = abs(p);
  return resolved === vitestRootWithSep.slice(0, -1) || resolved.startsWith(vitestRootWithSep);
};
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  const wrapped = {
    ...actual,
    existsSync: (p) => (isFixturePath(p) ? state.entries.has(abs(p)) : actual.existsSync(p)),
    readFileSync: (p, encoding) => {
      if (!isFixturePath(p)) {
        return actual.readFileSync(p, encoding);
      }
      const entry = state.entries.get(abs(p));
      if (!entry || entry.kind !== "file") {
        throw new Error(`ENOENT: no such file, open '${p}'`);
      }
      return encoding ? entry.content : Buffer.from(entry.content, "utf-8");
    },
    statSync: (p) => {
      if (!isFixturePath(p)) {
        return actual.statSync(p);
      }
      const entry = state.entries.get(abs(p));
      if (!entry) {
        throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
      }
      return {
        isFile: () => entry.kind === "file",
        isDirectory: () => entry.kind === "dir",
      };
    },
    realpathSync: (p) =>
      isFixturePath(p) ? (state.realpaths.get(abs(p)) ?? abs(p)) : actual.realpathSync(p),
  };
  return { ...wrapped, default: wrapped };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  const wrapped = {
    ...actual,
    readFile: async (p, encoding) => {
      if (!isFixturePath(p)) {
        return await actual.readFile(p, encoding);
      }
      const entry = state.entries.get(abs(p));
      if (!entry || entry.kind !== "file") {
        throw new Error(`ENOENT: no such file, open '${p}'`);
      }
      return entry.content;
    },
  };
  return { ...wrapped, default: wrapped };
});
describe("resolveGenosOSPackageRoot", () => {
  beforeEach(() => {
    state.entries.clear();
    state.realpaths.clear();
  });
  it("resolves package root from .bin argv1", async () => {
    const { resolveGenosOSPackageRootSync } = await import("./genosos-root.js");
    const project = fx("bin-scenario");
    const argv1 = path.join(project, "node_modules", ".bin", "genosos");
    const pkgRoot = path.join(project, "node_modules", "genosos");
    setFile(path.join(pkgRoot, "package.json"), JSON.stringify({ name: "genosos" }));
    expect(resolveGenosOSPackageRootSync({ argv1 })).toBe(pkgRoot);
  });
  it("resolves package root via symlinked argv1", async () => {
    const { resolveGenosOSPackageRootSync } = await import("./genosos-root.js");
    const project = fx("symlink-scenario");
    const bin = path.join(project, "bin", "genosos");
    const realPkg = path.join(project, "real-pkg");
    state.realpaths.set(abs(bin), abs(path.join(realPkg, "genosos.mjs")));
    setFile(path.join(realPkg, "package.json"), JSON.stringify({ name: "genosos" }));
    expect(resolveGenosOSPackageRootSync({ argv1: bin })).toBe(realPkg);
  });
  it("prefers moduleUrl candidates", async () => {
    const { resolveGenosOSPackageRootSync } = await import("./genosos-root.js");
    const pkgRoot = fx("moduleurl");
    setFile(path.join(pkgRoot, "package.json"), JSON.stringify({ name: "genosos" }));
    const moduleUrl = pathToFileURL(path.join(pkgRoot, "dist", "index.js")).toString();
    expect(resolveGenosOSPackageRootSync({ moduleUrl })).toBe(pkgRoot);
  });
  it("returns null for non-genosos package roots", async () => {
    const { resolveGenosOSPackageRootSync } = await import("./genosos-root.js");
    const pkgRoot = fx("not-genosos");
    setFile(path.join(pkgRoot, "package.json"), JSON.stringify({ name: "not-genosos" }));
    expect(resolveGenosOSPackageRootSync({ cwd: pkgRoot })).toBeNull();
  });
  it("async resolver matches sync behavior", async () => {
    const { resolveGenosOSPackageRoot } = await import("./genosos-root.js");
    const pkgRoot = fx("async");
    setFile(path.join(pkgRoot, "package.json"), JSON.stringify({ name: "genosos" }));
    await expect(resolveGenosOSPackageRoot({ cwd: pkgRoot })).resolves.toBe(pkgRoot);
  });
});
