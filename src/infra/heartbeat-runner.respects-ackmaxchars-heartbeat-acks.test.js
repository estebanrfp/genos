import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { resolveMainSessionKey } from "../config/sessions.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import { seedSessionStore, withTempHeartbeatSandbox } from "./heartbeat-runner.test-utils.js";
vi.mock("jiti", () => ({ createJiti: () => () => ({}) }));
installHeartbeatRunnerTestRuntime();
describe("resolveHeartbeatIntervalMs", () => {
  function createHeartbeatConfig(params) {
    return {
      agents: {
        defaults: {
          workspace: params.tmpDir,
          heartbeat: params.heartbeat,
        },
      },
      channels: params.channels,
      ...(params.messages ? { messages: params.messages } : {}),
      session: { store: params.storePath },
    };
  }
  async function seedMainSession(storePath, cfg, session) {
    const sessionKey = resolveMainSessionKey(cfg);
    await seedSessionStore(storePath, sessionKey, session);
    return sessionKey;
  }
  function makeWhatsAppDeps(params = {}) {
    return {
      ...(params.sendWhatsApp ? { sendWhatsApp: params.sendWhatsApp } : {}),
      getQueueSize: params.getQueueSize ?? (() => 0),
      nowMs: params.nowMs ?? (() => 0),
      webAuthExists: params.webAuthExists ?? (async () => true),
      hasActiveWebListener: params.hasActiveWebListener ?? (() => true),
    };
  }
  function makeTelegramDeps(params = {}) {
    return {
      ...(params.sendTelegram ? { sendTelegram: params.sendTelegram } : {}),
      getQueueSize: params.getQueueSize ?? (() => 0),
      nowMs: params.nowMs ?? (() => 0),
    };
  }
  async function withTempTelegramHeartbeatSandbox(fn) {
    return withTempHeartbeatSandbox(fn, { unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] });
  }
  function createMessageSendSpy(extra = {}) {
    return vi.fn().mockResolvedValue({
      messageId: "m1",
      toJid: "jid",
      ...extra,
    });
  }
  async function runTelegramHeartbeatWithDefaults(params) {
    const cfg = createHeartbeatConfig({
      tmpDir: params.tmpDir,
      storePath: params.storePath,
      heartbeat: { every: "5m", target: "telegram" },
      channels: {
        telegram: {
          token: "test-token",
          allowFrom: ["*"],
          heartbeat: { showOk: false },
          ...params.telegramOverrides,
        },
      },
      ...(params.messages ? { messages: params.messages } : {}),
    });
    await seedMainSession(params.storePath, cfg, {
      lastChannel: "telegram",
      lastProvider: "telegram",
      lastTo: "12345",
    });
    params.replySpy.mockResolvedValue({ text: params.replyText });
    const sendTelegram = createMessageSendSpy();
    await runHeartbeatOnce({
      cfg,
      deps: makeTelegramDeps({ sendTelegram }),
    });
    return sendTelegram;
  }
  it("respects ackMaxChars for heartbeat acks", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createHeartbeatConfig({
        tmpDir,
        storePath,
        heartbeat: {
          every: "5m",
          target: "whatsapp",
          ackMaxChars: 0,
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
      });
      await seedMainSession(storePath, cfg, {
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "+1555",
      });
      replySpy.mockResolvedValue({ text: "HEARTBEAT_OK \uD83E\uDD9E" });
      const sendWhatsApp = createMessageSendSpy();
      await runHeartbeatOnce({
        cfg,
        deps: makeWhatsAppDeps({ sendWhatsApp }),
      });
      expect(sendWhatsApp).toHaveBeenCalled();
    });
  });
  it("sends HEARTBEAT_OK when visibility.showOk is true", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createHeartbeatConfig({
        tmpDir,
        storePath,
        heartbeat: {
          every: "5m",
          target: "whatsapp",
        },
        channels: { whatsapp: { allowFrom: ["*"], heartbeat: { showOk: true } } },
      });
      await seedMainSession(storePath, cfg, {
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "+1555",
      });
      replySpy.mockResolvedValue({ text: "HEARTBEAT_OK" });
      const sendWhatsApp = createMessageSendSpy();
      await runHeartbeatOnce({
        cfg,
        deps: makeWhatsAppDeps({ sendWhatsApp }),
      });
      expect(sendWhatsApp).toHaveBeenCalledTimes(1);
      expect(sendWhatsApp).toHaveBeenCalledWith("+1555", "HEARTBEAT_OK", expect.any(Object));
    });
  });
  it("does not deliver HEARTBEAT_OK to telegram when showOk is false", async () => {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendTelegram = await runTelegramHeartbeatWithDefaults({
        tmpDir,
        storePath,
        replySpy,
        replyText: "HEARTBEAT_OK",
      });
      expect(sendTelegram).not.toHaveBeenCalled();
    });
  });
  it("strips responsePrefix before HEARTBEAT_OK detection and suppresses short ack text", async () => {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendTelegram = await runTelegramHeartbeatWithDefaults({
        tmpDir,
        storePath,
        replySpy,
        replyText: "[genosos] HEARTBEAT_OK all good",
        messages: { responsePrefix: "[genosos]" },
      });
      expect(sendTelegram).not.toHaveBeenCalled();
    });
  });
  it("does not strip alphanumeric responsePrefix from larger words", async () => {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendTelegram = await runTelegramHeartbeatWithDefaults({
        tmpDir,
        storePath,
        replySpy,
        replyText: "History check complete",
        messages: { responsePrefix: "Hi" },
      });
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledWith(
        "12345",
        "History check complete",
        expect.any(Object),
      );
    });
  });
  it("skips heartbeat LLM calls when visibility disables all output", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createHeartbeatConfig({
        tmpDir,
        storePath,
        heartbeat: {
          every: "5m",
          target: "whatsapp",
        },
        channels: {
          whatsapp: {
            allowFrom: ["*"],
            heartbeat: { showOk: false, showAlerts: false, useIndicator: false },
          },
        },
      });
      await seedMainSession(storePath, cfg, {
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "+1555",
      });
      const sendWhatsApp = createMessageSendSpy();
      const result = await runHeartbeatOnce({
        cfg,
        deps: makeWhatsAppDeps({ sendWhatsApp }),
      });
      expect(replySpy).not.toHaveBeenCalled();
      expect(sendWhatsApp).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "skipped", reason: "alerts-disabled" });
    });
  });
  it("skips delivery for markup-wrapped HEARTBEAT_OK", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createHeartbeatConfig({
        tmpDir,
        storePath,
        heartbeat: {
          every: "5m",
          target: "whatsapp",
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
      });
      await seedMainSession(storePath, cfg, {
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "+1555",
      });
      replySpy.mockResolvedValue({ text: "<b>HEARTBEAT_OK</b>" });
      const sendWhatsApp = createMessageSendSpy();
      await runHeartbeatOnce({
        cfg,
        deps: makeWhatsAppDeps({ sendWhatsApp }),
      });
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });
  });
  it("does not regress updatedAt when restoring heartbeat sessions", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const originalUpdatedAt = 1000;
      const bumpedUpdatedAt = 2000;
      const cfg = createHeartbeatConfig({
        tmpDir,
        storePath,
        heartbeat: {
          every: "5m",
          target: "whatsapp",
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
      });
      const sessionKey = await seedMainSession(storePath, cfg, {
        updatedAt: originalUpdatedAt,
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "+1555",
      });
      replySpy.mockImplementationOnce(async () => {
        const raw = await fs.readFile(storePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed[sessionKey]) {
          parsed[sessionKey] = {
            ...parsed[sessionKey],
            updatedAt: bumpedUpdatedAt,
          };
        }
        await fs.writeFile(storePath, JSON.stringify(parsed, null, 2));
        return { text: "" };
      });
      await runHeartbeatOnce({
        cfg,
        deps: makeWhatsAppDeps(),
      });
      const finalStore = JSON.parse(await fs.readFile(storePath, "utf-8"));
      expect(finalStore[sessionKey]?.updatedAt).toBe(bumpedUpdatedAt);
    });
  });
  it("skips WhatsApp delivery when not linked or running", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createHeartbeatConfig({
        tmpDir,
        storePath,
        heartbeat: { every: "5m", target: "whatsapp" },
        channels: { whatsapp: { allowFrom: ["*"] } },
      });
      await seedMainSession(storePath, cfg, {
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "+1555",
      });
      replySpy.mockResolvedValue({ text: "Heartbeat alert" });
      const sendWhatsApp = createMessageSendSpy();
      const res = await runHeartbeatOnce({
        cfg,
        deps: makeWhatsAppDeps({
          sendWhatsApp,
          webAuthExists: async () => false,
          hasActiveWebListener: () => false,
        }),
      });
      expect(res.status).toBe("skipped");
      expect(res).toMatchObject({ reason: "whatsapp-not-linked" });
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });
  });
  async function expectTelegramHeartbeatAccountId(params) {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = createHeartbeatConfig({
        tmpDir,
        storePath,
        heartbeat: params.heartbeat,
        channels: { telegram: params.telegram },
      });
      await seedMainSession(storePath, cfg, {
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123456",
      });
      replySpy.mockResolvedValue({ text: "Hello from heartbeat" });
      const sendTelegram = createMessageSendSpy({ chatId: "123456" });
      await runHeartbeatOnce({
        cfg,
        deps: makeTelegramDeps({ sendTelegram }),
      });
      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledWith(
        "123456",
        "Hello from heartbeat",
        expect.objectContaining({ accountId: params.expectedAccountId, verbose: false }),
      );
    });
  }
  it.each([
    {
      title: "passes through accountId for telegram heartbeats",
      heartbeat: { every: "5m", target: "telegram" },
      telegram: { botToken: "test-bot-token-123" },
      expectedAccountId: undefined,
    },
    {
      title: "does not pre-resolve telegram accountId (allows config-only account tokens)",
      heartbeat: { every: "5m", target: "telegram" },
      telegram: {
        accounts: {
          work: { botToken: "test-bot-token-123" },
        },
      },
      expectedAccountId: undefined,
    },
    {
      title: "uses explicit heartbeat accountId for telegram delivery",
      heartbeat: { every: "5m", target: "telegram", accountId: "work" },
      telegram: {
        accounts: {
          work: { botToken: "test-bot-token-123" },
        },
      },
      expectedAccountId: "work",
    },
  ])("$title", async ({ heartbeat, telegram, expectedAccountId }) => {
    await expectTelegramHeartbeatAccountId({ heartbeat, telegram, expectedAccountId });
  });
});
