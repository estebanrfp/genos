let writeTempPlugin = function (params) {
    const pluginDir = path.join(params.dir, params.id);
    fs.mkdirSync(pluginDir, { recursive: true });
    const file = path.join(pluginDir, `${params.id}.mjs`);
    fs.writeFileSync(file, params.body, "utf-8");
    fs.writeFileSync(
      path.join(pluginDir, "genosos.plugin.json"),
      JSON.stringify(
        {
          id: params.id,
          configSchema: EMPTY_PLUGIN_SCHEMA,
        },
        null,
        2,
      ),
      "utf-8",
    );
    return file;
  },
  appendToolCallAndResult = function (sm) {
    const appendMessage = sm.appendMessage.bind(sm);
    appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
    });
    appendMessage({
      role: "toolResult",
      toolCallId: "call_1",
      isError: false,
      content: [{ type: "text", text: "ok" }],
      details: { big: "x".repeat(1e4) },
    });
  },
  getPersistedToolResult = function (sm) {
    const messages = sm
      .getEntries()
      .filter((e) => e.type === "message")
      .map((e) => e.message);
    return messages.find((m) => m.role === "toolResult");
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, afterEach } from "vitest";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../plugins/hook-runner-global.js";
import { loadGenosOSPlugins } from "../plugins/loader.js";
import { guardSessionManager } from "./session-tool-result-guard-wrapper.js";
const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };
afterEach(() => {
  resetGlobalHookRunner();
});
describe("tool_result_persist hook", () => {
  it("does not modify persisted toolResult messages when no hook is registered", () => {
    const sm = guardSessionManager(SessionManager.inMemory(), {
      agentId: "main",
      sessionKey: "main",
    });
    appendToolCallAndResult(sm);
    const toolResult = getPersistedToolResult(sm);
    expect(toolResult).toBeTruthy();
    expect(toolResult.details).toBeTruthy();
  });
  it("loads tool_result_persist hooks without breaking persistence", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-toolpersist-"));
    process.env.GENOS_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const pluginA = writeTempPlugin({
      dir: tmp,
      id: "persist-a",
      body: `export default { id: "persist-a", register(api) {
  api.on("tool_result_persist", (event, ctx) => {
    const msg = event.message;
    // Example: remove large diagnostic payloads before persistence.
    const { details: _details, ...rest } = msg;
    return { message: { ...rest, persistOrder: ["a"], agentSeen: ctx.agentId ?? null } };
  }, { priority: 10 });
} };`,
    });
    const pluginB = writeTempPlugin({
      dir: tmp,
      id: "persist-b",
      body: `export default { id: "persist-b", register(api) {
  api.on("tool_result_persist", (event) => {
    const prior = (event.message && event.message.persistOrder) ? event.message.persistOrder : [];
    return { message: { ...event.message, persistOrder: [...prior, "b"] } };
  }, { priority: 5 });
} };`,
    });
    const registry = loadGenosOSPlugins({
      cache: false,
      workspaceDir: tmp,
      config: {
        plugins: {
          load: { paths: [pluginA, pluginB] },
          allow: ["persist-a", "persist-b"],
        },
      },
    });
    initializeGlobalHookRunner(registry);
    const sm = guardSessionManager(SessionManager.inMemory(), {
      agentId: "main",
      sessionKey: "main",
    });
    appendToolCallAndResult(sm);
    const toolResult = getPersistedToolResult(sm);
    expect(toolResult).toBeTruthy();
    expect(toolResult.details).toBeTruthy();
  });
});
describe("before_message_write hook", () => {
  it("continues persistence when a before_message_write hook throws", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-before-write-"));
    process.env.GENOS_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const plugin = writeTempPlugin({
      dir: tmp,
      id: "before-write-throws",
      body: `export default { id: "before-write-throws", register(api) {
  api.on("before_message_write", () => {
    throw new Error("boom");
  }, { priority: 10 });
} };`,
    });
    const registry = loadGenosOSPlugins({
      cache: false,
      workspaceDir: tmp,
      config: {
        plugins: {
          load: { paths: [plugin] },
          allow: ["before-write-throws"],
        },
      },
    });
    initializeGlobalHookRunner(registry);
    const sm = guardSessionManager(SessionManager.inMemory(), {
      agentId: "main",
      sessionKey: "main",
    });
    const appendMessage = sm.appendMessage.bind(sm);
    appendMessage({
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    });
    const messages = sm
      .getEntries()
      .filter((e) => e.type === "message")
      .map((e) => e.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
  });
});
