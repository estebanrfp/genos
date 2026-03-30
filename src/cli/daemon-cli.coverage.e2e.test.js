import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";
const callGateway = vi.fn(async (..._args) => ({ ok: true }));
const resolveGatewayProgramArguments = vi.fn(async (_opts) => ({
  programArguments: ["/bin/node", "cli", "gateway", "--port", "18789"],
}));
const serviceInstall = vi.fn().mockResolvedValue(undefined);
const serviceUninstall = vi.fn().mockResolvedValue(undefined);
const serviceStop = vi.fn().mockResolvedValue(undefined);
const serviceRestart = vi.fn().mockResolvedValue(undefined);
const serviceIsLoaded = vi.fn().mockResolvedValue(false);
const serviceReadCommand = vi.fn().mockResolvedValue(null);
const serviceReadRuntime = vi.fn().mockResolvedValue({ status: "running" });
const findExtraGatewayServices = vi.fn(async (_env, _opts) => []);
const inspectPortUsage = vi.fn(async (port) => ({
  port,
  status: "free",
  listeners: [],
  hints: [],
}));
const { runtimeLogs, defaultRuntime, resetRuntimeCapture } = createCliRuntimeCapture();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts) => callGateway(opts),
}));
vi.mock("../daemon/program-args.js", () => ({
  resolveGatewayProgramArguments: (opts) => resolveGatewayProgramArguments(opts),
}));
vi.mock("../daemon/service.js", () => ({
  resolveGatewayService: () => ({
    label: "LaunchAgent",
    loadedText: "loaded",
    notLoadedText: "not loaded",
    install: serviceInstall,
    uninstall: serviceUninstall,
    stop: serviceStop,
    restart: serviceRestart,
    isLoaded: serviceIsLoaded,
    readCommand: serviceReadCommand,
    readRuntime: serviceReadRuntime,
  }),
}));
vi.mock("../daemon/legacy.js", () => ({
  findLegacyGatewayServices: async () => [],
}));
vi.mock("../daemon/inspect.js", () => ({
  findExtraGatewayServices: (env, opts) => findExtraGatewayServices(env, opts),
  renderGatewayServiceCleanupHints: () => [],
}));
vi.mock("../infra/ports.js", () => ({
  inspectPortUsage: (port) => inspectPortUsage(port),
  formatPortDiagnostics: () => ["Port 18789 is already in use."],
}));
vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));
vi.mock("./deps.js", () => ({
  createDefaultDeps: () => {},
}));
vi.mock("./progress.js", () => ({
  withProgress: async (_opts, fn) => await fn(),
}));
describe("daemon-cli coverage", () => {
  const originalEnv = {
    GENOS_STATE_DIR: process.env.GENOS_STATE_DIR,
    GENOS_CONFIG_PATH: process.env.GENOS_CONFIG_PATH,
    GENOS_GATEWAY_PORT: process.env.GENOS_GATEWAY_PORT,
    GENOS_PROFILE: process.env.GENOS_PROFILE,
  };
  beforeEach(() => {
    process.env.GENOS_STATE_DIR = "/tmp/genosos-cli-state";
    process.env.GENOS_CONFIG_PATH = "/tmp/genosos-cli-state/genosos.json";
    delete process.env.GENOS_GATEWAY_PORT;
    delete process.env.GENOS_PROFILE;
    serviceReadCommand.mockResolvedValue(null);
  });
  afterEach(() => {
    if (originalEnv.GENOS_STATE_DIR !== undefined) {
      process.env.GENOS_STATE_DIR = originalEnv.GENOS_STATE_DIR;
    } else {
      delete process.env.GENOS_STATE_DIR;
    }
    if (originalEnv.GENOS_CONFIG_PATH !== undefined) {
      process.env.GENOS_CONFIG_PATH = originalEnv.GENOS_CONFIG_PATH;
    } else {
      delete process.env.GENOS_CONFIG_PATH;
    }
    if (originalEnv.GENOS_GATEWAY_PORT !== undefined) {
      process.env.GENOS_GATEWAY_PORT = originalEnv.GENOS_GATEWAY_PORT;
    } else {
      delete process.env.GENOS_GATEWAY_PORT;
    }
    if (originalEnv.GENOS_PROFILE !== undefined) {
      process.env.GENOS_PROFILE = originalEnv.GENOS_PROFILE;
    } else {
      delete process.env.GENOS_PROFILE;
    }
  });
  it("probes gateway status by default", async () => {
    resetRuntimeCapture();
    callGateway.mockClear();
    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);
    await program.parseAsync(["daemon", "status"], { from: "user" });
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(callGateway).toHaveBeenCalledWith(expect.objectContaining({ method: "status" }));
    expect(findExtraGatewayServices).toHaveBeenCalled();
    expect(inspectPortUsage).toHaveBeenCalled();
  }, 20000);
  it("derives probe URL from service args + env (json)", async () => {
    resetRuntimeCapture();
    callGateway.mockClear();
    inspectPortUsage.mockClear();
    serviceReadCommand.mockResolvedValueOnce({
      programArguments: ["/bin/node", "cli", "gateway", "--port", "19001"],
      environment: {
        GENOS_PROFILE: "dev",
        GENOS_STATE_DIR: "/tmp/genosos-daemon-state",
        GENOS_CONFIG_PATH: "/tmp/genosos-daemon-state/genosos.json",
        GENOS_GATEWAY_PORT: "19001",
      },
      sourcePath: "/tmp/bot.molt.gateway.plist",
    });
    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);
    await program.parseAsync(["daemon", "status", "--json"], { from: "user" });
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ws://127.0.0.1:19001",
        method: "status",
      }),
    );
    expect(inspectPortUsage).toHaveBeenCalledWith(19001);
    const jsonLine = runtimeLogs.find((line) => line.trim().startsWith("{"));
    const parsed = JSON.parse(jsonLine ?? "{}");
    expect(parsed.gateway?.port).toBe(19001);
    expect(parsed.gateway?.portSource).toBe("service args");
    expect(parsed.gateway?.probeUrl).toBe("ws://127.0.0.1:19001");
    expect(parsed.config?.mismatch).toBe(true);
    expect(parsed.rpc?.url).toBe("ws://127.0.0.1:19001");
    expect(parsed.rpc?.ok).toBe(true);
  }, 20000);
  it("passes deep scan flag for daemon status", async () => {
    findExtraGatewayServices.mockClear();
    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);
    await program.parseAsync(["daemon", "status", "--deep"], { from: "user" });
    expect(findExtraGatewayServices).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deep: true }),
    );
  });
  it("installs the daemon when requested", async () => {
    serviceIsLoaded.mockResolvedValueOnce(false);
    serviceInstall.mockClear();
    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);
    await program.parseAsync(["daemon", "install", "--port", "18789"], {
      from: "user",
    });
    expect(serviceInstall).toHaveBeenCalledTimes(1);
  });
  it("installs the daemon with json output", async () => {
    resetRuntimeCapture();
    serviceIsLoaded.mockResolvedValueOnce(false);
    serviceInstall.mockClear();
    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);
    await program.parseAsync(["daemon", "install", "--port", "18789", "--json"], {
      from: "user",
    });
    const jsonLine = runtimeLogs.find((line) => line.trim().startsWith("{"));
    const parsed = JSON.parse(jsonLine ?? "{}");
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("install");
    expect(parsed.result).toBe("installed");
  });
  it("starts and stops the daemon via service helpers", async () => {
    serviceRestart.mockClear();
    serviceStop.mockClear();
    serviceIsLoaded.mockResolvedValue(true);
    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);
    await program.parseAsync(["daemon", "start"], { from: "user" });
    await program.parseAsync(["daemon", "stop"], { from: "user" });
    expect(serviceRestart).toHaveBeenCalledTimes(1);
    expect(serviceStop).toHaveBeenCalledTimes(1);
  });
  it("emits json for daemon start/stop", async () => {
    resetRuntimeCapture();
    serviceRestart.mockClear();
    serviceStop.mockClear();
    serviceIsLoaded.mockResolvedValue(true);
    const { registerDaemonCli } = await import("./daemon-cli.js");
    const program = new Command();
    program.exitOverride();
    registerDaemonCli(program);
    await program.parseAsync(["daemon", "start", "--json"], { from: "user" });
    await program.parseAsync(["daemon", "stop", "--json"], { from: "user" });
    const jsonLines = runtimeLogs.filter((line) => line.trim().startsWith("{"));
    const parsed = jsonLines.map((line) => JSON.parse(line));
    expect(parsed.some((entry) => entry.action === "start" && entry.ok === true)).toBe(true);
    expect(parsed.some((entry) => entry.action === "stop" && entry.ok === true)).toBe(true);
  });
});
