let createWebhookRequest = function (params) {
    const req = new EventEmitter();
    req.method = "POST";
    req.url = params.path ?? "/googlechat";
    req.headers = {
      authorization: params.authorization ?? "",
      "content-type": "application/json",
    };
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
      return req;
    };
    Promise.resolve().then(() => {
      req.emit("data", Buffer.from(JSON.stringify(params.payload), "utf-8"));
      if (!req.destroyed) {
        req.emit("end");
      }
    });
    return req;
  },
  registerTwoTargets = function () {
    const sinkA = vi.fn();
    const sinkB = vi.fn();
    const core = {};
    const config = {};
    const unregisterA = registerGoogleChatWebhookTarget({
      account: baseAccount("A"),
      config,
      runtime: {},
      core,
      path: "/googlechat",
      statusSink: sinkA,
      mediaMaxMb: 5,
    });
    const unregisterB = registerGoogleChatWebhookTarget({
      account: baseAccount("B"),
      config,
      runtime: {},
      core,
      path: "/googlechat",
      statusSink: sinkB,
      mediaMaxMb: 5,
    });
    return {
      sinkA,
      sinkB,
      unregister: () => {
        unregisterA();
        unregisterB();
      },
    };
  };
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createMockServerResponse } from "../../../src/test-utils/mock-http-response.js";
import { verifyGoogleChatRequest } from "./auth.js";
import { handleGoogleChatWebhookRequest, registerGoogleChatWebhookTarget } from "./monitor.js";
vi.mock("./auth.js", () => ({
  verifyGoogleChatRequest: vi.fn(),
}));
const baseAccount = (accountId) => ({
  accountId,
  enabled: true,
  credentialSource: "none",
  config: {},
});
describe("Google Chat webhook routing", () => {
  it("rejects ambiguous routing when multiple targets on the same path verify successfully", async () => {
    vi.mocked(verifyGoogleChatRequest).mockResolvedValue({ ok: true });
    const { sinkA, sinkB, unregister } = registerTwoTargets();
    try {
      const res = createMockServerResponse();
      const handled = await handleGoogleChatWebhookRequest(
        createWebhookRequest({
          authorization: "Bearer test-token",
          payload: { type: "ADDED_TO_SPACE", space: { name: "spaces/AAA" } },
        }),
        res,
      );
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(401);
      expect(sinkA).not.toHaveBeenCalled();
      expect(sinkB).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
  it("routes to the single verified target when earlier targets fail verification", async () => {
    vi.mocked(verifyGoogleChatRequest)
      .mockResolvedValueOnce({ ok: false, reason: "invalid" })
      .mockResolvedValueOnce({ ok: true });
    const { sinkA, sinkB, unregister } = registerTwoTargets();
    try {
      const res = createMockServerResponse();
      const handled = await handleGoogleChatWebhookRequest(
        createWebhookRequest({
          authorization: "Bearer test-token",
          payload: { type: "ADDED_TO_SPACE", space: { name: "spaces/BBB" } },
        }),
        res,
      );
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(sinkA).not.toHaveBeenCalled();
      expect(sinkB).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });
});
