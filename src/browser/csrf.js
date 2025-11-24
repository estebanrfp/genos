let firstHeader = function (value) {
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  },
  isMutatingMethod = function (method) {
    const m = (method || "").trim().toUpperCase();
    return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
  },
  isLoopbackUrl = function (value) {
    const v = value.trim();
    if (!v || v === "null") {
      return false;
    }
    try {
      const parsed = new URL(v);
      return isLoopbackHost(parsed.hostname);
    } catch {
      return false;
    }
  };
import { isLoopbackHost } from "../gateway/net.js";
export function shouldRejectBrowserMutation(params) {
  if (!isMutatingMethod(params.method)) {
    return false;
  }
  const secFetchSite = (params.secFetchSite ?? "").trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return true;
  }
  const origin = (params.origin ?? "").trim();
  if (origin) {
    return !isLoopbackUrl(origin);
  }
  const referer = (params.referer ?? "").trim();
  if (referer) {
    return !isLoopbackUrl(referer);
  }
  return false;
}
export function browserMutationGuardMiddleware() {
  return (req, res, next) => {
    const method = (req.method || "").trim().toUpperCase();
    if (method === "OPTIONS") {
      return next();
    }
    const origin = firstHeader(req.headers.origin);
    const referer = firstHeader(req.headers.referer);
    const secFetchSite = firstHeader(req.headers["sec-fetch-site"]);
    if (
      shouldRejectBrowserMutation({
        method,
        origin,
        referer,
        secFetchSite,
      })
    ) {
      res.status(403).send("Forbidden");
      return;
    }
    next();
  };
}
