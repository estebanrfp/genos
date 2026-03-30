import { authorizeGatewayConnect } from "./auth.js";
import { sendGatewayAuthFailure } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
export async function authorizeGatewayBearerRequestOrReply(params) {
  const token = getBearerToken(params.req);
  const authResult = await authorizeGatewayConnect({
    auth: params.auth,
    connectAuth: token ? { token, password: token } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    rateLimiter: params.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(params.res, authResult);
    return false;
  }
  return true;
}
