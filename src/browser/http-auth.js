let firstHeaderValue = function (value) {
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  },
  parseBearerToken = function (authorization) {
    if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
      return;
    }
    const token = authorization.slice(7).trim();
    return token || undefined;
  },
  parseBasicPassword = function (authorization) {
    if (!authorization || !authorization.toLowerCase().startsWith("basic ")) {
      return;
    }
    const encoded = authorization.slice(6).trim();
    if (!encoded) {
      return;
    }
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep < 0) {
        return;
      }
      const password = decoded.slice(sep + 1).trim();
      return password || undefined;
    } catch {
      return;
    }
  };
import { safeEqualSecret } from "../security/secret-equal.js";
export function isAuthorizedBrowserRequest(req, auth) {
  const authorization = firstHeaderValue(req.headers.authorization).trim();
  if (auth.token) {
    const bearer = parseBearerToken(authorization);
    if (bearer && safeEqualSecret(bearer, auth.token)) {
      return true;
    }
  }
  if (auth.password) {
    const passwordHeader = firstHeaderValue(req.headers["x-genosos-password"]).trim();
    if (passwordHeader && safeEqualSecret(passwordHeader, auth.password)) {
      return true;
    }
    const basicPassword = parseBasicPassword(authorization);
    if (basicPassword && safeEqualSecret(basicPassword, auth.password)) {
      return true;
    }
  }
  return false;
}
