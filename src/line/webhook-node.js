import { danger, logVerbose } from "../globals.js";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "../infra/http-body.js";
import { validateLineSignature } from "./signature.js";
import { isLineWebhookVerificationRequest, parseLineWebhookBody } from "./webhook-utils.js";
const LINE_WEBHOOK_MAX_BODY_BYTES = 1048576;
const LINE_WEBHOOK_BODY_TIMEOUT_MS = 30000;
export async function readLineWebhookRequestBody(req, maxBytes = LINE_WEBHOOK_MAX_BODY_BYTES) {
  return await readRequestBodyWithLimit(req, {
    maxBytes,
    timeoutMs: LINE_WEBHOOK_BODY_TIMEOUT_MS,
  });
}
export function createLineNodeWebhookHandler(params) {
  const maxBodyBytes = params.maxBodyBytes ?? LINE_WEBHOOK_MAX_BODY_BYTES;
  const readBody = params.readBody ?? readLineWebhookRequestBody;
  return async (req, res) => {
    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("OK");
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }
    try {
      const rawBody = await readBody(req, maxBodyBytes);
      const signature = req.headers["x-line-signature"];
      const body = parseLineWebhookBody(rawBody);
      if (!signature || typeof signature !== "string") {
        if (isLineWebhookVerificationRequest(body)) {
          logVerbose("line: webhook verification request (empty events, no signature) - 200 OK");
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        logVerbose("line: webhook missing X-Line-Signature header");
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing X-Line-Signature header" }));
        return;
      }
      if (!validateLineSignature(rawBody, signature, params.channelSecret)) {
        logVerbose("line: webhook signature validation failed");
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }
      if (!body) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid webhook payload" }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
      if (body.events && body.events.length > 0) {
        logVerbose(`line: received ${body.events.length} webhook events`);
        await params.bot.handleWebhook(body).catch((err) => {
          params.runtime.error?.(danger(`line webhook handler failed: ${String(err)}`));
        });
      }
    } catch (err) {
      if (isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE")) {
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Payload too large" }));
        return;
      }
      if (isRequestBodyLimitError(err, "REQUEST_BODY_TIMEOUT")) {
        res.statusCode = 408;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: requestBodyErrorToText("REQUEST_BODY_TIMEOUT") }));
        return;
      }
      params.runtime.error?.(danger(`line webhook error: ${String(err)}`));
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  };
}
