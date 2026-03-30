let setRegistry = function (registry) {
  registryState.registry = registry;
  setActivePluginRegistry(registry);
};
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createRegistry } from "./server.e2e-registry-helpers.js";
import {
  connectOk,
  installGatewayTestHooks,
  rpcReq,
  startServerWithClient,
} from "./test-helpers.js";
const loadConfigHelpers = async () => await import("../config/config.js");
installGatewayTestHooks({ scope: "suite" });
const registryState = vi.hoisted(() => ({
  registry: {
    plugins: [],
    tools: [],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    diagnostics: [],
  },
}));
vi.mock("./server-plugins.js", async () => {
  const { setActivePluginRegistry } = await import("../plugins/runtime.js");
  return {
    loadGatewayPlugins: (params) => {
      setActivePluginRegistry(registryState.registry);
      return {
        pluginRegistry: registryState.registry,
        gatewayMethods: params.baseMethods ?? [],
      };
    },
  };
});
const createStubChannelPlugin = (params) => ({
  id: params.id,
  meta: {
    id: params.id,
    label: params.label,
    selectionLabel: params.label,
    docsPath: `/channels/${params.id}`,
    blurb: "test stub.",
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
    isConfigured: async () => false,
  },
  status: {
    buildChannelSummary: async () => ({
      configured: false,
      ...params.summary,
    }),
  },
  gateway: {
    logoutAccount: async () => ({
      cleared: params.logoutCleared ?? false,
      envToken: false,
    }),
  },
});
const telegramPlugin = {
  ...createStubChannelPlugin({
    id: "telegram",
    label: "Telegram",
    summary: { tokenSource: "none", lastProbeAt: null },
    logoutCleared: true,
  }),
  gateway: {
    logoutAccount: async ({ cfg }) => {
      const { writeConfigFile } = await import("../config/config.js");
      const nextTelegram = cfg.channels?.telegram ? { ...cfg.channels.telegram } : {};
      delete nextTelegram.botToken;
      await writeConfigFile({
        ...cfg,
        channels: {
          ...cfg.channels,
          telegram: nextTelegram,
        },
      });
      return { cleared: true, envToken: false, loggedOut: true };
    },
  },
};
const defaultRegistry = createRegistry([
  {
    pluginId: "whatsapp",
    source: "test",
    plugin: createStubChannelPlugin({ id: "whatsapp", label: "WhatsApp" }),
  },
  {
    pluginId: "telegram",
    source: "test",
    plugin: telegramPlugin,
  },
  {
    pluginId: "signal",
    source: "test",
    plugin: createStubChannelPlugin({
      id: "signal",
      label: "Signal",
      summary: { lastProbeAt: null },
    }),
  },
]);
let server;
let ws;
beforeAll(async () => {
  setRegistry(defaultRegistry);
  const started = await startServerWithClient();
  server = started.server;
  ws = started.ws;
  await connectOk(ws);
});
afterAll(async () => {
  ws.close();
  await server.close();
});
describe("gateway server channels", () => {
  test("channels.status returns snapshot without probe", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    setRegistry(defaultRegistry);
    const res = await rpcReq(ws, "channels.status", { probe: false, timeoutMs: 2000 });
    expect(res.ok).toBe(true);
    const telegram = res.payload?.channels?.telegram;
    const signal = res.payload?.channels?.signal;
    expect(res.payload?.channels?.whatsapp).toBeTruthy();
    expect(telegram?.configured).toBe(false);
    expect(telegram?.tokenSource).toBe("none");
    expect(telegram?.probe).toBeUndefined();
    expect(telegram?.lastProbeAt).toBeNull();
    expect(signal?.configured).toBe(false);
    expect(signal?.probe).toBeUndefined();
    expect(signal?.lastProbeAt).toBeNull();
  });
  test("channels.logout reports no session when missing", async () => {
    setRegistry(defaultRegistry);
    const res = await rpcReq(ws, "channels.logout", {
      channel: "whatsapp",
    });
    expect(res.ok).toBe(true);
    expect(res.payload?.channel).toBe("whatsapp");
    expect(res.payload?.cleared).toBe(false);
  });
  test("channels.logout clears telegram bot token from config", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    setRegistry(defaultRegistry);
    const { readConfigFileSnapshot, writeConfigFile } = await loadConfigHelpers();
    await writeConfigFile({
      channels: {
        telegram: {
          botToken: "123:abc",
          groups: { "*": { requireMention: false } },
        },
      },
    });
    const res = await rpcReq(ws, "channels.logout", { channel: "telegram" });
    expect(res.ok).toBe(true);
    expect(res.payload?.channel).toBe("telegram");
    expect(res.payload?.cleared).toBe(true);
    expect(res.payload?.envToken).toBe(false);
    const snap = await readConfigFileSnapshot();
    expect(snap.valid).toBe(true);
    expect(snap.config?.channels?.telegram?.botToken).toBeUndefined();
    expect(snap.config?.channels?.telegram?.groups?.["*"]?.requireMention).toBe(false);
  });
});
