let contentTypeForExt = function (ext) {
    switch (ext) {
      case ".html":
        return "text/html; charset=utf-8";
      case ".js":
        return "application/javascript; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".json":
      case ".map":
        return "application/json; charset=utf-8";
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".webp":
        return "image/webp";
      case ".ico":
        return "image/x-icon";
      case ".txt":
        return "text/plain; charset=utf-8";
      case ".mp3":
        return "audio/mpeg";
      case ".opus":
        return "audio/ogg; codecs=opus";
      case ".ogg":
        return "audio/ogg";
      case ".wav":
        return "audio/wav";
      case ".m4a":
        return "audio/mp4";
      default:
        return "application/octet-stream";
    }
  },
  applyControlUiSecurityHeaders = function (res) {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", buildControlUiCspHeader());
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  },
  sendJson = function (res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(JSON.stringify(body));
  },
  isValidAgentId = function (agentId) {
    return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(agentId);
  },
  respondNotFound = function (res) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
  },
  serveFile = function (res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", contentTypeForExt(ext));
    res.setHeader("Cache-Control", "no-cache");
    res.end(fs.readFileSync(filePath));
  },
  serveIndexHtml = function (res, indexPath) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(fs.readFileSync(indexPath, "utf8"));
  },
  isSafeRelativePath = function (relPath) {
    if (!relPath) {
      return false;
    }
    const normalized = path.posix.normalize(relPath);
    if (normalized.startsWith("../") || normalized === "..") {
      return false;
    }
    if (normalized.includes("\0")) {
      return false;
    }
    return true;
  };
import fs from "node:fs";
import path from "node:path";
import { resolveControlUiRootSync } from "../infra/control-ui-assets.js";
import { CONFIG_DIR } from "../utils.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "./control-ui-contract.js";
import { buildControlUiCspHeader } from "./control-ui-csp.js";
import {
  buildControlUiAvatarUrl,
  CONTROL_UI_AVATAR_PREFIX,
  normalizeControlUiBasePath,
  resolveAssistantAvatarUrl,
} from "./control-ui-shared.js";
const ROOT_PREFIX = "/";
export function handleControlUiAvatarRequest(req, res, opts) {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts.basePath);
  const pathname = url.pathname;
  const pathWithBase = basePath
    ? `${basePath}${CONTROL_UI_AVATAR_PREFIX}/`
    : `${CONTROL_UI_AVATAR_PREFIX}/`;
  if (!pathname.startsWith(pathWithBase)) {
    return false;
  }
  applyControlUiSecurityHeaders(res);
  const agentIdParts = pathname.slice(pathWithBase.length).split("/").filter(Boolean);
  const agentId = agentIdParts[0] ?? "";
  if (agentIdParts.length !== 1 || !agentId || !isValidAgentId(agentId)) {
    respondNotFound(res);
    return true;
  }
  if (url.searchParams.get("meta") === "1") {
    const resolved = opts.resolveAvatar(agentId);
    const avatarUrl =
      resolved.kind === "local"
        ? buildControlUiAvatarUrl(basePath, agentId)
        : resolved.kind === "remote" || resolved.kind === "data"
          ? resolved.url
          : null;
    sendJson(res, 200, { avatarUrl });
    return true;
  }
  const resolved = opts.resolveAvatar(agentId);
  if (resolved.kind !== "local") {
    respondNotFound(res);
    return true;
  }
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypeForExt(path.extname(resolved.filePath).toLowerCase()));
    res.setHeader("Cache-Control", "no-cache");
    res.end();
    return true;
  }
  serveFile(res, resolved.filePath);
  return true;
}
const MEDIA_DIR = path.join(CONFIG_DIR, "media");
const MEDIA_PREFIX = "/_media/";
/**
 * Serve audio files from ~/.genosv1/media/ and handle DELETE for cleanup.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {boolean}
 */
