import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./genosos-root.js", () => ({
  resolveGenosOSPackageRoot: vi.fn(),
}));
vi.mock("./update-check.js", async () => {
  const parse = (value) => value.split(".").map((part) => Number.parseInt(part, 10));
  const compareSemverStrings = (a, b) => {
    const left = parse(a);
    const right = parse(b);
    for (let idx = 0; idx < 3; idx += 1) {
      const l = left[idx] ?? 0;
      const r = right[idx] ?? 0;
      if (l !== r) {
        return l < r ? -1 : 1;
      }
    }
    return 0;
  };
  return {
    checkUpdateStatus: vi.fn(),
    compareSemverStrings,
    resolveNpmChannelTag: vi.fn(),
  };
});
vi.mock("../version.js", () => ({
  VERSION: "1.0.0",
}));
describe("update-startup", () => {
  let suiteRoot = "";
  let suiteCase = 0;
  let tempDir;
  let prevStateDir;
  let prevNodeEnv;
  let prevVitest;
  let hadStateDir = false;
  let hadNodeEnv = false;
  let hadVitest = false;
  let resolveGenosOSPackageRoot;
  let checkUpdateStatus;
  let resolveNpmChannelTag;
  let runGatewayUpdateCheck;
  let loaded = false;
  beforeAll(async () => {
    suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-update-check-suite-"));
  });
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-17T10:00:00Z"));
    tempDir = path.join(suiteRoot, `case-${++suiteCase}`);
    await fs.mkdir(tempDir);
    hadStateDir = Object.prototype.hasOwnProperty.call(process.env, "GENOS_STATE_DIR");
    prevStateDir = process.env.GENOS_STATE_DIR;
    process.env.GENOS_STATE_DIR = tempDir;
    hadNodeEnv = Object.prototype.hasOwnProperty.call(process.env, "NODE_ENV");
    prevNodeEnv = "development";
    process.env.NODE_ENV = "test";
    hadVitest = Object.prototype.hasOwnProperty.call(process.env, "VITEST");
    prevVitest = process.env.VITEST;
    delete process.env.VITEST;
    if (!loaded) {
      ({ resolveGenosOSPackageRoot } = await import("./genosos-root.js"));
      ({ checkUpdateStatus, resolveNpmChannelTag } = await import("./update-check.js"));
      ({ runGatewayUpdateCheck } = await import("./update-startup.js"));
      loaded = true;
    }
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (hadStateDir) {
      process.env.GENOS_STATE_DIR = prevStateDir;
    } else {
      delete process.env.GENOS_STATE_DIR;
    }
    if (hadNodeEnv) {
      process.env.NODE_ENV = prevNodeEnv;
    } else {
      delete "development";
    }
    if (hadVitest) {
      process.env.VITEST = prevVitest;
    } else {
      delete process.env.VITEST;
    }
  });
  afterAll(async () => {
    if (suiteRoot) {
      await fs.rm(suiteRoot, { recursive: true, force: true });
    }
    suiteRoot = "";
    suiteCase = 0;
  });
  async function runUpdateCheckAndReadState(channel) {
    vi.mocked(resolveGenosOSPackageRoot).mockResolvedValue("/opt/genosos");
    vi.mocked(checkUpdateStatus).mockResolvedValue({
      root: "/opt/genosos",
      installKind: "package",
      packageManager: "npm",
    });
    vi.mocked(resolveNpmChannelTag).mockResolvedValue({
      tag: "latest",
      version: "2.0.0",
    });
    const log = { info: vi.fn() };
    await runGatewayUpdateCheck({
      cfg: { update: { channel } },
      log,
      isNixMode: false,
      allowInTests: true,
    });
    const statePath = path.join(tempDir, "update-check.json");
    const parsed = JSON.parse(await fs.readFile(statePath, "utf-8"));
    return { log, parsed };
  }
  it("logs update hint for npm installs when newer tag exists", async () => {
    const { log, parsed } = await runUpdateCheckAndReadState("stable");
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("update available (latest): v2.0.0"),
    );
    expect(parsed.lastNotifiedVersion).toBe("2.0.0");
  });
  it("uses latest when beta tag is older than release", async () => {
    const { log, parsed } = await runUpdateCheckAndReadState("beta");
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("update available (latest): v2.0.0"),
    );
    expect(parsed.lastNotifiedTag).toBe("latest");
  });
  it("skips update check when disabled in config", async () => {
    const log = { info: vi.fn() };
    await runGatewayUpdateCheck({
      cfg: { update: { checkOnStart: false } },
      log,
      isNixMode: false,
      allowInTests: true,
    });
    expect(log.info).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(tempDir, "update-check.json"))).rejects.toThrow();
  });
});
