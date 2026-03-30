import fs from "node:fs/promises";
import express from "express";
import { danger } from "../globals.js";
import { SafeOpenError, openFileWithinRoot } from "../infra/fs-safe.js";
import { defaultRuntime } from "../runtime.js";
import { detectMime } from "./mime.js";
import { cleanOldMedia, getMediaDir, MEDIA_MAX_BYTES } from "./store.js";
const DEFAULT_TTL_MS = 120000;
const MAX_MEDIA_ID_CHARS = 200;
const MEDIA_ID_PATTERN = /^[\p{L}\p{N}._-]+$/u;
const MAX_MEDIA_BYTES = MEDIA_MAX_BYTES;
const isValidMediaId = (id) => {
  if (!id) {
    return false;
  }
  if (id.length > MAX_MEDIA_ID_CHARS) {
    return false;
  }
  if (id === "." || id === "..") {
    return false;
  }
  return MEDIA_ID_PATTERN.test(id);
};
export function attachMediaRoutes(app, ttlMs = DEFAULT_TTL_MS, _runtime = defaultRuntime) {
  const mediaDir = getMediaDir();
  app.get("/media/:id", async (req, res) => {
    const id = req.params.id;
    if (!isValidMediaId(id)) {
      res.status(400).send("invalid path");
      return;
    }
    try {
      const { handle, realPath, stat } = await openFileWithinRoot({
        rootDir: mediaDir,
        relativePath: id,
      });
      if (stat.size > MAX_MEDIA_BYTES) {
        await handle.close().catch(() => {});
        res.status(413).send("too large");
        return;
      }
      if (Date.now() - stat.mtimeMs > ttlMs) {
        await handle.close().catch(() => {});
        await fs.rm(realPath).catch(() => {});
        res.status(410).send("expired");
        return;
      }
      const data = await handle.readFile();
      await handle.close().catch(() => {});
      const mime = await detectMime({ buffer: data, filePath: realPath });
      if (mime) {
        res.type(mime);
      }
      res.send(data);
      res.on("finish", () => {
        const cleanup = () => {
          fs.rm(realPath).catch(() => {});
        };
        if (process.env.VITEST || false) {
          queueMicrotask(cleanup);
          return;
        }
        setTimeout(cleanup, 50);
      });
    } catch (err) {
      if (err instanceof SafeOpenError) {
        if (err.code === "invalid-path") {
          res.status(400).send("invalid path");
          return;
        }
        if (err.code === "not-found") {
          res.status(404).send("not found");
          return;
        }
      }
      res.status(404).send("not found");
    }
  });
  setInterval(() => {
    cleanOldMedia(ttlMs);
  }, ttlMs).unref();
}
export async function startMediaServer(port, ttlMs = DEFAULT_TTL_MS, runtime = defaultRuntime) {
  const app = express();
  attachMediaRoutes(app, ttlMs, runtime);
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", (err) => {
      runtime.error(danger(`Media server failed: ${String(err)}`));
      reject(err);
    });
  });
}
