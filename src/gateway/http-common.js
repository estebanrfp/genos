import { readJsonBody } from "./hooks.js";
export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
export function sendText(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}
export function sendMethodNotAllowed(res, allow = "POST") {
  res.setHeader("Allow", allow);
  sendText(res, 405, "Method Not Allowed");
}
export function sendUnauthorized(res) {
  sendJson(res, 401, {
    error: { message: "Unauthorized", type: "unauthorized" },
  });
}
export function sendRateLimited(res, retryAfterMs) {
  if (retryAfterMs && retryAfterMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  }
  sendJson(res, 429, {
    error: {
      message: "Too many failed authentication attempts. Please try again later.",
      type: "rate_limited",
    },
  });
}
export function sendGatewayAuthFailure(res, authResult) {
  if (authResult.rateLimited) {
    sendRateLimited(res, authResult.retryAfterMs);
    return;
  }
  sendUnauthorized(res);
}
export function sendInvalidRequest(res, message) {
  sendJson(res, 400, {
    error: { message, type: "invalid_request_error" },
  });
}
export async function readJsonBodyOrError(req, res, maxBytes) {
  const body = await readJsonBody(req, maxBytes);
  if (!body.ok) {
    if (body.error === "payload too large") {
      sendJson(res, 413, {
        error: { message: "Payload too large", type: "invalid_request_error" },
      });
      return;
    }
    if (body.error === "request body timeout") {
      sendJson(res, 408, {
        error: { message: "Request body timeout", type: "invalid_request_error" },
      });
      return;
    }
    sendInvalidRequest(res, body.error);
    return;
  }
  return body.value;
}
export function writeDone(res) {
  res.write("data: [DONE]\n\n");
}
export function setSseHeaders(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
