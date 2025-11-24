let toText = function (data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
};
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
export function createArgReader(argv = process.argv.slice(2)) {
  const get = (flag) => {
    const idx = argv.indexOf(flag);
    if (idx !== -1 && idx + 1 < argv.length) {
      return argv[idx + 1];
    }
    return;
  };
  const has = (flag) => argv.includes(flag);
  return { argv, get, has };
}
export function resolveGatewayUrl(urlRaw) {
  const url = new URL(urlRaw.includes("://") ? urlRaw : `wss://${urlRaw}`);
  if (!url.port) {
    url.port = url.protocol === "wss:" ? "443" : "80";
  }
  return url;
}
export function createGatewayWsClient(params) {
  const ws = new WebSocket(params.url, { handshakeTimeout: params.handshakeTimeoutMs ?? 8000 });
  const pending = new Map();
  const request = (method, paramsObj, timeoutMs = 12000) =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      const frame = { type: "req", id, method, params: paramsObj };
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify(frame));
    });
  const waitOpen = () =>
    new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("ws open timeout")),
        params.openTimeoutMs ?? 8000,
      );
      ws.once("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.once("error", (err) => {
        clearTimeout(t);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  ws.on("message", (data) => {
    const text = toText(data);
    let frame = null;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object" || !("type" in frame)) {
      return;
    }
    if (frame.type === "res") {
      const res = frame;
      const waiter = pending.get(res.id);
      if (waiter) {
        pending.delete(res.id);
        clearTimeout(waiter.timeout);
        waiter.resolve(res);
      }
      return;
    }
    if (frame.type === "event") {
      const evt = frame;
      params.onEvent?.(evt);
    }
  });
  const close = () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout);
    }
    pending.clear();
    ws.close();
  };
  return { ws, request, waitOpen, close };
}
