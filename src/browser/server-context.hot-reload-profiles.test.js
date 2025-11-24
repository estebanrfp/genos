let buildConfig = function () {
  return {
    browser: {
      enabled: true,
      color: "#FF4500",
      headless: true,
      defaultProfile: "genosos",
      profiles: { ...cfgProfiles },
    },
  };
};
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBrowserConfig } from "./config.js";
import {
  refreshResolvedBrowserConfigFromDisk,
  resolveBrowserProfileWithHotReload,
} from "./resolved-config-refresh.js";
let cfgProfiles = {};
let cachedConfig = null;
vi.mock("../config/config.js", () => ({
  createConfigIO: () => ({
    loadConfig: () => {
      return buildConfig();
    },
  }),
  loadConfig: () => {
    if (!cachedConfig) {
      cachedConfig = buildConfig();
    }
    return cachedConfig;
  },
  writeConfigFile: vi.fn(async () => {}),
}));
describe("server-context hot-reload profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfgProfiles = {
      genosos: { cdpPort: 18800, color: "#FF4500" },
    };
    cachedConfig = null;
  });
  it("forProfile hot-reloads newly added profiles from config", async () => {
    const { loadConfig } = await import("../config/config.js");
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    expect(cfg.browser?.profiles?.desktop).toBeUndefined();
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };
    expect(
      resolveBrowserProfileWithHotReload({
        current: state,
        refreshConfigFromDisk: true,
        name: "desktop",
      }),
    ).toBeNull();
    cfgProfiles.desktop = { cdpUrl: "http://127.0.0.1:9222", color: "#0066CC" };
    const staleCfg = loadConfig();
    expect(staleCfg.browser?.profiles?.desktop).toBeUndefined();
    const profile = resolveBrowserProfileWithHotReload({
      current: state,
      refreshConfigFromDisk: true,
      name: "desktop",
    });
    expect(profile?.name).toBe("desktop");
    expect(profile?.cdpUrl).toBe("http://127.0.0.1:9222");
    expect(state.resolved.profiles.desktop).toBeDefined();
    const stillStaleCfg = loadConfig();
    expect(stillStaleCfg.browser?.profiles?.desktop).toBeUndefined();
  });
  it("forProfile still throws for profiles that don't exist in fresh config", async () => {
    const { loadConfig } = await import("../config/config.js");
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };
    expect(
      resolveBrowserProfileWithHotReload({
        current: state,
        refreshConfigFromDisk: true,
        name: "nonexistent",
      }),
    ).toBeNull();
  });
  it("forProfile refreshes existing profile config after loadConfig cache updates", async () => {
    const { loadConfig } = await import("../config/config.js");
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };
    cfgProfiles.genos = { cdpPort: 19999, color: "#FF4500" };
    cachedConfig = null;
    const after = resolveBrowserProfileWithHotReload({
      current: state,
      refreshConfigFromDisk: true,
      name: "genosos",
    });
    expect(after?.cdpPort).toBe(19999);
    expect(state.resolved.profiles.genos?.cdpPort).toBe(19999);
  });
  it("listProfiles refreshes config before enumerating profiles", async () => {
    const { loadConfig } = await import("../config/config.js");
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const state = {
      server: null,
      port: 18791,
      resolved,
      profiles: new Map(),
    };
    cfgProfiles.desktop = { cdpPort: 19999, color: "#0066CC" };
    cachedConfig = null;
    refreshResolvedBrowserConfigFromDisk({
      current: state,
      refreshConfigFromDisk: true,
      mode: "cached",
    });
    expect(Object.keys(state.resolved.profiles)).toContain("desktop");
  });
});
