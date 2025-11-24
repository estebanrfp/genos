let createRes = function () {
    const headers = {};
    const resObj = {
      statusCode: 0,
      headersSent: false,
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v;
      },
      end: vi.fn((data) => {
        resObj.headersSent = true;
        resObj.body = data;
      }),
      body: undefined,
    };
    const res = resObj;
    return { res, headers };
  },
  createPostWebhookTestHarness = function (rawBody, secret = "secret") {
    const bot = { handleWebhook: vi.fn(async () => {}) };
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const handler = createLineNodeWebhookHandler({
      channelSecret: secret,
      bot,
      runtime,
      readBody: async () => rawBody,
    });
    return { bot, handler, secret };
  };
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLineNodeWebhookHandler } from "./webhook-node.js";
const sign = (body, secret) => crypto.createHmac("SHA256", secret).update(body).digest("base64");
describe("createLineNodeWebhookHandler", () => {
  it("returns 200 for GET", async () => {
    const bot = { handleWebhook: vi.fn(async () => {}) };
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    const handler = createLineNodeWebhookHandler({
      channelSecret: "secret",
      bot,
      runtime,
      readBody: async () => "",
    });
    const { res } = createRes();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("OK");
  });
  it("returns 200 for verification request (empty events, no signature)", async () => {
    const rawBody = JSON.stringify({ events: [] });
    const { bot, handler } = createPostWebhookTestHarness(rawBody);
    const { res, headers } = createRes();
    await handler({ method: "POST", headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(headers["content-type"]).toBe("application/json");
    expect(res.body).toBe(JSON.stringify({ status: "ok" }));
    expect(bot.handleWebhook).not.toHaveBeenCalled();
  });
  it("rejects missing signature when events are non-empty", async () => {
    const rawBody = JSON.stringify({ events: [{ type: "message" }] });
    const { bot, handler } = createPostWebhookTestHarness(rawBody);
    const { res } = createRes();
    await handler({ method: "POST", headers: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(bot.handleWebhook).not.toHaveBeenCalled();
  });
  it("rejects invalid signature", async () => {
    const rawBody = JSON.stringify({ events: [{ type: "message" }] });
    const { bot, handler } = createPostWebhookTestHarness(rawBody);
    const { res } = createRes();
    await handler({ method: "POST", headers: { "x-line-signature": "bad" } }, res);
    expect(res.statusCode).toBe(401);
    expect(bot.handleWebhook).not.toHaveBeenCalled();
  });
  it("accepts valid signature and dispatches events", async () => {
    const rawBody = JSON.stringify({ events: [{ type: "message" }] });
    const { bot, handler, secret } = createPostWebhookTestHarness(rawBody);
    const { res } = createRes();
    await handler(
      {
        method: "POST",
        headers: { "x-line-signature": sign(rawBody, secret) },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(bot.handleWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ events: expect.any(Array) }),
    );
  });
  it("returns 400 for invalid JSON payload even when signature is valid", async () => {
    const rawBody = "not json";
    const { bot, handler, secret } = createPostWebhookTestHarness(rawBody);
    const { res } = createRes();
    await handler(
      {
        method: "POST",
        headers: { "x-line-signature": sign(rawBody, secret) },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(bot.handleWebhook).not.toHaveBeenCalled();
  });
});
