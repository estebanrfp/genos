import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";
describe("oauth paths", () => {
  it("prefers GENOS_OAUTH_DIR over GENOS_STATE_DIR", () => {
    const env = {
      GENOS_OAUTH_DIR: "/custom/oauth",
      GENOS_STATE_DIR: "/custom/state",
    };
    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });
  it("derives oauth path from GENOS_STATE_DIR when unset", () => {
    const env = {
      GENOS_STATE_DIR: "/custom/state",
    };
    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});
describe("state + config path candidates", () => {
  function expectGenosOSHomeDefaults(env) {
    const configuredHome = env.GENOS_HOME;
    if (!configuredHome) {
      throw new Error("GENOS_HOME must be set for this assertion helper");
    }
    const resolvedHome = path.resolve(configuredHome);
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".genosv1"));
    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".genosv1", "genosos.json"));
  }
  it("uses GENOS_STATE_DIR when set", () => {
    const env = {
      GENOS_STATE_DIR: "/new/state",
    };
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });
  it("uses GENOS_HOME for default state/config locations", () => {
    const env = {
      GENOS_HOME: "/srv/genosos-home",
    };
    expectGenosOSHomeDefaults(env);
  });
  it("prefers GENOS_HOME over HOME for default state/config locations", () => {
    const env = {
      GENOS_HOME: "/srv/genosos-home",
      HOME: "/home/other",
    };
    expectGenosOSHomeDefaults(env);
  });
  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({}, () => home);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".genosv1", "genosos.json"));
  });
  it("prefers ~/.genos when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-state-"));
    try {
      const newDir = path.join(root, ".genosv1");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({}, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-config-"));
    try {
      const legacyDir = path.join(root, ".genosv1");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "genosos.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");
      const resolved = resolveConfigPathCandidate({}, () => root);
      expect(resolved).toBe(legacyPath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-config-override-"));
    try {
      const legacyDir = path.join(root, ".genosv1");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "genosos.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");
      const overrideDir = path.join(root, "override");
      const env = { GENOS_STATE_DIR: overrideDir };
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "genosos.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
