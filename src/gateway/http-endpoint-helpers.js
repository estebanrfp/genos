import { authorizeGatewayBearerRequestOrReply } from "./http-auth-helpers.js";
import { readJsonBodyOrError, sendMethodNotAllowed } from "./http-common.js";
export async function handleGatewayPostJsonEndpoint(req, res, opts) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== opts.pathname) {
    return false;
  }
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return;
  }
  const authorized = await authorizeGatewayBearerRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    rateLimiter: opts.rateLimiter,
  });
  if (!authorized) {
    return;
  }
  const body = await readJsonBodyOrError(req, res, opts.maxBodyBytes);
  if (body === undefined) {
    return;
  }
  return { body };
}
