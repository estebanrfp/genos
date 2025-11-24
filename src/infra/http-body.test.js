let createMockRequest = function (params) {
  const req = new EventEmitter();
  req.destroyed = false;
  req.headers = params.headers ?? {};
  req.destroy = (error) => {
    req.destroyed = true;
    if (error) {
      queueMicrotask(() => {
        try {
          req.emit("error", error);
        } catch (err) {
          req.__unhandledDestroyError = err;
        }
      });
    }
    return req;
  };
  if (params.chunks) {
    Promise.resolve().then(() => {
      for (const chunk of params.chunks ?? []) {
        req.emit("data", Buffer.from(chunk, "utf-8"));
        if (req.destroyed) {
          return;
        }
      }
      if (params.emitEnd !== false) {
        req.emit("end");
      }
    });
  }
  return req;
};
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createMockServerResponse } from "../test-utils/mock-http-response.js";
import {
  installRequestBodyLimitGuard,
  isRequestBodyLimitError,
  readJsonBodyWithLimit,
  readRequestBodyWithLimit,
} from "./http-body.js";
async function waitForMicrotaskTurn() {
  await new Promise((resolve) => queueMicrotask(resolve));
}
describe("http body limits", () => {
  it("reads body within max bytes", async () => {
    const req = createMockRequest({ chunks: ['{"ok":true}'] });
    await expect(readRequestBodyWithLimit(req, { maxBytes: 1024 })).resolves.toBe('{"ok":true}');
  });
  it("rejects oversized body", async () => {
    const req = createMockRequest({ chunks: ["x".repeat(512)] });
    await expect(readRequestBodyWithLimit(req, { maxBytes: 64 })).rejects.toMatchObject({
      message: "PayloadTooLarge",
    });
    expect(req.__unhandledDestroyError).toBeUndefined();
  });
  it("returns json parse error when body is invalid", async () => {
    const req = createMockRequest({ chunks: ["{bad json"] });
    const result = await readJsonBodyWithLimit(req, { maxBytes: 1024, emptyObjectOnEmpty: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_JSON");
    }
  });
  it("returns payload-too-large for json body", async () => {
    const req = createMockRequest({ chunks: ["x".repeat(1024)] });
    const result = await readJsonBodyWithLimit(req, { maxBytes: 10 });
    expect(result).toEqual({ ok: false, code: "PAYLOAD_TOO_LARGE", error: "Payload too large" });
  });
  it("guard rejects oversized declared content-length", () => {
    const req = createMockRequest({
      headers: { "content-length": "9999" },
      emitEnd: false,
    });
    const res = createMockServerResponse();
    const guard = installRequestBodyLimitGuard(req, res, { maxBytes: 128 });
    expect(guard.isTripped()).toBe(true);
    expect(guard.code()).toBe("PAYLOAD_TOO_LARGE");
    expect(res.statusCode).toBe(413);
  });
  it("guard rejects streamed oversized body", async () => {
    const req = createMockRequest({ chunks: ["small", "x".repeat(256)], emitEnd: false });
    const res = createMockServerResponse();
    const guard = installRequestBodyLimitGuard(req, res, { maxBytes: 128, responseFormat: "text" });
    await waitForMicrotaskTurn();
    expect(guard.isTripped()).toBe(true);
    expect(guard.code()).toBe("PAYLOAD_TOO_LARGE");
    expect(res.statusCode).toBe(413);
    expect(res.body).toBe("Payload too large");
    expect(req.__unhandledDestroyError).toBeUndefined();
  });
  it("timeout surfaces typed error", async () => {
    const req = createMockRequest({ emitEnd: false });
    const promise = readRequestBodyWithLimit(req, { maxBytes: 128, timeoutMs: 10 });
    await expect(promise).rejects.toSatisfy((error) =>
      isRequestBodyLimitError(error, "REQUEST_BODY_TIMEOUT"),
    );
    expect(req.__unhandledDestroyError).toBeUndefined();
  });
  it("declared oversized content-length does not emit unhandled error", async () => {
    const req = createMockRequest({
      headers: { "content-length": "9999" },
      emitEnd: false,
    });
    await expect(readRequestBodyWithLimit(req, { maxBytes: 128 })).rejects.toMatchObject({
      message: "PayloadTooLarge",
    });
    await waitForMicrotaskTurn();
    expect(req.__unhandledDestroyError).toBeUndefined();
  });
});