export function handleControlUiMediaRequest(req, res) {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  if (!url.pathname.startsWith(MEDIA_PREFIX)) {
    return false;
  }
  const fileName = decodeURIComponent(url.pathname.slice(MEDIA_PREFIX.length));
  if (!fileName || fileName.includes("/") || fileName.includes("..") || fileName.includes("\0")) {
    respondNotFound(res);
    return true;
  }
  const filePath = path.join(MEDIA_DIR, fileName);
  if (!filePath.startsWith(MEDIA_DIR)) {
    respondNotFound(res);
    return true;
  }
  applyControlUiSecurityHeaders(res);
  if (req.method === "DELETE") {
    try {
      fs.unlinkSync(filePath);
      sendJson(res, 200, { ok: true });
    } catch {
      respondNotFound(res);
    }
    return true;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    respondNotFound(res);
    return true;
  }
  // Support Range requests for audio seek
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = contentTypeForExt(ext);
  const range = req.headers.range;
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      res.statusCode = 206;
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + stat.size);
      res.setHeader("Content-Length", end - start + 1);
      res.setHeader("Accept-Ranges", "bytes");
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return true;
    }
  }
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(filePath).pipe(res);
  return true;
}
export function handleControlUiHttpRequest(req, res, opts) {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }
  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts?.basePath);
  const pathname = url.pathname;
  if (!basePath) {
    if (pathname === "/ui" || pathname.startsWith("/ui/")) {
      applyControlUiSecurityHeaders(res);
      respondNotFound(res);
      return true;
    }
  }
  if (basePath) {
    if (pathname === basePath) {
      applyControlUiSecurityHeaders(res);
      res.statusCode = 302;
      res.setHeader("Location", `${basePath}/${url.search}`);
      res.end();
      return true;
    }
    if (!pathname.startsWith(`${basePath}/`)) {
      return false;
    }
  }
  applyControlUiSecurityHeaders(res);
  const bootstrapConfigPath = basePath
    ? `${basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
    : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;
  if (pathname === bootstrapConfigPath) {
    const config = opts?.config;
    const identity = config
      ? resolveAssistantIdentity({ cfg: config, agentId: opts?.agentId })
      : DEFAULT_ASSISTANT_IDENTITY;
    const avatarValue = resolveAssistantAvatarUrl({
      avatar: identity.avatar,
      agentId: identity.agentId,
      basePath,
    });
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end();
      return true;
    }
    sendJson(res, 200, {
      basePath,
      assistantName: identity.name,
      assistantAvatar: avatarValue ?? identity.avatar,
      assistantAgentId: identity.agentId,
    });
    return true;
  }
  const rootState = opts?.root;
  if (rootState?.kind === "invalid") {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      `Control UI assets not found at ${rootState.path}. Build them with \`pnpm ui:build\` (auto-installs UI deps), or update gateway.controlUi.root.`,
    );
    return true;
  }
  if (rootState?.kind === "missing") {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      "Control UI assets not found. Build them with `pnpm ui:build` (auto-installs UI deps), or run `pnpm ui:dev` during development.",
    );
    return true;
  }
  const root =
    rootState?.kind === "resolved"
      ? rootState.path
      : resolveControlUiRootSync({
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        });
  if (!root) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      "Control UI assets not found. Build them with `pnpm ui:build` (auto-installs UI deps), or run `pnpm ui:dev` during development.",
    );
    return true;
  }
  const uiPath =
    basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
  const rel = (() => {
    if (uiPath === ROOT_PREFIX) {
      return "";
    }
    const assetsIndex = uiPath.indexOf("/assets/");
    if (assetsIndex >= 0) {
      return uiPath.slice(assetsIndex + 1);
    }
    return uiPath.slice(1);
  })();
  const requested = rel && !rel.endsWith("/") ? rel : `${rel}index.html`;
  const fileRel = requested || "index.html";
  if (!isSafeRelativePath(fileRel)) {
    respondNotFound(res);
    return true;
  }
  const filePath = path.join(root, fileRel);
  if (!filePath.startsWith(root)) {
    respondNotFound(res);
    return true;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (path.basename(filePath) === "index.html") {
      serveIndexHtml(res, filePath);
      return true;
    }
    serveFile(res, filePath);
    return true;
  }
  const indexPath = path.join(root, "index.html");
  if (fs.existsSync(indexPath)) {
    serveIndexHtml(res, indexPath);
    return true;
  }
  respondNotFound(res);
  return true;
}
