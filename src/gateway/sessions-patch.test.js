let makeKimiSubagentCfg = function (params) {
  return {
    agents: {
      defaults: {
        model: { primary: "anthropic/claude-sonnet-4-6" },
        subagents: params.defaultsSubagentModel
          ? { model: params.defaultsSubagentModel }
          : undefined,
        models: {
          "anthropic/claude-sonnet-4-6": { alias: "default" },
        },
      },
      list: [
        {
          id: "kimi",
          model: { primary: params.agentPrimaryModel },
          subagents: params.agentSubagentModel ? { model: params.agentSubagentModel } : undefined,
        },
      ],
    },
  };
};
import { describe, expect, test } from "vitest";
import { applySessionsPatchToStore } from "./sessions-patch.js";
const SUBAGENT_MODEL = "synthetic/hf:moonshotai/Kimi-K2.5";
const KIMI_SUBAGENT_KEY = "agent:kimi:subagent:child";
async function applySubagentModelPatch(cfg) {
  const res = await applySessionsPatchToStore({
    cfg,
    store: {},
    storeKey: KIMI_SUBAGENT_KEY,
    patch: {
      key: KIMI_SUBAGENT_KEY,
      model: SUBAGENT_MODEL,
    },
    loadGatewayModelCatalog: async () => [
      { provider: "anthropic", id: "claude-sonnet-4-6", name: "sonnet" },
      { provider: "synthetic", id: "hf:moonshotai/Kimi-K2.5", name: "kimi" },
    ],
  });
  expect(res.ok).toBe(true);
  if (!res.ok) {
    throw new Error(res.error.message);
  }
  return res.entry;
}
describe("gateway sessions patch", () => {
  test("persists thinkingLevel=off (does not clear)", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", thinkingLevel: "off" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.thinkingLevel).toBe("off");
  });
  test("clears thinkingLevel when patch sets null", async () => {
    const store = {
      "agent:main:main": { thinkingLevel: "low" },
    };
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", thinkingLevel: null },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.thinkingLevel).toBeUndefined();
  });
  test("persists elevatedLevel=off (does not clear)", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", elevatedLevel: "off" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.elevatedLevel).toBe("off");
  });
  test("persists elevatedLevel=on", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", elevatedLevel: "on" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.elevatedLevel).toBe("on");
  });
  test("clears elevatedLevel when patch sets null", async () => {
    const store = {
      "agent:main:main": { elevatedLevel: "off" },
    };
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", elevatedLevel: null },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.elevatedLevel).toBeUndefined();
  });
  test("rejects invalid elevatedLevel values", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", elevatedLevel: "maybe" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error.message).toContain("invalid elevatedLevel");
  });
  test("clears auth overrides when model patch changes", async () => {
    const store = {
      "agent:main:main": {
        sessionId: "sess",
        updatedAt: 1,
        providerOverride: "anthropic",
        modelOverride: "claude-opus-4-5",
        authProfileOverride: "anthropic:default",
        authProfileOverrideSource: "user",
        authProfileOverrideCompactionCount: 3,
      },
    };
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", model: "openai/gpt-5.2" },
      loadGatewayModelCatalog: async () => [{ provider: "openai", id: "gpt-5.2", name: "gpt-5.2" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.providerOverride).toBe("openai");
    expect(res.entry.modelOverride).toBe("gpt-5.2");
    expect(res.entry.authProfileOverride).toBeUndefined();
    expect(res.entry.authProfileOverrideSource).toBeUndefined();
    expect(res.entry.authProfileOverrideCompactionCount).toBeUndefined();
  });
  test("sets spawnDepth for subagent sessions", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:subagent:child",
      patch: { key: "agent:main:subagent:child", spawnDepth: 2 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.spawnDepth).toBe(2);
  });
  test("rejects spawnDepth on non-subagent sessions", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", spawnDepth: 1 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error.message).toContain("spawnDepth is only supported");
  });
  test("normalizes exec/send/group patches", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: {
        key: "agent:main:main",
        execHost: " NODE ",
        execSecurity: " ALLOWLIST ",
        execAsk: " ON-MISS ",
        execNode: " worker-1 ",
        sendPolicy: "DENY",
        groupActivation: "Always",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.execHost).toBe("node");
    expect(res.entry.execSecurity).toBe("allowlist");
    expect(res.entry.execAsk).toBe("on-miss");
    expect(res.entry.execNode).toBe("worker-1");
    expect(res.entry.sendPolicy).toBe("deny");
    expect(res.entry.groupActivation).toBe("always");
  });
  test("rejects invalid execHost values", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", execHost: "edge" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error.message).toContain("invalid execHost");
  });
  test("rejects invalid sendPolicy values", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", sendPolicy: "ask" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error.message).toContain("invalid sendPolicy");
  });
  test("rejects invalid groupActivation values", async () => {
    const store = {};
    const res = await applySessionsPatchToStore({
      cfg: {},
      store,
      storeKey: "agent:main:main",
      patch: { key: "agent:main:main", groupActivation: "never" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error.message).toContain("invalid groupActivation");
  });
  test("allows target agent own model for subagent session even when missing from global allowlist", async () => {
    const cfg = makeKimiSubagentCfg({
      agentPrimaryModel: "synthetic/hf:moonshotai/Kimi-K2.5",
    });
    const entry = await applySubagentModelPatch(cfg);
    expect(entry.providerOverride).toBeUndefined();
    expect(entry.modelOverride).toBeUndefined();
  });
  test("allows target agent subagents.model for subagent session even when missing from global allowlist", async () => {
    const cfg = makeKimiSubagentCfg({
      agentPrimaryModel: "anthropic/claude-sonnet-4-6",
      agentSubagentModel: SUBAGENT_MODEL,
    });
    const entry = await applySubagentModelPatch(cfg);
    expect(entry.providerOverride).toBe("synthetic");
    expect(entry.modelOverride).toBe("hf:moonshotai/Kimi-K2.5");
  });
  test("allows global defaults.subagents.model for subagent session even when missing from global allowlist", async () => {
    const cfg = makeKimiSubagentCfg({
      agentPrimaryModel: "anthropic/claude-sonnet-4-6",
      defaultsSubagentModel: SUBAGENT_MODEL,
    });
    const entry = await applySubagentModelPatch(cfg);
    expect(entry.providerOverride).toBe("synthetic");
    expect(entry.modelOverride).toBe("hf:moonshotai/Kimi-K2.5");
  });
});
