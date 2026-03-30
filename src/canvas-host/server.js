let defaultIndexHTML = function () {
    return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GenosOS Canvas</title>
<style>
  html, body { height: 100%; margin: 0; background: #000; color: #fff; font: 16px/1.4 -apple-system, BlinkMacSystemFont, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  .wrap { min-height: 100%; display: grid; place-items: center; padding: 24px; }
  .card { width: min(720px, 100%); background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; padding: 18px 18px 14px; }
  .title { display: flex; align-items: baseline; gap: 10px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: 0.2px; }
  .sub { opacity: 0.75; font-size: 13px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  button { appearance: none; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.10); color: #fff; padding: 10px 12px; border-radius: 12px; font-weight: 600; cursor: pointer; }
  button:active { transform: translateY(1px); }
  .ok { color: #24e08a; }
  .bad { color: #ff5c5c; }
  .log { margin-top: 14px; opacity: 0.85; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; white-space: pre-wrap; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); padding: 10px; border-radius: 12px; }
</style>
<div class="wrap">
  <div class="card">
    <div class="title">
      <h1>GenosOS Canvas</h1>
      <div class="sub">Interactive test page (auto-reload enabled)</div>
    </div>

    <div class="row">
      <button id="btn-hello">Hello</button>
      <button id="btn-time">Time</button>
      <button id="btn-photo">Photo</button>
      <button id="btn-dalek">Dalek</button>
    </div>

    <div id="status" class="sub" style="margin-top: 10px;"></div>
    <div id="log" class="log">Ready.</div>
  </div>
</div>
<script>
(() => {
  const logEl = document.getElementById("log");
  const statusEl = document.getElementById("status");
  const log = (msg) => { logEl.textContent = String(msg); };

  document.getElementById("btn-hello").onclick = () => log("Hello from GenosOS Canvas!");
  document.getElementById("btn-time").onclick = () => log("Time: " + new Date().toISOString());
  document.getElementById("btn-photo").onclick = () => log("Photo action triggered");
  document.getElementById("btn-dalek").onclick = () => log("Dalek action triggered");
})();
</script>
`;
  },
  isDisabledByEnv = function () {
    if (isTruthyEnvValue(process.env.GENOS_SKIP_CANVAS_HOST)) {
      return true;
    }
    if (isTruthyEnvValue(process.env.GENOS_SKIP_CANVAS_HOST)) {
      return true;
    }
    if (process.env.VITEST) {
      return true;
    }
    return false;
  },
  normalizeBasePath = function (rawPath) {
    const trimmed = (rawPath ?? CANVAS_HOST_PATH).trim();
    const normalized = normalizeUrlPath(trimmed || CANVAS_HOST_PATH);
    if (normalized === "/") {
      return "/";
    }
    return normalized.replace(/\/+$/, "");
  },
  resolveDefaultCanvasRoot = function () {
    const candidates = [path.join(resolveStateDir(), "canvas")];
    const existing = candidates.find((dir) => {
      try {
        return fsSync.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
    return existing ?? candidates[0];
  };
import * as fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import chokidar from "chokidar";
import { WebSocketServer } from "ws";
import { resolveStateDir } from "../config/paths.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { detectMime } from "../media/mime.js";
import { ensureDir, resolveUserPath } from "../utils.js";
import { normalizeUrlPath, resolveFileWithinRoot } from "./file-resolver.js";

export const CANVAS_HOST_PATH = "/__genosos__/canvas";
export const CANVAS_WS_PATH = "/__genosos__/ws";

/**
 * Inject a live-reload WebSocket snippet before </body> (or at end).
 * @param {string} html
 * @returns {string}
 */
function injectCanvasLiveReload(html) {
  const snippet = `\n<script>\n(() => {\n  const ws = new WebSocket(\`ws://\${location.host}${CANVAS_WS_PATH}\`);\n  ws.onmessage = (e) => { if (e.data === "reload") location.reload(); };\n  ws.onclose = () => setTimeout(() => location.reload(), 1500);\n})();\n</script>\n`;
  const idx = html.lastIndexOf("</body>");
  return idx >= 0 ? html.slice(0, idx) + snippet + html.slice(idx) : html + snippet;
}
async function prepareCanvasRoot(rootDir) {
  await ensureDir(rootDir);
  const rootReal = await fs.realpath(rootDir);
  try {
    const indexPath = path.join(rootReal, "index.html");
    await fs.stat(indexPath);
  } catch {
    try {
      await fs.writeFile(path.join(rootReal, "index.html"), defaultIndexHTML(), "utf8");
    } catch {}
  }
  return rootReal;
}
export async function createCanvasHostHandler(opts) {
  const basePath = normalizeBasePath(opts.basePath);
  if (isDisabledByEnv() && opts.allowInTests !== true) {
    return {
      rootDir: "",
      basePath,
      handleHttpRequest: async () => false,
      handleUpgrade: () => false,
      close: async () => {},
    };
  }
  const rootDir = resolveUserPath(opts.rootDir ?? resolveDefaultCanvasRoot());
  const rootReal = await prepareCanvasRoot(rootDir);
  const liveReload = opts.liveReload !== false;
  const testMode = opts.allowInTests === true;
  const reloadDebounceMs = testMode ? 12 : 75;
  const writeStabilityThresholdMs = testMode ? 12 : 75;
  const writePollIntervalMs = testMode ? 5 : 10;
  const wss = liveReload ? new WebSocketServer({ noServer: true }) : null;
  const sockets = new Set();
  if (wss) {
    wss.on("connection", (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
    });
  }
  let debounce = null;
  const broadcastReload = () => {
    if (!liveReload) {
      return;
    }
    for (const ws of sockets) {
      try {
        ws.send("reload");
      } catch {}
    }
  };
  const scheduleReload = () => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      debounce = null;
      broadcastReload();
    }, reloadDebounceMs);
    debounce.unref?.();
  };
  let watcherClosed = false;
  const watcher = liveReload
    ? chokidar.watch(rootReal, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: writeStabilityThresholdMs,
          pollInterval: writePollIntervalMs,
        },
        usePolling: testMode,
        ignored: [/(^|[\\/])\../, /(^|[\\/])node_modules([\\/]|$)/],
      })
    : null;
  watcher?.on("all", () => scheduleReload());
  watcher?.on("error", (err) => {
    if (watcherClosed) {
      return;
    }
    watcherClosed = true;
    opts.runtime.error(
      `canvasHost watcher error: ${String(err)} (live reload disabled; consider canvasHost.liveReload=false or a smaller canvasHost.root)`,
    );
    watcher.close().catch(() => {});
  });
  const handleUpgrade = (req, socket, head) => {
    if (!wss) {
      return false;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== CANVAS_WS_PATH) {
      return false;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return true;
  };
  const handleHttpRequest = async (req, res) => {
    const urlRaw = req.url;
    if (!urlRaw) {
      return false;
    }
    try {
      const url = new URL(urlRaw, "http://localhost");
      if (url.pathname === CANVAS_WS_PATH) {
        res.statusCode = liveReload ? 426 : 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(liveReload ? "upgrade required" : "not found");
        return true;
      }
      let urlPath = url.pathname;
      if (basePath !== "/") {
        if (urlPath !== basePath && !urlPath.startsWith(`${basePath}/`)) {
          return false;
        }
        urlPath = urlPath === basePath ? "/" : urlPath.slice(basePath.length) || "/";
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Method Not Allowed");
        return true;
      }
      const opened = await resolveFileWithinRoot(rootReal, urlPath);
      if (!opened) {
        if (urlPath === "/" || urlPath.endsWith("/")) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            `<!doctype html><meta charset="utf-8" /><title>GenosOS Canvas</title><pre>Missing file.\nCreate ${rootDir}/index.html</pre>`,
          );
          return true;
        }
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("not found");
        return true;
      }
      const { handle, realPath } = opened;
      let data;
      try {
        data = await handle.readFile();
      } finally {
        await handle.close().catch(() => {});
      }
      const lower = realPath.toLowerCase();
      const mime =
        lower.endsWith(".html") || lower.endsWith(".htm")
          ? "text/html"
          : ((await detectMime({ filePath: realPath })) ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      if (mime === "text/html") {
        const html = data.toString("utf8");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(liveReload ? injectCanvasLiveReload(html) : html);
        return true;
      }
      res.setHeader("Content-Type", mime);
      res.end(data);
      return true;
    } catch (err) {
      opts.runtime.error(`canvasHost request failed: ${String(err)}`);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("error");
      return true;
    }
  };
  return {
    rootDir,
    basePath,
    handleHttpRequest,
    handleUpgrade,
    close: async () => {
      if (debounce) {
        clearTimeout(debounce);
      }
      watcherClosed = true;
      await watcher?.close().catch(() => {});
      if (wss) {
        await new Promise((resolve) => wss.close(() => resolve()));
      }
    },
  };
}
export async function startCanvasHost(opts) {
  if (isDisabledByEnv() && opts.allowInTests !== true) {
    return { port: 0, rootDir: "", close: async () => {} };
  }
  const handler =
    opts.handler ??
    (await createCanvasHostHandler({
      runtime: opts.runtime,
      rootDir: opts.rootDir,
      basePath: CANVAS_HOST_PATH,
      allowInTests: opts.allowInTests,
      liveReload: opts.liveReload,
    }));
  const ownsHandler = opts.ownsHandler ?? opts.handler === undefined;
  const bindHost = opts.listenHost?.trim() || "127.0.0.1";
  const server = http.createServer((req, res) => {
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }
    (async () => {
      if (await handler.handleHttpRequest(req, res)) {
        return;
      }
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    })().catch((err) => {
      opts.runtime.error(`canvasHost request failed: ${String(err)}`);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("error");
    });
  });
  server.on("upgrade", (req, socket, head) => {
    if (handler.handleUpgrade(req, socket, head)) {
      return;
    }
    socket.destroy();
  });
  const listenPort =
    typeof opts.port === "number" && Number.isFinite(opts.port) && opts.port > 0 ? opts.port : 0;
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(listenPort, bindHost);
  });
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : 0;
  opts.runtime.log(
    `canvas host listening on http://${bindHost}:${boundPort} (root ${handler.rootDir})`,
  );
  return {
    port: boundPort,
    rootDir: handler.rootDir,
    close: async () => {
      if (ownsHandler) {
        await handler.close();
      }
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
