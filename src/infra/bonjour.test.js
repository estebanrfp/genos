let enableAdvertiserUnitMode = function (hostname = "test-host") {
    delete process.env.VITEST;
    process.env.NODE_ENV = "development";
    vi.spyOn(os, "hostname").mockReturnValue(hostname);
    process.env.GENOS_MDNS_HOSTNAME = hostname;
  },
  mockCiaoService = function (params) {
    const advertise = params?.advertise ?? vi.fn().mockResolvedValue(undefined);
    const destroy = params?.destroy ?? vi.fn().mockResolvedValue(undefined);
    const on = params?.on ?? vi.fn();
    createService.mockImplementation((options) => {
      return {
        advertise,
        destroy,
        serviceState: params?.serviceState ?? "announced",
        on,
        getFQDN: () => `${asString(options.type, "service")}.${asString(options.domain, "local")}.`,
        getHostname: () => asString(options.hostname, "unknown"),
        getPort: () => Number(options.port ?? -1),
      };
    });
    return { advertise, destroy, on };
  };
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as logging from "../logging.js";
const mocks = vi.hoisted(() => ({
  createService: vi.fn(),
  shutdown: vi.fn(),
  registerUnhandledRejectionHandler: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));
const { createService, shutdown, registerUnhandledRejectionHandler, logWarn, logDebug } = mocks;
const getLoggerInfo = vi.fn();
const asString = (value, fallback) =>
  typeof value === "string" && value.trim() ? value : fallback;
vi.mock("../logger.js", async () => {
  const actual = await vi.importActual("../logger.js");
  return {
    ...actual,
    logWarn: (message) => logWarn(message),
    logDebug: (message) => logDebug(message),
    logInfo: vi.fn(),
    logError: vi.fn(),
    logSuccess: vi.fn(),
  };
});
vi.mock("@homebridge/ciao", () => {
  return {
    Protocol: { TCP: "tcp" },
    getResponder: () => ({
      createService,
      shutdown,
    }),
  };
});
vi.mock("./unhandled-rejections.js", () => {
  return {
    registerUnhandledRejectionHandler: (handler) => registerUnhandledRejectionHandler(handler),
  };
});
const { startGatewayBonjourAdvertiser } = await import("./bonjour.js");
describe("gateway bonjour advertiser", () => {
  const prevEnv = { ...process.env };
  beforeEach(() => {
    vi.spyOn(logging, "getLogger").mockReturnValue({
      info: (...args) => getLoggerInfo(...args),
    });
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in prevEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(prevEnv)) {
      process.env[key] = value;
    }
    createService.mockReset();
    shutdown.mockReset();
    registerUnhandledRejectionHandler.mockReset();
    logWarn.mockReset();
    logDebug.mockReset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("does not block on advertise and publishes expected txt keys", async () => {
    enableAdvertiserUnitMode();
    const destroy = vi.fn().mockResolvedValue(undefined);
    let resolveAdvertise = () => {};
    const advertise = vi.fn().mockImplementation(
      async () =>
        await new Promise((resolve) => {
          resolveAdvertise = resolve;
        }),
    );
    mockCiaoService({ advertise, destroy });
    const started = await startGatewayBonjourAdvertiser({
      gatewayPort: 18789,
      sshPort: 2222,
      tailnetDns: "host.tailnet.ts.net",
      cliPath: "/opt/homebrew/bin/genosos",
    });
    expect(createService).toHaveBeenCalledTimes(1);
    const [gatewayCall] = createService.mock.calls;
    expect(gatewayCall?.[0]?.type).toBe("genosos-gw");
    const gatewayType = asString(gatewayCall?.[0]?.type, "");
    expect(gatewayType.length).toBeLessThanOrEqual(15);
    expect(gatewayCall?.[0]?.port).toBe(18789);
    expect(gatewayCall?.[0]?.domain).toBe("local");
    expect(gatewayCall?.[0]?.hostname).toBe("test-host");
    expect(gatewayCall?.[0]?.txt?.lanHost).toBe("test-host.local");
    expect(gatewayCall?.[0]?.txt?.gatewayPort).toBe("18789");
    expect(gatewayCall?.[0]?.txt?.sshPort).toBe("2222");
    expect(gatewayCall?.[0]?.txt?.cliPath).toBe("/opt/homebrew/bin/genosos");
    expect(gatewayCall?.[0]?.txt?.transport).toBe("gateway");
    expect(advertise).toHaveBeenCalledTimes(1);
    resolveAdvertise();
    await Promise.resolve();
    await started.stop();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
  it("omits cliPath and sshPort in minimal mode", async () => {
    enableAdvertiserUnitMode();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const advertise = vi.fn().mockResolvedValue(undefined);
    mockCiaoService({ advertise, destroy });
    const started = await startGatewayBonjourAdvertiser({
      gatewayPort: 18789,
      sshPort: 2222,
      cliPath: "/opt/homebrew/bin/genosos",
      minimal: true,
    });
    const [gatewayCall] = createService.mock.calls;
    expect(gatewayCall?.[0]?.txt?.sshPort).toBeUndefined();
    expect(gatewayCall?.[0]?.txt?.cliPath).toBeUndefined();
    await started.stop();
  });
  it("attaches conflict listeners for services", async () => {
    enableAdvertiserUnitMode();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const advertise = vi.fn().mockResolvedValue(undefined);
    const onCalls = [];
    const on = vi.fn((event) => {
      onCalls.push({ event });
    });
    mockCiaoService({ advertise, destroy, on });
    const started = await startGatewayBonjourAdvertiser({
      gatewayPort: 18789,
      sshPort: 2222,
    });
    expect(onCalls.map((c) => c.event)).toEqual(["name-change", "hostname-change"]);
    await started.stop();
  });
  it("cleans up unhandled rejection handler after shutdown", async () => {
    enableAdvertiserUnitMode();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const advertise = vi.fn().mockResolvedValue(undefined);
    const order = [];
    shutdown.mockImplementation(async () => {
      order.push("shutdown");
    });
    mockCiaoService({ advertise, destroy });
    const cleanup = vi.fn(() => {
      order.push("cleanup");
    });
    registerUnhandledRejectionHandler.mockImplementation(() => cleanup);
    const started = await startGatewayBonjourAdvertiser({
      gatewayPort: 18789,
      sshPort: 2222,
    });
    await started.stop();
    expect(registerUnhandledRejectionHandler).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["shutdown", "cleanup"]);
  });
  it("logs advertise failures and retries via watchdog", async () => {
    enableAdvertiserUnitMode();
    vi.useFakeTimers();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const advertise = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    mockCiaoService({ advertise, destroy, serviceState: "unannounced" });
    const started = await startGatewayBonjourAdvertiser({
      gatewayPort: 18789,
      sshPort: 2222,
    });
    expect(advertise).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("advertise failed"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(advertise).toHaveBeenCalledTimes(2);
    await started.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(advertise).toHaveBeenCalledTimes(2);
  });
  it("handles advertise throwing synchronously", async () => {
    enableAdvertiserUnitMode();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const advertise = vi.fn(() => {
      throw new Error("sync-fail");
    });
    mockCiaoService({ advertise, destroy, serviceState: "unannounced" });
    const started = await startGatewayBonjourAdvertiser({
      gatewayPort: 18789,
      sshPort: 2222,
    });
    expect(advertise).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("advertise threw"));
    await started.stop();
  });
  it("normalizes hostnames with domains for service names", async () => {
    delete process.env.VITEST;
    process.env.NODE_ENV = "development";
    vi.spyOn(os, "hostname").mockReturnValue("Mac.localdomain");
    const destroy = vi.fn().mockResolvedValue(undefined);
    const advertise = vi.fn().mockResolvedValue(undefined);
    mockCiaoService({ advertise, destroy });
    const started = await startGatewayBonjourAdvertiser({
      gatewayPort: 18789,
      sshPort: 2222,
    });
    const [gatewayCall] = createService.mock.calls;
    expect(gatewayCall?.[0]?.name).toBe("genosos (GenosOS)");
    expect(gatewayCall?.[0]?.domain).toBe("local");
    expect(gatewayCall?.[0]?.hostname).toBe("genosos");
    expect(gatewayCall?.[0]?.txt?.lanHost).toBe("genosos.local");
    await started.stop();
  });
});
