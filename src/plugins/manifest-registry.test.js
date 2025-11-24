let makeTempDir = function () {
    const dir = path.join(os.tmpdir(), `genosos-manifest-registry-${randomUUID()}`);
    fs.mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  },
  writeManifest = function (dir, manifest) {
    fs.writeFileSync(path.join(dir, "genosos.plugin.json"), JSON.stringify(manifest), "utf-8");
  },
  createPluginCandidate = function (params) {
    return {
      idHint: params.idHint,
      source: path.join(params.rootDir, params.sourceName ?? "index.js"),
      rootDir: params.rootDir,
      origin: params.origin,
    };
  },
  loadRegistry = function (candidates) {
    return loadPluginManifestRegistry({
      candidates,
      cache: false,
    });
  },
  countDuplicateWarnings = function (registry) {
    return registry.diagnostics.filter(
      (diagnostic) =>
        diagnostic.level === "warn" && diagnostic.message?.includes("duplicate plugin id"),
    ).length;
  };
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
const tempDirs = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      break;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});
describe("loadPluginManifestRegistry", () => {
  it("emits duplicate warning for truly distinct plugins with same id", () => {
    const dirA = makeTempDir();
    const dirB = makeTempDir();
    const manifest = { id: "test-plugin", configSchema: { type: "object" } };
    writeManifest(dirA, manifest);
    writeManifest(dirB, manifest);
    const candidates = [
      createPluginCandidate({
        idHint: "test-plugin",
        rootDir: dirA,
        origin: "bundled",
      }),
      createPluginCandidate({
        idHint: "test-plugin",
        rootDir: dirB,
        origin: "global",
      }),
    ];
    expect(countDuplicateWarnings(loadRegistry(candidates))).toBe(1);
  });
  it("suppresses duplicate warning when candidates share the same physical directory via symlink", () => {
    const realDir = makeTempDir();
    const manifest = { id: "feishu", configSchema: { type: "object" } };
    writeManifest(realDir, manifest);
    const symlinkParent = makeTempDir();
    const symlinkPath = path.join(symlinkParent, "feishu-link");
    try {
      fs.symlinkSync(realDir, symlinkPath, "junction");
    } catch {
      return;
    }
    const candidates = [
      createPluginCandidate({
        idHint: "feishu",
        rootDir: realDir,
        origin: "bundled",
      }),
      createPluginCandidate({
        idHint: "feishu",
        rootDir: symlinkPath,
        origin: "bundled",
      }),
    ];
    expect(countDuplicateWarnings(loadRegistry(candidates))).toBe(0);
  });
  it("suppresses duplicate warning when candidates have identical rootDir paths", () => {
    const dir = makeTempDir();
    const manifest = { id: "same-path-plugin", configSchema: { type: "object" } };
    writeManifest(dir, manifest);
    const candidates = [
      createPluginCandidate({
        idHint: "same-path-plugin",
        rootDir: dir,
        sourceName: "a.ts",
        origin: "bundled",
      }),
      createPluginCandidate({
        idHint: "same-path-plugin",
        rootDir: dir,
        sourceName: "b.ts",
        origin: "global",
      }),
    ];
    expect(countDuplicateWarnings(loadRegistry(candidates))).toBe(0);
  });
  it("prefers higher-precedence origins for the same physical directory (config > workspace > global > bundled)", () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
    const manifest = { id: "precedence-plugin", configSchema: { type: "object" } };
    writeManifest(dir, manifest);
    const altDir = path.join(dir, "sub", "..");
    const candidates = [
      createPluginCandidate({
        idHint: "precedence-plugin",
        rootDir: dir,
        origin: "bundled",
      }),
      createPluginCandidate({
        idHint: "precedence-plugin",
        rootDir: altDir,
        origin: "config",
      }),
    ];
    const registry = loadRegistry(candidates);
    expect(countDuplicateWarnings(registry)).toBe(0);
    expect(registry.plugins.length).toBe(1);
    expect(registry.plugins[0]?.origin).toBe("config");
  });
});
