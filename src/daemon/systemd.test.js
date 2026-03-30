import { beforeEach, describe, expect, it, vi } from "vitest";
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));
import { splitArgsPreservingQuotes } from "./arg-split.js";
import { parseSystemdExecStart } from "./systemd-unit.js";
import {
  isSystemdUserServiceAvailable,
  parseSystemdShow,
  restartSystemdService,
  resolveSystemdUserUnitPath,
  stopSystemdService,
} from "./systemd.js";
describe("systemd availability", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });
  it("returns true when systemctl --user succeeds", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, "", "");
    });
    await expect(isSystemdUserServiceAvailable()).resolves.toBe(true);
  });
  it("returns false when systemd user bus is unavailable", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error("Failed to connect to bus");
      err.stderr = "Failed to connect to bus";
      err.code = 1;
      cb(err, "", "");
    });
    await expect(isSystemdUserServiceAvailable()).resolves.toBe(false);
  });
});
describe("systemd runtime parsing", () => {
  it("parses active state details", () => {
    const output = [
      "ActiveState=inactive",
      "SubState=dead",
      "MainPID=0",
      "ExecMainStatus=2",
      "ExecMainCode=exited",
    ].join("\n");
    expect(parseSystemdShow(output)).toEqual({
      activeState: "inactive",
      subState: "dead",
      execMainStatus: 2,
      execMainCode: "exited",
    });
  });
});
describe("resolveSystemdUserUnitPath", () => {
  it("uses default service name when GENOS_PROFILE is unset", () => {
    const env = { HOME: "/home/test" };
    expect(resolveSystemdUserUnitPath(env)).toBe(
      "/home/test/.config/systemd/user/genosos-gateway.service",
    );
  });
  it("uses profile-specific service name when GENOS_PROFILE is set to a custom value", () => {
    const env = { HOME: "/home/test", GENOS_PROFILE: "jbphoenix" };
    expect(resolveSystemdUserUnitPath(env)).toBe(
      "/home/test/.config/systemd/user/genosos-gateway-jbphoenix.service",
    );
  });
  it("prefers GENOS_SYSTEMD_UNIT over GENOS_PROFILE", () => {
    const env = {
      HOME: "/home/test",
      GENOS_PROFILE: "jbphoenix",
      GENOS_SYSTEMD_UNIT: "custom-unit",
    };
    expect(resolveSystemdUserUnitPath(env)).toBe(
      "/home/test/.config/systemd/user/custom-unit.service",
    );
  });
  it("handles GENOS_SYSTEMD_UNIT with .service suffix", () => {
    const env = {
      HOME: "/home/test",
      GENOS_SYSTEMD_UNIT: "custom-unit.service",
    };
    expect(resolveSystemdUserUnitPath(env)).toBe(
      "/home/test/.config/systemd/user/custom-unit.service",
    );
  });
  it("trims whitespace from GENOS_SYSTEMD_UNIT", () => {
    const env = {
      HOME: "/home/test",
      GENOS_SYSTEMD_UNIT: "  custom-unit  ",
    };
    expect(resolveSystemdUserUnitPath(env)).toBe(
      "/home/test/.config/systemd/user/custom-unit.service",
    );
  });
});
describe("splitArgsPreservingQuotes", () => {
  it("splits on whitespace outside quotes", () => {
    expect(splitArgsPreservingQuotes('/usr/bin/genosos gateway start --name "My Bot"')).toEqual([
      "/usr/bin/genosos",
      "gateway",
      "start",
      "--name",
      "My Bot",
    ]);
  });
  it("supports systemd-style backslash escaping", () => {
    expect(
      splitArgsPreservingQuotes('genosos --name "My \\"Bot\\"" --foo bar', {
        escapeMode: "backslash",
      }),
    ).toEqual(["genosos", "--name", 'My "Bot"', "--foo", "bar"]);
  });
  it("supports schtasks-style escaped quotes while preserving other backslashes", () => {
    expect(
      splitArgsPreservingQuotes('genosos --path "C:\\\\Program Files\\\\GenosOS"', {
        escapeMode: "backslash-quote-only",
      }),
    ).toEqual(["genosos", "--path", "C:\\\\Program Files\\\\GenosOS"]);
    expect(
      splitArgsPreservingQuotes('genosos --label "My \\"Quoted\\" Name"', {
        escapeMode: "backslash-quote-only",
      }),
    ).toEqual(["genosos", "--label", 'My "Quoted" Name']);
  });
});
describe("parseSystemdExecStart", () => {
  it("preserves quoted arguments", () => {
    const execStart = '/usr/bin/genosos gateway start --name "My Bot"';
    expect(parseSystemdExecStart(execStart)).toEqual([
      "/usr/bin/genosos",
      "gateway",
      "start",
      "--name",
      "My Bot",
    ]);
  });
});
describe("systemd service control", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });
  it("stops the resolved user unit", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, "", ""))
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "stop", "genosos-gateway.service"]);
        cb(null, "", "");
      });
    const write = vi.fn();
    const stdout = { write };
    await stopSystemdService({ stdout, env: {} });
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain("Stopped systemd service");
  });
  it("restarts a profile-specific user unit", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, "", ""))
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "restart", "genosos-gateway-work.service"]);
        cb(null, "", "");
      });
    const write = vi.fn();
    const stdout = { write };
    await restartSystemdService({ stdout, env: { GENOS_PROFILE: "work" } });
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain("Restarted systemd service");
  });
  it("surfaces stop failures with systemctl detail", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, "", ""))
      .mockImplementationOnce((_cmd, _args, _opts, cb) => {
        const err = new Error("stop failed");
        err.code = 1;
        cb(err, "", "permission denied");
      });
    await expect(
      stopSystemdService({
        stdout: { write: vi.fn() },
        env: {},
      }),
    ).rejects.toThrow("systemctl stop failed: permission denied");
  });
});
