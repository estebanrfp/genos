import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { rawDataToString } from "../infra/ws.js";
import { defaultRuntime } from "../runtime.js";
import {
  CANVAS_HOST_PATH,
  CANVAS_WS_PATH,
  createCanvasHostHandler,
  startCanvasHost,
} from "./server.js";
const chokidarMockState = vi.hoisted(() => ({
  watchers: [],
}));
vi.mock("chokidar", () => {
  const createWatcher = () => {
    const handlers = new Map();
    const api = {
      on: (event, cb) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
        return api;
      },
      close: async () => {},
      __emit: (event, ...args) => {
        for (const cb of handlers.get(event) ?? []) {
          cb(...args);
        }
      },
    };
    chokidarMockState.watchers.push(api);
    return api;
  };
  const watch = () => createWatcher();
  return {
    default: { watch },
    watch,
  };
});
describe("canvas host", () => {
  const quietRuntime = {
    ...defaultRuntime,
    log: (..._args) => {},
  };
  let fixtureRoot = "";
  let fixtureCount = 0;
  const createCaseDir = async () => {
    const dir = path.join(fixtureRoot, `case-${fixtureCount++}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  };
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-canvas-fixtures-"));
  });
  afterAll(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  it("injects live reload script via served HTML", async () => {
    const dir = await createCaseDir();
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>Hello</body></html>", "utf8");
    const server = await startCanvasHost({
      runtime: quietRuntime,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`);
      const html = await res.text();
      expect(html).toContain(CANVAS_WS_PATH);
      expect(html).toContain("location.reload");
    } finally {
      await server.close();
    }
  });
  it("creates a default index.html when missing", async () => {
    const dir = await createCaseDir();
    const server = await startCanvasHost({
      runtime: quietRuntime,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("Interactive test page");
      expect(html).toContain(CANVAS_WS_PATH);
    } finally {
      await server.close();
    }
  });
  it("skips live reload injection when disabled", async () => {
    const dir = await createCaseDir();
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>no-reload</body></html>", "utf8");
    const server = await startCanvasHost({
      runtime: quietRuntime,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
      liveReload: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("no-reload");
      expect(html).not.toContain(CANVAS_WS_PATH);
      const wsRes = await fetch(`http://127.0.0.1:${server.port}${CANVAS_WS_PATH}`);
      expect(wsRes.status).toBe(404);
    } finally {
      await server.close();
    }
  });
  it("serves canvas content from the mounted base path and reuses handlers without double close", async () => {
    const dir = await createCaseDir();
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>v1</body></html>", "utf8");
    const handler = await createCanvasHostHandler({
      runtime: quietRuntime,
      rootDir: dir,
      basePath: CANVAS_HOST_PATH,
      allowInTests: true,
    });
    const server = createServer((req, res) => {
      (async () => {
        if (await handler.handleHttpRequest(req, res)) {
          return;
        }
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not Found");
      })();
    });
    server.on("upgrade", (req, socket, head) => {
      if (handler.handleUpgrade(req, socket, head)) {
        return;
      }
      socket.destroy();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}${CANVAS_HOST_PATH}/`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("v1");
      expect(html).toContain(CANVAS_WS_PATH);
      const miss = await fetch(`http://127.0.0.1:${port}/`);
      expect(miss.status).toBe(404);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    const originalClose = handler.close;
    const closeSpy = vi.fn(async () => originalClose());
    handler.close = closeSpy;
    const hosted = await startCanvasHost({
      runtime: quietRuntime,
      handler,
      ownsHandler: false,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });
    try {
      expect(hosted.port).toBeGreaterThan(0);
    } finally {
      await hosted.close();
      expect(closeSpy).not.toHaveBeenCalled();
      await originalClose();
    }
  });
  it("serves HTML with injection and broadcasts reload on file changes", async () => {
    const dir = await createCaseDir();
    const index = path.join(dir, "index.html");
    await fs.writeFile(index, "<html><body>v1</body></html>", "utf8");
    const watcherStart = chokidarMockState.watchers.length;
    const server = await startCanvasHost({
      runtime: quietRuntime,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });
    try {
      const watcher = chokidarMockState.watchers[watcherStart];
      expect(watcher).toBeTruthy();
      const res = await fetch(`http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("v1");
      expect(html).toContain(CANVAS_WS_PATH);
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}${CANVAS_WS_PATH}`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws open timeout")), 5000);
        ws.on("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      const msg = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("reload timeout")), 1e4);
        ws.on("message", (data) => {
          clearTimeout(timer);
          resolve(rawDataToString(data));
        });
      });
      await fs.writeFile(index, "<html><body>v2</body></html>", "utf8");
      watcher.__emit("all", "change", index);
      expect(await msg).toBe("reload");
      ws.close();
    } finally {
      await server.close();
    }
  }, 20000);
  it("blocks traversal escapes on canvas paths", async () => {
    const dir = await createCaseDir();
    await fs.writeFile(path.join(dir, "index.html"), "<html><body>ok</body></html>", "utf8");
    const server = await startCanvasHost({
      runtime: quietRuntime,
      rootDir: dir,
      port: 0,
      listenHost: "127.0.0.1",
      allowInTests: true,
    });
    try {
      const traversalRes = await fetch(
        `http://127.0.0.1:${server.port}${CANVAS_HOST_PATH}/%2e%2e%2fpackage.json`,
      );
      expect(traversalRes.status).toBe(404);
      expect(await traversalRes.text()).toBe("not found");
    } finally {
      await server.close();
    }
  });
});
