let makeSnapshot = function () {
    return {
      exists: false,
      valid: true,
      issues: [],
      legacyIssues: [],
      path: "/tmp/genosos.json",
    };
  },
  makeRuntime = function () {
    return {
      error: vi.fn(),
      exit: vi.fn(),
    };
  };
import { beforeEach, describe, expect, it, vi } from "vitest";
const loadAndMaybeMigrateDoctorConfigMock = vi.hoisted(() => vi.fn());
const readConfigFileSnapshotMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/config-guard-flow.js", () => ({
  loadAndMaybeMigrateDoctorConfig: loadAndMaybeMigrateDoctorConfigMock,
}));
vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: readConfigFileSnapshotMock,
}));
describe("ensureConfigReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readConfigFileSnapshotMock.mockResolvedValue(makeSnapshot());
    loadAndMaybeMigrateDoctorConfigMock.mockResolvedValue({ shouldWriteConfig: false });
  });
  it("skips doctor flow for read-only fast path commands", async () => {
    vi.resetModules();
    const { ensureConfigReady } = await import("./config-guard.js");
    await ensureConfigReady({ runtime: makeRuntime(), commandPath: ["status"] });
    expect(loadAndMaybeMigrateDoctorConfigMock).not.toHaveBeenCalled();
  });
  it("runs doctor flow for commands that may mutate state", async () => {
    vi.resetModules();
    const { ensureConfigReady } = await import("./config-guard.js");
    await ensureConfigReady({ runtime: makeRuntime(), commandPath: ["message"] });
    expect(loadAndMaybeMigrateDoctorConfigMock).toHaveBeenCalledTimes(1);
  });
});
