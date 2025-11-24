let normalizeProfileAllowlist = function (raw) {
    return Array.isArray(raw) ? raw.map((entry) => entry.trim()).filter(Boolean) : [];
  },
  resolveBrowserProxyConfig = function () {
    const cfg = loadConfig();
    const proxy = cfg.nodeHost?.browserProxy;
    const allowProfiles = normalizeProfileAllowlist(proxy?.allowProfiles);
    const enabled = proxy?.enabled !== false;
    return { enabled, allowProfiles };
  },
  isProfileAllowed = function (params) {
    const { allowProfiles, profile } = params;
    if (!allowProfiles.length) {
      return true;
    }
    if (!profile) {
      return false;
    }
    return allowProfiles.includes(profile.trim());
  },
  collectBrowserProxyPaths = function (payload) {
    const paths = new Set();
    const obj = typeof payload === "object" && payload !== null ? payload : null;
    if (!obj) {
      return [];
    }
    if (typeof obj.path === "string" && obj.path.trim()) {
      paths.add(obj.path.trim());
    }
    if (typeof obj.imagePath === "string" && obj.imagePath.trim()) {
      paths.add(obj.imagePath.trim());
    }
    const download = obj.download;
    if (download && typeof download === "object") {
      const dlPath = download.path;
      if (typeof dlPath === "string" && dlPath.trim()) {
        paths.add(dlPath.trim());
      }
    }
    return [...paths];
  },
  decodeParams = function (raw) {
    if (!raw) {
      throw new Error("INVALID_REQUEST: paramsJSON required");
    }
    return JSON.parse(raw);
  };
import fsPromises from "node:fs/promises";
import { resolveBrowserConfig } from "../browser/config.js";
import {
  createBrowserControlContext,
  startBrowserControlServiceFromConfig,
} from "../browser/control-service.js";
import { createBrowserRouteDispatcher } from "../browser/routes/dispatcher.js";
import { loadConfig } from "../config/config.js";
import { detectMime } from "../media/mime.js";
import { withTimeout } from "./with-timeout.js";
const BROWSER_PROXY_MAX_FILE_BYTES = 10485760;
let browserControlReady = null;
async function ensureBrowserControlService() {
  if (browserControlReady) {
    return browserControlReady;
  }
  browserControlReady = (async () => {
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    if (!resolved.enabled) {
      throw new Error("browser control disabled");
    }
    const started = await startBrowserControlServiceFromConfig();
    if (!started) {
      throw new Error("browser control disabled");
    }
  })();
  return browserControlReady;
}
async function readBrowserProxyFile(filePath) {
  const stat = await fsPromises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return null;
  }
  if (stat.size > BROWSER_PROXY_MAX_FILE_BYTES) {
    throw new Error(
      `browser proxy file exceeds ${Math.round(BROWSER_PROXY_MAX_FILE_BYTES / 1048576)}MB`,
    );
  }
  const buffer = await fsPromises.readFile(filePath);
  const mimeType = await detectMime({ buffer, filePath });
  return { path: filePath, base64: buffer.toString("base64"), mimeType };
}
export async function runBrowserProxyCommand(paramsJSON) {
  const params = decodeParams(paramsJSON);
  const pathValue = typeof params.path === "string" ? params.path.trim() : "";
  if (!pathValue) {
    throw new Error("INVALID_REQUEST: path required");
  }
  const proxyConfig = resolveBrowserProxyConfig();
  if (!proxyConfig.enabled) {
    throw new Error("UNAVAILABLE: node browser proxy disabled");
  }
  await ensureBrowserControlService();
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const requestedProfile = typeof params.profile === "string" ? params.profile.trim() : "";
  const allowedProfiles = proxyConfig.allowProfiles;
  if (allowedProfiles.length > 0) {
    if (pathValue !== "/profiles") {
      const profileToCheck = requestedProfile || resolved.defaultProfile;
      if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: profileToCheck })) {
        throw new Error("INVALID_REQUEST: browser profile not allowed");
      }
    } else if (requestedProfile) {
      if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: requestedProfile })) {
        throw new Error("INVALID_REQUEST: browser profile not allowed");
      }
    }
  }
  const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
  const path = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  const body = params.body;
  const query = {};
  if (requestedProfile) {
    query.profile = requestedProfile;
  }
  const rawQuery = params.query ?? {};
  for (const [key, value] of Object.entries(rawQuery)) {
    if (value === undefined || value === null) {
      continue;
    }
    query[key] = typeof value === "string" ? value : String(value);
  }
  const dispatcher = createBrowserRouteDispatcher(createBrowserControlContext());
  const response = await withTimeout(
    (signal) =>
      dispatcher.dispatch({
        method: method === "DELETE" ? "DELETE" : method === "POST" ? "POST" : "GET",
        path,
        query,
        body,
        signal,
      }),
    params.timeoutMs,
    "browser proxy request",
  );
  if (response.status >= 400) {
    const message =
      response.body && typeof response.body === "object" && "error" in response.body
        ? String(response.body.error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  const result = response.body;
  if (allowedProfiles.length > 0 && path === "/profiles") {
    const obj = typeof result === "object" && result !== null ? result : {};
    const profiles = Array.isArray(obj.profiles) ? obj.profiles : [];
    obj.profiles = profiles.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const name = entry.name;
      return typeof name === "string" && allowedProfiles.includes(name);
    });
  }
  let files;
  const paths = collectBrowserProxyPaths(result);
  if (paths.length > 0) {
    const loaded = await Promise.all(
      paths.map(async (p) => {
        try {
          const file = await readBrowserProxyFile(p);
          if (!file) {
            throw new Error("file not found");
          }
          return file;
        } catch (err) {
          throw new Error(`browser proxy file read failed for ${p}: ${String(err)}`, {
            cause: err,
          });
        }
      }),
    );
    if (loaded.length > 0) {
      files = loaded;
    }
  }
  const payload = files ? { result, files } : { result };
  return JSON.stringify(payload);
}
