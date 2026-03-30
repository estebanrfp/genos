let sanitizeFilename = function (name) {
    const trimmed = name.trim();
    if (!trimmed) {
      return "";
    }
    const sanitized = trimmed.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    return sanitized.replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
  },
  looksLikeUrl = function (src) {
    return /^https?:\/\//i.test(src);
  };
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { resolvePinnedHostname } from "../infra/net/ssrf.js";
import { resolveConfigDir } from "../utils.js";
import { detectMime, extensionForMime } from "./mime.js";
const resolveMediaDir = () => path.join(resolveConfigDir(), "media");
export const MEDIA_MAX_BYTES = 5242880;
const MAX_BYTES = MEDIA_MAX_BYTES;
const DEFAULT_TTL_MS = 120000;
const defaultHttpRequestImpl = httpRequest;
const defaultHttpsRequestImpl = httpsRequest;
const defaultResolvePinnedHostnameImpl = resolvePinnedHostname;
const isNodeError = (err) => Boolean(err && typeof err === "object" && "code" in err);
const isSymlinkOpenError = (err) =>
  isNodeError(err) && (err.code === "ELOOP" || err.code === "EINVAL" || err.code === "ENOTSUP");
let httpRequestImpl = defaultHttpRequestImpl;
let httpsRequestImpl = defaultHttpsRequestImpl;
let resolvePinnedHostnameImpl = defaultResolvePinnedHostnameImpl;
export function setMediaStoreNetworkDepsForTest(deps) {
  httpRequestImpl = deps?.httpRequest ?? defaultHttpRequestImpl;
  httpsRequestImpl = deps?.httpsRequest ?? defaultHttpsRequestImpl;
  resolvePinnedHostnameImpl = deps?.resolvePinnedHostname ?? defaultResolvePinnedHostnameImpl;
}
export function extractOriginalFilename(filePath) {
  const basename = path.basename(filePath);
  if (!basename) {
    return "file.bin";
  }
  const ext = path.extname(basename);
  const nameWithoutExt = path.basename(basename, ext);
  const match = nameWithoutExt.match(
    /^(.+)---[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
  if (match?.[1]) {
    return `${match[1]}${ext}`;
  }
  return basename;
}
export function getMediaDir() {
  return resolveMediaDir();
}
export async function ensureMediaDir() {
  const mediaDir = resolveMediaDir();
  await fs.mkdir(mediaDir, { recursive: true, mode: 448 });
  return mediaDir;
}
export async function cleanOldMedia(ttlMs = DEFAULT_TTL_MS) {
  const mediaDir = await ensureMediaDir();
  const entries = await fs.readdir(mediaDir).catch(() => []);
  const now = Date.now();
  const removeExpiredFilesInDir = async (dir) => {
    const dirEntries = await fs.readdir(dir).catch(() => []);
    await Promise.all(
      dirEntries.map(async (entry) => {
        const full = path.join(dir, entry);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat || !stat.isFile()) {
          return;
        }
        if (now - stat.mtimeMs > ttlMs) {
          await fs.rm(full).catch(() => {});
        }
      }),
    );
  };
  await Promise.all(
    entries.map(async (file) => {
      const full = path.join(mediaDir, file);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) {
        return;
      }
      if (stat.isDirectory()) {
        await removeExpiredFilesInDir(full);
        return;
      }
      if (stat.isFile() && now - stat.mtimeMs > ttlMs) {
        await fs.rm(full).catch(() => {});
      }
    }),
  );
}
async function downloadToFile(url, dest, headers, maxRedirects = 5) {
  return await new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error("Invalid URL"));
      return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      reject(new Error(`Invalid URL protocol: ${parsedUrl.protocol}. Only HTTP/HTTPS allowed.`));
      return;
    }
    const requestImpl = parsedUrl.protocol === "https:" ? httpsRequestImpl : httpRequestImpl;
    resolvePinnedHostnameImpl(parsedUrl.hostname)
      .then((pinned) => {
        const req = requestImpl(parsedUrl, { headers, lookup: pinned.lookup }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            const location = res.headers.location;
            if (!location || maxRedirects <= 0) {
              reject(new Error(`Redirect loop or missing Location header`));
              return;
            }
            const redirectUrl = new URL(location, url).href;
            resolve(downloadToFile(redirectUrl, dest, headers, maxRedirects - 1));
            return;
          }
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode ?? "?"} downloading media`));
            return;
          }
          let total = 0;
          const sniffChunks = [];
          let sniffLen = 0;
          const out = createWriteStream(dest, { mode: 384 });
          res.on("data", (chunk) => {
            total += chunk.length;
            if (sniffLen < 16384) {
              sniffChunks.push(chunk);
              sniffLen += chunk.length;
            }
            if (total > MAX_BYTES) {
              req.destroy(new Error("Media exceeds 5MB limit"));
            }
          });
          pipeline(res, out)
            .then(() => {
              const sniffBuffer = Buffer.concat(sniffChunks, Math.min(sniffLen, 16384));
              const rawHeader = res.headers["content-type"];
              const headerMime = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
              resolve({
                headerMime,
                sniffBuffer,
                size: total,
              });
            })
            .catch(reject);
        });
        req.on("error", reject);
        req.end();
      })
      .catch(reject);
  });
}
export async function saveMediaSource(source, headers, subdir = "") {
  const baseDir = resolveMediaDir();
  const dir = subdir ? path.join(baseDir, subdir) : baseDir;
  await fs.mkdir(dir, { recursive: true, mode: 448 });
  await cleanOldMedia();
  const baseId = crypto.randomUUID();
  if (looksLikeUrl(source)) {
    const tempDest = path.join(dir, `${baseId}.tmp`);
    const { headerMime, sniffBuffer, size } = await downloadToFile(source, tempDest, headers);
    const mime = await detectMime({
      buffer: sniffBuffer,
      headerMime,
      filePath: source,
    });
    const ext = extensionForMime(mime) ?? path.extname(new URL(source).pathname);
    const id = ext ? `${baseId}${ext}` : baseId;
    const finalDest = path.join(dir, id);
    await fs.rename(tempDest, finalDest);
    return { id, path: finalDest, size, contentType: mime };
  }
  const supportsNoFollow = process.platform !== "win32" && "O_NOFOLLOW" in fsConstants;
  const flags = fsConstants.O_RDONLY | (supportsNoFollow ? fsConstants.O_NOFOLLOW : 0);
  let handle;
  try {
    handle = await fs.open(source, flags);
  } catch (err) {
    if (isSymlinkOpenError(err)) {
      throw new Error("Media path must not be a symlink", { cause: err });
    }
    throw err;
  }
  try {
    const [stat, lstat] = await Promise.all([handle.stat(), fs.lstat(source)]);
    if (lstat.isSymbolicLink()) {
      throw new Error("Media path must not be a symlink");
    }
    if (!stat.isFile()) {
      throw new Error("Media path is not a file");
    }
    if (stat.ino !== lstat.ino || stat.dev !== lstat.dev) {
      throw new Error("Media path changed during read");
    }
    if (stat.size > MAX_BYTES) {
      throw new Error("Media exceeds 5MB limit");
    }
    const buffer = await handle.readFile();
    const mime = await detectMime({ buffer, filePath: source });
    const ext = extensionForMime(mime) ?? path.extname(source);
    const id = ext ? `${baseId}${ext}` : baseId;
    const dest = path.join(dir, id);
    await fs.writeFile(dest, buffer, { mode: 384 });
    return { id, path: dest, size: stat.size, contentType: mime };
  } finally {
    await handle.close().catch(() => {});
  }
}
export async function saveMediaBuffer(
  buffer,
  contentType,
  subdir = "inbound",
  maxBytes = MAX_BYTES,
  originalFilename,
) {
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Media exceeds ${(maxBytes / 1048576).toFixed(0)}MB limit`);
  }
  const dir = path.join(resolveMediaDir(), subdir);
  await fs.mkdir(dir, { recursive: true, mode: 448 });
  const uuid = crypto.randomUUID();
  const headerExt = extensionForMime(contentType?.split(";")[0]?.trim() ?? undefined);
  const mime = await detectMime({ buffer, headerMime: contentType });
  const ext = headerExt ?? extensionForMime(mime) ?? "";
  let id;
  if (originalFilename) {
    const base = path.parse(originalFilename).name;
    const sanitized = sanitizeFilename(base);
    id = sanitized ? `${sanitized}---${uuid}${ext}` : `${uuid}${ext}`;
  } else {
    id = ext ? `${uuid}${ext}` : uuid;
  }
  const dest = path.join(dir, id);
  await fs.writeFile(dest, buffer, { mode: 384 });
  return { id, path: dest, size: buffer.byteLength, contentType: mime };
}
