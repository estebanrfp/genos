let createGateway = function (resolveLabelKey = "agent:default:label") {
  const request = vi.fn(async (method, params) => {
    if (method === "sessions.resolve" && "label" in params) {
      return { ok: true, key: resolveLabelKey };
    }
    if (method === "sessions.resolve" && "key" in params) {
      return { ok: true, key: params.key };
    }
    return { ok: true };
  });
  return {
    gateway: { request },
    request,
  };
};
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSessionMeta, resolveSessionKey } from "./session-mapper.js";
import { createInMemorySessionStore } from "./session.js";
describe("acp session mapper", () => {
  it("prefers explicit sessionLabel over sessionKey", async () => {
    const { gateway, request } = createGateway();
    const meta = parseSessionMeta({ sessionLabel: "support", sessionKey: "agent:default:main" });
    const key = await resolveSessionKey({
      meta,
      fallbackKey: "acp:fallback",
      gateway,
      opts: {},
    });
    expect(key).toBe("agent:default:label");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("sessions.resolve", { label: "support" });
  });
  it("lets meta sessionKey override default label", async () => {
    const { gateway, request } = createGateway();
    const meta = parseSessionMeta({ sessionKey: "agent:default:override" });
    const key = await resolveSessionKey({
      meta,
      fallbackKey: "acp:fallback",
      gateway,
      opts: { defaultSessionLabel: "default-label" },
    });
    expect(key).toBe("agent:default:override");
    expect(request).not.toHaveBeenCalled();
  });
});
describe("acp session manager", () => {
  const store = createInMemorySessionStore();
  afterEach(() => {
    store.clearAllSessionsForTest();
  });
  it("tracks active runs and clears on cancel", () => {
    const session = store.createSession({
      sessionKey: "acp:test",
      cwd: "/tmp",
    });
    const controller = new AbortController();
    store.setActiveRun(session.sessionId, "run-1", controller);
    expect(store.getSessionByRunId("run-1")?.sessionId).toBe(session.sessionId);
    const cancelled = store.cancelActiveRun(session.sessionId);
    expect(cancelled).toBe(true);
    expect(store.getSessionByRunId("run-1")).toBeUndefined();
  });
});
