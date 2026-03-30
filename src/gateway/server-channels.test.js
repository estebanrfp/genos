let createTestPlugin = function (params) {
    const account = params?.account ?? { enabled: true, configured: true };
    const includeDescribeAccount = params?.includeDescribeAccount !== false;
    const config = {
      listAccountIds: () => [DEFAULT_ACCOUNT_ID],
      resolveAccount: () => account,
      isEnabled: (resolved) => resolved.enabled !== false,
    };
    if (includeDescribeAccount) {
      config.describeAccount = (resolved) => ({
        accountId: DEFAULT_ACCOUNT_ID,
        enabled: resolved.enabled !== false,
        configured: resolved.configured !== false,
      });
    }
    const gateway = {};
    if (params?.startAccount) {
      gateway.startAccount = params.startAccount;
    }
    return {
      id: "discord",
      meta: {
        id: "discord",
        label: "Discord",
        selectionLabel: "Discord",
        docsPath: "/channels/discord",
        blurb: "test stub",
      },
      capabilities: { chatTypes: ["direct"] },
      config,
      gateway,
    };
  },
  installTestRegistry = function (plugin) {
    const registry = createEmptyPluginRegistry();
    registry.channels.push({
      pluginId: plugin.id,
      source: "test",
      plugin,
    });
    setActivePluginRegistry(registry);
  },
  createManager = function () {
    const log = createSubsystemLogger("gateway/server-channels-test");
    const channelLogs = { discord: log };
    const runtime = runtimeForLogger(log);
    const channelRuntimeEnvs = { discord: runtime };
    return createChannelManager({
      loadConfig: () => ({}),
      channelLogs,
      channelRuntimeEnvs,
    });
  };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubsystemLogger, runtimeForLogger } from "../logging/subsystem.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { getActivePluginRegistry, setActivePluginRegistry } from "../plugins/runtime.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";
import { createChannelManager } from "./server-channels.js";
const hoisted = vi.hoisted(() => {
  const computeBackoff = vi.fn(() => 10);
  const sleepWithAbort = vi.fn((ms, abortSignal) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), ms);
      abortSignal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  });
  return { computeBackoff, sleepWithAbort };
});
vi.mock("../infra/backoff.js", () => ({
  computeBackoff: hoisted.computeBackoff,
  sleepWithAbort: hoisted.sleepWithAbort,
}));
describe("server-channels auto restart", () => {
  let previousRegistry = null;
  beforeEach(() => {
    previousRegistry = getActivePluginRegistry();
    vi.useFakeTimers();
    hoisted.computeBackoff.mockClear();
    hoisted.sleepWithAbort.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    setActivePluginRegistry(previousRegistry ?? createEmptyPluginRegistry());
  });
  it("caps crash-loop restarts after max attempts", async () => {
    const startAccount = vi.fn(async () => {});
    installTestRegistry(
      createTestPlugin({
        startAccount,
      }),
    );
    const manager = createManager();
    await manager.startChannels();
    await vi.advanceTimersByTimeAsync(200);
    expect(startAccount).toHaveBeenCalledTimes(11);
    const snapshot = manager.getRuntimeSnapshot();
    const account = snapshot.channelAccounts.discord?.[DEFAULT_ACCOUNT_ID];
    expect(account?.running).toBe(false);
    expect(account?.reconnectAttempts).toBe(10);
    await vi.advanceTimersByTimeAsync(200);
    expect(startAccount).toHaveBeenCalledTimes(11);
  });
  it("does not auto-restart after manual stop during backoff", async () => {
    const startAccount = vi.fn(async () => {});
    installTestRegistry(
      createTestPlugin({
        startAccount,
      }),
    );
    const manager = createManager();
    await manager.startChannels();
    vi.runAllTicks();
    await manager.stopChannel("discord", DEFAULT_ACCOUNT_ID);
    await vi.advanceTimersByTimeAsync(200);
    expect(startAccount).toHaveBeenCalledTimes(1);
  });
  it("marks enabled/configured when account descriptors omit them", () => {
    installTestRegistry(
      createTestPlugin({
        includeDescribeAccount: false,
      }),
    );
    const manager = createManager();
    const snapshot = manager.getRuntimeSnapshot();
    const account = snapshot.channelAccounts.discord?.[DEFAULT_ACCOUNT_ID];
    expect(account?.enabled).toBe(true);
    expect(account?.configured).toBe(true);
  });
});
