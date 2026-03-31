import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSessionTranscriptPath } from "../config/sessions.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { captureEnv } from "../test-utils/env.js";
import {
  agentCommand,
  getFreePort,
  installGatewayTestHooks,
  startGatewayServer,
  testState,
} from "./test-helpers.js";
const { createGenosOSTools } = await import("../agents/genosos-tools.js");
installGatewayTestHooks({ scope: "suite" });
let server;
let gatewayPort;
const gatewayToken = "test-token";
let envSnapshot;
beforeAll(async () => {
  envSnapshot = captureEnv(["GENOS_GATEWAY_PORT", "GENOS_GATEWAY_TOKEN"]);
  gatewayPort = await getFreePort();
  testState.gatewayAuth = { mode: "token", token: gatewayToken };
  process.env.GENOS_GATEWAY_PORT = String(gatewayPort);
  process.env.GENOS_GATEWAY_TOKEN = gatewayToken;
  server = await startGatewayServer(gatewayPort);
});
afterAll(async () => {
  await server.close();
  envSnapshot.restore();
});
describe("sessions_send gateway loopback", () => {
  it("returns reply when lifecycle ends before agent.wait", async () => {
    const spy = agentCommand;
    spy.mockImplementation(async (opts) => {
      const params = opts;
      const sessionId = params.sessionId ?? "main";
      const runId = params.runId ?? sessionId;
      const sessionFile = resolveSessionTranscriptPath(sessionId);
      await fs.mkdir(path.dirname(sessionFile), { recursive: true });
      const startedAt = Date.now();
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: { phase: "start", startedAt },
      });
      let text = "pong";
      if (params.extraSystemPrompt?.includes("Agent-to-agent reply step")) {
        text = "REPLY_SKIP";
      } else if (params.extraSystemPrompt?.includes("Agent-to-agent announce step")) {
        text = "ANNOUNCE_SKIP";
      }
      const message = {
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
      };
      await fs.appendFile(sessionFile, `${JSON.stringify({ message })}\n`, "utf8");
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          phase: "end",
          startedAt,
          endedAt: Date.now(),
        },
      });
    });
    const tool = createGenosOSTools().find((candidate) => candidate.name === "sessions_send");
    if (!tool) {
      throw new Error("missing sessions_send tool");
    }
    const result = await tool.execute("call-loopback", {
      sessionKey: "main",
      message: "ping",
      timeoutSeconds: 5,
    });
    const details = result.details;
    expect(details.status).toBe("ok");
    expect(details.reply).toBe("pong");
    expect(details.sessionKey).toBe("main");
    const firstCall = spy.mock.calls[0]?.[0];
    expect(firstCall?.lane).toBe("nested");
    expect(firstCall?.inputProvenance).toMatchObject({
      kind: "inter_session",
      sourceTool: "sessions_send",
    });
  });
});
describe("sessions_send label lookup", () => {
  it("finds session by label and sends message", { timeout: 60000 }, async () => {
    const configPath = process.env.GENOS_CONFIG_PATH;
    if (!configPath) {
      throw new Error("GENOS_CONFIG_PATH missing in gateway test environment");
    }
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ tools: { sessions: { visibility: "all" } } }, null, 2) + "\n",
      "utf-8",
    );
    const spy = agentCommand;
    spy.mockImplementation(async (opts) => {
      const params = opts;
      const sessionId = params.sessionId ?? "test-labeled";
      const runId = params.runId ?? sessionId;
      const sessionFile = resolveSessionTranscriptPath(sessionId);
      await fs.mkdir(path.dirname(sessionFile), { recursive: true });
      const startedAt = Date.now();
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: { phase: "start", startedAt },
      });
      const text = "labeled response";
      const message = {
        role: "assistant",
        content: [{ type: "text", text }],
      };
      await fs.appendFile(sessionFile, `${JSON.stringify({ message })}\n`, "utf8");
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: { phase: "end", startedAt, endedAt: Date.now() },
      });
    });
    const { callGateway } = await import("./call.js");
    await callGateway({
      method: "sessions.patch",
      params: { key: "test-labeled-session", label: "my-test-worker" },
      timeoutMs: 5000,
    });
    const tool = createGenosOSTools().find((candidate) => candidate.name === "sessions_send");
    if (!tool) {
      throw new Error("missing sessions_send tool");
    }
    const result = await tool.execute("call-by-label", {
      label: "my-test-worker",
      message: "hello labeled session",
      timeoutSeconds: 5,
    });
    const details = result.details;
    expect(details.status).toBe("ok");
    expect(details.reply).toBe("labeled response");
    expect(details.sessionKey).toBe("agent:default:test-labeled-session");
  });
  it("returns error when label not found", { timeout: 60000 }, async () => {
    const tool = createGenosOSTools().find((candidate) => candidate.name === "sessions_send");
    if (!tool) {
      throw new Error("missing sessions_send tool");
    }
    const result = await tool.execute("call-missing-label", {
      label: "nonexistent-label",
      message: "hello",
      timeoutSeconds: 5,
    });
    const details = result.details;
    expect(details.status).toBe("error");
    expect(details.error).toContain("No session found with label");
  });
  it("returns error when neither sessionKey nor label provided", { timeout: 60000 }, async () => {
    const tool = createGenosOSTools().find((candidate) => candidate.name === "sessions_send");
    if (!tool) {
      throw new Error("missing sessions_send tool");
    }
    const result = await tool.execute("call-no-key", {
      message: "hello",
      timeoutSeconds: 5,
    });
    const details = result.details;
    expect(details.status).toBe("error");
    expect(details.error).toContain("Either sessionKey or label is required");
  });
});
