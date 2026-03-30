let extractPayloadText = function (result) {
  const record = result;
  const payloads = Array.isArray(record.payloads) ? record.payloads : [];
  const texts = payloads
    .map((p) => (p && typeof p === "object" ? p.text : undefined))
    .filter((t) => typeof t === "string" && t.trim().length > 0);
  return texts.join("\n").trim();
};
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startGatewayServer } from "./server.js";
import {
  connectDeviceAuthReq,
  connectGatewayClient,
  getFreeGatewayPort,
  startGatewayWithClient,
} from "./test-helpers.e2e.js";
import { installOpenAiResponsesMock } from "./test-helpers.openai-mock.js";
import { buildOpenAiResponsesProviderConfig } from "./test-openai-responses-model.js";
describe("gateway e2e", () => {
  it(
    "runs a mock OpenAI tool call end-to-end via gateway agent loop",
    { timeout: 90000 },
    async () => {
      const prev = {
        home: process.env.HOME,
        configPath: process.env.GENOS_CONFIG_PATH,
        token: process.env.GENOS_GATEWAY_TOKEN,
        skipChannels: process.env.GENOS_SKIP_CHANNELS,
        skipGmail: process.env.GENOS_SKIP_GMAIL_WATCHER,
        skipCron: process.env.GENOS_SKIP_CRON,
        skipCanvas: process.env.GENOS_SKIP_CANVAS_HOST,
        skipBrowser: process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER,
      };
      const { baseUrl: openaiBaseUrl, restore } = installOpenAiResponsesMock();
      const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-gw-mock-home-"));
      process.env.HOME = tempHome;
      process.env.GENOS_SKIP_CHANNELS = "1";
      process.env.GENOS_SKIP_GMAIL_WATCHER = "1";
      process.env.GENOS_SKIP_CRON = "1";
      process.env.GENOS_SKIP_CANVAS_HOST = "1";
      process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER = "1";
      const token = `test-${randomUUID()}`;
      process.env.GENOS_GATEWAY_TOKEN = token;
      const workspaceDir = path.join(tempHome, "genosos");
      await fs.mkdir(workspaceDir, { recursive: true });
      const nonceA = randomUUID();
      const nonceB = randomUUID();
      const toolProbePath = path.join(workspaceDir, `.genos-tool-probe.${nonceA}.txt`);
      await fs.writeFile(toolProbePath, `nonceA=${nonceA}\nnonceB=${nonceB}\n`);
      const configDir = path.join(tempHome, ".genosv1");
      await fs.mkdir(configDir, { recursive: true });
      const configPath = path.join(configDir, "genosos.json");
      const cfg = {
        agents: { defaults: { workspace: workspaceDir } },
        models: {
          mode: "replace",
          providers: {
            openai: buildOpenAiResponsesProviderConfig(openaiBaseUrl),
          },
        },
        gateway: { auth: { token } },
      };
      const { server, client } = await startGatewayWithClient({
        cfg,
        configPath,
        token,
        clientDisplayName: "vitest-mock-openai",
      });
      try {
        const sessionKey = "agent:dev:mock-openai";
        await client.request("sessions.patch", {
          key: sessionKey,
          model: "openai/gpt-5.2",
        });
        const runId = randomUUID();
        const payload = await client.request(
          "agent",
          {
            sessionKey,
            idempotencyKey: `idem-${runId}`,
            message: `Call the read tool on "${toolProbePath}". Then reply with exactly: ${nonceA} ${nonceB}. No extra text.`,
            deliver: false,
          },
          { expectFinal: true },
        );
        expect(payload?.status).toBe("ok");
        const text = extractPayloadText(payload?.result);
        expect(text).toContain(nonceA);
        expect(text).toContain(nonceB);
      } finally {
        client.stop();
        await server.close({ reason: "mock openai test complete" });
        await fs.rm(tempHome, { recursive: true, force: true });
        restore();
        process.env.HOME = prev.home;
        process.env.GENOS_CONFIG_PATH = prev.configPath;
        process.env.GENOS_GATEWAY_TOKEN = prev.token;
        process.env.GENOS_SKIP_CHANNELS = prev.skipChannels;
        process.env.GENOS_SKIP_GMAIL_WATCHER = prev.skipGmail;
        process.env.GENOS_SKIP_CRON = prev.skipCron;
        process.env.GENOS_SKIP_CANVAS_HOST = prev.skipCanvas;
        process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER = prev.skipBrowser;
      }
    },
  );
  it("runs wizard over ws and writes auth token config", { timeout: 90000 }, async () => {
    const prev = {
      home: process.env.HOME,
      stateDir: process.env.GENOS_STATE_DIR,
      configPath: process.env.GENOS_CONFIG_PATH,
      token: process.env.GENOS_GATEWAY_TOKEN,
      skipChannels: process.env.GENOS_SKIP_CHANNELS,
      skipGmail: process.env.GENOS_SKIP_GMAIL_WATCHER,
      skipCron: process.env.GENOS_SKIP_CRON,
      skipCanvas: process.env.GENOS_SKIP_CANVAS_HOST,
      skipBrowser: process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER,
    };
    process.env.GENOS_SKIP_CHANNELS = "1";
    process.env.GENOS_SKIP_GMAIL_WATCHER = "1";
    process.env.GENOS_SKIP_CRON = "1";
    process.env.GENOS_SKIP_CANVAS_HOST = "1";
    process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER = "1";
    delete process.env.GENOS_GATEWAY_TOKEN;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-wizard-home-"));
    process.env.HOME = tempHome;
    delete process.env.GENOS_STATE_DIR;
    delete process.env.GENOS_CONFIG_PATH;
    const wizardToken = `wiz-${randomUUID()}`;
    const port = await getFreeGatewayPort();
    const server = await startGatewayServer(port, {
      bind: "loopback",
      auth: { mode: "token", token: wizardToken },
      controlUiEnabled: false,
      wizardRunner: async (_opts, _runtime, prompter) => {
        await prompter.intro("Wizard E2E");
        await prompter.note("write token");
        const token = await prompter.text({ message: "token" });
        const { writeConfigFile } = await import("../config/config.js");
        await writeConfigFile({
          gateway: { auth: { mode: "token", token: String(token) } },
        });
        await prompter.outro("ok");
      },
    });
    const client = await connectGatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token: wizardToken,
      clientDisplayName: "vitest-wizard",
    });
    try {
      const start = await client.request("wizard.start", { mode: "local" });
      const sessionId = start.sessionId;
      expect(typeof sessionId).toBe("string");
      let next = start;
      let didSendToken = false;
      while (!next.done) {
        const step = next.step;
        if (!step) {
          throw new Error("wizard missing step");
        }
        const value = step.type === "text" ? wizardToken : null;
        if (step.type === "text") {
          didSendToken = true;
        }
        next = await client.request("wizard.next", {
          sessionId,
          answer: { stepId: step.id, value },
        });
      }
      expect(didSendToken).toBe(true);
      expect(next.status).toBe("done");
      const { resolveConfigPath } = await import("../config/config.js");
      const parsed = JSON.parse(await fs.readFile(resolveConfigPath(), "utf8"));
      const token = parsed?.gateway;
      expect(token?.auth?.token).toBe(wizardToken);
    } finally {
      client.stop();
      await server.close({ reason: "wizard e2e complete" });
    }
    const port2 = await getFreeGatewayPort();
    const server2 = await startGatewayServer(port2, {
      bind: "loopback",
      controlUiEnabled: false,
    });
    try {
      const resNoToken = await connectDeviceAuthReq({
        url: `ws://127.0.0.1:${port2}`,
      });
      expect(resNoToken.ok).toBe(false);
      expect(resNoToken.error?.message ?? "").toContain("unauthorized");
      const resToken = await connectDeviceAuthReq({
        url: `ws://127.0.0.1:${port2}`,
        token: wizardToken,
      });
      expect(resToken.ok).toBe(true);
    } finally {
      await server2.close({ reason: "wizard auth verify" });
      await fs.rm(tempHome, { recursive: true, force: true });
      process.env.HOME = prev.home;
      process.env.GENOS_STATE_DIR = prev.stateDir;
      process.env.GENOS_CONFIG_PATH = prev.configPath;
      process.env.GENOS_GATEWAY_TOKEN = prev.token;
      process.env.GENOS_SKIP_CHANNELS = prev.skipChannels;
      process.env.GENOS_SKIP_GMAIL_WATCHER = prev.skipGmail;
      process.env.GENOS_SKIP_CRON = prev.skipCron;
      process.env.GENOS_SKIP_CANVAS_HOST = prev.skipCanvas;
      process.env.GENOS_SKIP_BROWSER_CONTROL_SERVER = prev.skipBrowser;
    }
  });
});
