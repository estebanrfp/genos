import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  dirs: new Set(),
  executables: new Set(),
}));
const abs = (p) => path.resolve(p);
const setDir = (p) => state.dirs.add(abs(p));
const setExe = (p) => state.executables.add(abs(p));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  const pathMod = await import("node:path");
  const absInMock = (p) => pathMod.resolve(p);
  const wrapped = {
    ...actual,
    constants: { ...actual.constants, X_OK: actual.constants.X_OK ?? 1 },
    accessSync: (p, mode) => {
      if (!state.executables.has(absInMock(p))) {
        throw new Error(`EACCES: permission denied, access '${p}' (mode=${mode ?? 0})`);
      }
    },
    statSync: (p) => ({
      isDirectory: () => state.dirs.has(absInMock(p)),
    }),
  };
  return { ...wrapped, default: wrapped };
});
let ensureGenosOSCliOnPath;
describe("ensureGenosOSCliOnPath", () => {
  const envKeys = [
    "PATH",
    "GENOS_PATH_BOOTSTRAPPED",
    "GENOS_ALLOW_PROJECT_LOCAL_BIN",
    "MISE_DATA_DIR",
    "HOMEBREW_PREFIX",
    "HOMEBREW_BREW_FILE",
    "XDG_BIN_HOME",
  ];
  let envSnapshot;
  beforeAll(async () => {
    ({ ensureGenosOSCliOnPath } = await import("./path-env.js"));
  });
  beforeEach(() => {
    envSnapshot = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    state.dirs.clear();
    state.executables.clear();
    setDir("/usr/bin");
    setDir("/bin");
    vi.clearAllMocks();
  });
  afterEach(() => {
    for (const k of envKeys) {
      const value = envSnapshot[k];
      if (value === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = value;
      }
    }
  });
  it("prepends the bundled app bin dir when a sibling genosos exists", () => {
    const tmp = abs("/tmp/genosos-path/case-bundled");
    const appBinDir = path.join(tmp, "AppBin");
    const cliPath = path.join(appBinDir, "genosos");
    setDir(tmp);
    setDir(appBinDir);
    setExe(cliPath);
    process.env.PATH = "/usr/bin";
    delete process.env.GENOS_PATH_BOOTSTRAPPED;
    ensureGenosOSCliOnPath({
      execPath: cliPath,
      cwd: tmp,
      homeDir: tmp,
      platform: "darwin",
    });
    const updated = process.env.PATH ?? "";
    expect(updated.split(path.delimiter)[0]).toBe(appBinDir);
  });
  it("is idempotent", () => {
    process.env.PATH = "/bin";
    process.env.GENOS_PATH_BOOTSTRAPPED = "1";
    ensureGenosOSCliOnPath({
      execPath: "/tmp/does-not-matter",
      cwd: "/tmp",
      homeDir: "/tmp",
      platform: "darwin",
    });
    expect(process.env.PATH).toBe("/bin");
  });
  it("prepends mise shims when available", () => {
    const tmp = abs("/tmp/genosos-path/case-mise");
    const appBinDir = path.join(tmp, "AppBin");
    const appCli = path.join(appBinDir, "genosos");
    setDir(tmp);
    setDir(appBinDir);
    setExe(appCli);
    const miseDataDir = path.join(tmp, "mise");
    const shimsDir = path.join(miseDataDir, "shims");
    setDir(miseDataDir);
    setDir(shimsDir);
    process.env.MISE_DATA_DIR = miseDataDir;
    process.env.PATH = "/usr/bin";
    delete process.env.GENOS_PATH_BOOTSTRAPPED;
    ensureGenosOSCliOnPath({
      execPath: appCli,
      cwd: tmp,
      homeDir: tmp,
      platform: "darwin",
    });
    const updated = process.env.PATH ?? "";
    const parts = updated.split(path.delimiter);
    const appBinIndex = parts.indexOf(appBinDir);
    const shimsIndex = parts.indexOf(shimsDir);
    expect(appBinIndex).toBeGreaterThanOrEqual(0);
    expect(shimsIndex).toBeGreaterThan(appBinIndex);
  });
  it("only appends project-local node_modules/.bin when explicitly enabled", () => {
    const tmp = abs("/tmp/genosos-path/case-project-local");
    const appBinDir = path.join(tmp, "AppBin");
    const appCli = path.join(appBinDir, "genosos");
    setDir(tmp);
    setDir(appBinDir);
    setExe(appCli);
    const localBinDir = path.join(tmp, "node_modules", ".bin");
    const localCli = path.join(localBinDir, "genosos");
    setDir(path.join(tmp, "node_modules"));
    setDir(localBinDir);
    setExe(localCli);
    process.env.PATH = "/usr/bin";
    delete process.env.GENOS_PATH_BOOTSTRAPPED;
    ensureGenosOSCliOnPath({
      execPath: appCli,
      cwd: tmp,
      homeDir: tmp,
      platform: "darwin",
    });
    const withoutOptIn = (process.env.PATH ?? "").split(path.delimiter);
    expect(withoutOptIn.includes(localBinDir)).toBe(false);
    process.env.PATH = "/usr/bin";
    delete process.env.GENOS_PATH_BOOTSTRAPPED;
    ensureGenosOSCliOnPath({
      execPath: appCli,
      cwd: tmp,
      homeDir: tmp,
      platform: "darwin",
      allowProjectLocalBin: true,
    });
    const withOptIn = (process.env.PATH ?? "").split(path.delimiter);
    const usrBinIndex = withOptIn.indexOf("/usr/bin");
    const localIndex = withOptIn.indexOf(localBinDir);
    expect(usrBinIndex).toBeGreaterThanOrEqual(0);
    expect(localIndex).toBeGreaterThan(usrBinIndex);
  });
  it("prepends Linuxbrew dirs when present", () => {
    const tmp = abs("/tmp/genosos-path/case-linuxbrew");
    const execDir = path.join(tmp, "exec");
    setDir(tmp);
    setDir(execDir);
    const linuxbrewDir = path.join(tmp, ".linuxbrew");
    const linuxbrewBin = path.join(linuxbrewDir, "bin");
    const linuxbrewSbin = path.join(linuxbrewDir, "sbin");
    setDir(linuxbrewDir);
    setDir(linuxbrewBin);
    setDir(linuxbrewSbin);
    process.env.PATH = "/usr/bin";
    delete process.env.GENOS_PATH_BOOTSTRAPPED;
    delete process.env.HOMEBREW_PREFIX;
    delete process.env.HOMEBREW_BREW_FILE;
    delete process.env.XDG_BIN_HOME;
    ensureGenosOSCliOnPath({
      execPath: path.join(execDir, "node"),
      cwd: tmp,
      homeDir: tmp,
      platform: "linux",
    });
    const updated = process.env.PATH ?? "";
    const parts = updated.split(path.delimiter);
    expect(parts[0]).toBe(linuxbrewBin);
    expect(parts[1]).toBe(linuxbrewSbin);
  });
});
