let stubTelegramFetchOk = function (calls) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      calls.push(url);
      if (url.includes("/getMe")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: { id: 1, username: "bot" },
          }),
        };
      }
      if (url.includes("/getWebhookInfo")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: {
              url: "https://example.com/h",
              has_custom_certificate: false,
            },
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ ok: false, description: "nope" }),
      };
    }),
  );
};
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramPlugin } from "../../extensions/telegram/src/channel.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import { getHealthSnapshot } from "./health.js";
let testConfig = {};
let testStore = {};
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => testConfig,
  };
});
vi.mock("../config/sessions.js", () => ({
  resolveStorePath: () => "/tmp/sessions.json",
  loadSessionStore: () => testStore,
  readSessionUpdatedAt: vi.fn(() => {
    return;
  }),
  recordSessionMetaFromInbound: vi.fn().mockResolvedValue(undefined),
  updateLastRoute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../web/auth-store.js", () => ({
  webAuthExists: vi.fn(async () => true),
  getWebAuthAgeMs: vi.fn(() => 1234),
  readWebSelfId: vi.fn(() => ({ e164: null, jid: null })),
  logWebSelfId: vi.fn(),
  logoutWeb: vi.fn(),
}));
async function runSuccessfulTelegramProbe(config, options) {
  testConfig = config;
  testStore = {};
  vi.stubEnv("DISCORD_BOT_TOKEN", "");
  if (options?.clearTokenEnv) {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  }
  const calls = [];
  stubTelegramFetchOk(calls);
  const snap = await getHealthSnapshot({ timeoutMs: 25 });
  const telegram = snap.channels.telegram;
  return { calls, telegram };
}
describe("getHealthSnapshot", () => {
  beforeEach(async () => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "telegram", plugin: telegramPlugin, source: "test" }]),
    );
    const { createPluginRuntime } = await import("../plugins/runtime/index.js");
    const { setTelegramRuntime } = await import("../../extensions/telegram/src/runtime.js");
    setTelegramRuntime(createPluginRuntime());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("skips telegram probe when not configured", async () => {
    testConfig = { session: { store: "/tmp/x" } };
    testStore = {
      global: { updatedAt: Date.now() },
      unknown: { updatedAt: Date.now() },
      main: { updatedAt: 1000 },
      foo: { updatedAt: 2000 },
    };
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    const snap = await getHealthSnapshot({
      timeoutMs: 10,
    });
    expect(snap.ok).toBe(true);
    const telegram = snap.channels.telegram;
    expect(telegram.configured).toBe(false);
    expect(telegram.probe).toBeUndefined();
    expect(snap.sessions.count).toBe(2);
    expect(snap.sessions.recent[0]?.key).toBe("foo");
  });
  it("probes telegram getMe + webhook info when configured", async () => {
    const { calls, telegram } = await runSuccessfulTelegramProbe({
      channels: { telegram: { botToken: "t-1" } },
    });
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(true);
    expect(telegram.probe?.bot?.username).toBe("bot");
    expect(telegram.probe?.webhook?.url).toMatch(/^https:/);
    expect(calls.some((c) => c.includes("/getMe"))).toBe(true);
    expect(calls.some((c) => c.includes("/getWebhookInfo"))).toBe(true);
  });
  it("treats telegram.tokenFile as configured", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-health-"));
    const tokenFile = path.join(tmpDir, "telegram-token");
    fs.writeFileSync(tokenFile, "t-file\n", "utf-8");
    const { calls, telegram } = await runSuccessfulTelegramProbe(
      { channels: { telegram: { tokenFile } } },
      { clearTokenEnv: true },
    );
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(true);
    expect(calls.some((c) => c.includes("bott-file/getMe"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  it("returns a structured telegram probe error when getMe fails", async () => {
    testConfig = { channels: { telegram: { botToken: "bad-token" } } };
    testStore = {};
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url.includes("/getMe")) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ ok: false, description: "unauthorized" }),
          };
        }
        throw new Error("unexpected");
      }),
    );
    const snap = await getHealthSnapshot({ timeoutMs: 25 });
    const telegram = snap.channels.telegram;
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(false);
    expect(telegram.probe?.status).toBe(401);
    expect(telegram.probe?.error).toMatch(/unauthorized/i);
  });
  it("captures unexpected probe exceptions as errors", async () => {
    testConfig = { channels: { telegram: { botToken: "t-err" } } };
    testStore = {};
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const snap = await getHealthSnapshot({ timeoutMs: 25 });
    const telegram = snap.channels.telegram;
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(false);
    expect(telegram.probe?.error).toMatch(/network down/i);
  });
  it("disables heartbeat for agents without heartbeat blocks", async () => {
    testConfig = {
      agents: {
        defaults: {
          heartbeat: {
            every: "30m",
            target: "last",
          },
        },
        list: [
          { id: "main", default: true },
          { id: "ops", heartbeat: { every: "1h", target: "whatsapp" } },
        ],
      },
    };
    testStore = {};
    const snap = await getHealthSnapshot({ timeoutMs: 10, probe: false });
    const byAgent = new Map(snap.agents.map((agent) => [agent.agentId, agent]));
    const main = byAgent.get("main");
    const ops = byAgent.get("ops");
    expect(main?.heartbeat.everyMs).toBeNull();
    expect(main?.heartbeat.every).toBe("disabled");
    expect(ops?.heartbeat.everyMs).toBeTruthy();
    expect(ops?.heartbeat.every).toBe("1h");
  });
});
