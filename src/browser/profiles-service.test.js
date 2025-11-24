let createCtx = function (resolved) {
  const state = {
    server: null,
    port: 0,
    resolved,
    profiles: new Map(),
  };
  const ctx = {
    state: () => state,
    listProfiles: vi.fn(async () => []),
    forProfile: vi.fn(() => ({
      stopRunningBrowser: vi.fn(async () => ({ stopped: true })),
    })),
  };
  return { state, ctx };
};
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBrowserConfig } from "./config.js";
import { createBrowserProfilesService } from "./profiles-service.js";
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: vi.fn(),
    writeConfigFile: vi.fn(async () => {}),
  };
});
vi.mock("./trash.js", () => ({
  movePathToTrash: vi.fn(async (targetPath) => targetPath),
}));
vi.mock("./chrome.js", () => ({
  resolveGenosOSUserDataDir: vi.fn(() => "/tmp/genosos-test/genosos/user-data"),
}));
import { loadConfig, writeConfigFile } from "../config/config.js";
import { resolveGenosOSUserDataDir } from "./chrome.js";
import { movePathToTrash } from "./trash.js";
describe("BrowserProfilesService", () => {
  beforeEach(() => {
    vi.stubEnv("GENOS_GATEWAY_PORT", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("allocates next local port for new profiles", async () => {
    const resolved = resolveBrowserConfig({});
    const { ctx, state } = createCtx(resolved);
    vi.mocked(loadConfig).mockReturnValue({ browser: { profiles: {} } });
    const service = createBrowserProfilesService(ctx);
    const result = await service.createProfile({ name: "work" });
    expect(result.cdpPort).toBe(18801);
    expect(result.isRemote).toBe(false);
    expect(state.resolved.profiles.work?.cdpPort).toBe(18801);
    expect(writeConfigFile).toHaveBeenCalled();
  });
  it("accepts per-profile cdpUrl for remote Chrome", async () => {
    const resolved = resolveBrowserConfig({});
    const { ctx } = createCtx(resolved);
    vi.mocked(loadConfig).mockReturnValue({ browser: { profiles: {} } });
    const service = createBrowserProfilesService(ctx);
    const result = await service.createProfile({
      name: "remote",
      cdpUrl: "http://10.0.0.42:9222",
    });
    expect(result.cdpUrl).toBe("http://10.0.0.42:9222");
    expect(result.cdpPort).toBe(9222);
    expect(result.isRemote).toBe(true);
    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: expect.objectContaining({
          profiles: expect.objectContaining({
            remote: expect.objectContaining({
              cdpUrl: "http://10.0.0.42:9222",
            }),
          }),
        }),
      }),
    );
  });
  it("deletes remote profiles without stopping or removing local data", async () => {
    const resolved = resolveBrowserConfig({
      profiles: {
        remote: { cdpUrl: "http://10.0.0.42:9222", color: "#0066CC" },
      },
    });
    const { ctx } = createCtx(resolved);
    vi.mocked(loadConfig).mockReturnValue({
      browser: {
        defaultProfile: "genosos",
        profiles: {
          genosos: { cdpPort: 18800, color: "#FF4500" },
          remote: { cdpUrl: "http://10.0.0.42:9222", color: "#0066CC" },
        },
      },
    });
    const service = createBrowserProfilesService(ctx);
    const result = await service.deleteProfile("remote");
    expect(result.deleted).toBe(false);
    expect(ctx.forProfile).not.toHaveBeenCalled();
    expect(movePathToTrash).not.toHaveBeenCalled();
  });
  it("deletes local profiles and moves data to Trash", async () => {
    const resolved = resolveBrowserConfig({
      profiles: {
        work: { cdpPort: 18801, color: "#0066CC" },
      },
    });
    const { ctx } = createCtx(resolved);
    vi.mocked(loadConfig).mockReturnValue({
      browser: {
        defaultProfile: "genosos",
        profiles: {
          genosos: { cdpPort: 18800, color: "#FF4500" },
          work: { cdpPort: 18801, color: "#0066CC" },
        },
      },
    });
    const tempDir = fs.mkdtempSync(path.join("/tmp", "genosos-profile-"));
    const userDataDir = path.join(tempDir, "work", "user-data");
    fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
    vi.mocked(resolveGenosOSUserDataDir).mockReturnValue(userDataDir);
    const service = createBrowserProfilesService(ctx);
    const result = await service.deleteProfile("work");
    expect(result.deleted).toBe(true);
    expect(movePathToTrash).toHaveBeenCalledWith(path.dirname(userDataDir));
  });
});
