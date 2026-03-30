import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
const runDoctorMock = vi.fn();
const dashboardCommand = vi.fn();
const resetCommand = vi.fn();
const uninstallCommand = vi.fn();
const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};
vi.mock("../../doctor/engine.js", () => ({
  runDoctor: (...args) => runDoctorMock(...args),
}));
vi.mock("../../commands/dashboard.js", () => ({
  dashboardCommand,
}));
vi.mock("../../commands/reset.js", () => ({
  resetCommand,
}));
vi.mock("../../commands/uninstall.js", () => ({
  uninstallCommand,
}));
vi.mock("../../runtime.js", () => ({
  defaultRuntime: runtime,
}));
describe("registerMaintenanceCommands doctor action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("exits with code 0 after successful doctor run", async () => {
    runDoctorMock.mockResolvedValue({
      ts: Date.now(),
      summary: { critical: 0, warnings: 0, info: 0, ok: 7, fixed: 0 },
      checks: [],
    });
    const { registerMaintenanceCommands } = await import("./register.maintenance.js");
    const program = new Command();
    registerMaintenanceCommands(program);
    await program.parseAsync(["doctor"], { from: "user" });
    expect(runDoctorMock).toHaveBeenCalled();
    expect(runtime.exit).toHaveBeenCalledWith(0);
  });
  it("exits with code 1 when critical findings exist", async () => {
    runDoctorMock.mockResolvedValue({
      ts: Date.now(),
      summary: { critical: 1, warnings: 0, info: 0, ok: 6, fixed: 0 },
      checks: [
        {
          name: "config",
          label: "Configuration",
          findings: [
            { id: "test", severity: "critical", title: "Test", detail: "Fail", fixed: false },
          ],
        },
      ],
    });
    const { registerMaintenanceCommands } = await import("./register.maintenance.js");
    const program = new Command();
    registerMaintenanceCommands(program);
    await program.parseAsync(["doctor"], { from: "user" });
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
