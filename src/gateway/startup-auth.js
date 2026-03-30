let resolveGatewayAuthFromConfig = function (params) {
    const tailscaleConfig = mergeGatewayTailscaleConfig(
      params.cfg.gateway?.tailscale,
      params.tailscaleOverride,
    );
    return resolveGatewayAuth({
      authConfig: params.cfg.gateway?.auth,
      authOverride: params.authOverride,
      env: params.env,
      tailscaleMode: tailscaleConfig.mode ?? "off",
    });
  },
  shouldPersistGeneratedToken = function (params) {
    if (!params.persistRequested) {
      return false;
    }
    if (params.resolvedAuth.modeSource === "override") {
      return false;
    }
    return true;
  };
import crypto from "node:crypto";
import { writeConfigFile } from "../config/config.js";
import { resolveGatewayAuth } from "./auth.js";
export function mergeGatewayAuthConfig(base, override) {
  const merged = { ...base };
  if (!override) {
    return merged;
  }
  if (override.mode !== undefined) {
    merged.mode = override.mode;
  }
  if (override.token !== undefined) {
    merged.token = override.token;
  }
  if (override.password !== undefined) {
    merged.password = override.password;
  }
  if (override.allowTailscale !== undefined) {
    merged.allowTailscale = override.allowTailscale;
  }
  if (override.rateLimit !== undefined) {
    merged.rateLimit = override.rateLimit;
  }
  if (override.trustedProxy !== undefined) {
    merged.trustedProxy = override.trustedProxy;
  }
  return merged;
}
export function mergeGatewayTailscaleConfig(base, override) {
  const merged = { ...base };
  if (!override) {
    return merged;
  }
  if (override.mode !== undefined) {
    merged.mode = override.mode;
  }
  if (override.resetOnExit !== undefined) {
    merged.resetOnExit = override.resetOnExit;
  }
  return merged;
}
export async function ensureGatewayStartupAuth(params) {
  const env = params.env ?? process.env;
  const persistRequested = params.persist === true;
  const resolved = resolveGatewayAuthFromConfig({
    cfg: params.cfg,
    env,
    authOverride: params.authOverride,
    tailscaleOverride: params.tailscaleOverride,
  });
  if (resolved.mode !== "token" || (resolved.token?.trim().length ?? 0) > 0) {
    return { cfg: params.cfg, auth: resolved, persistedGeneratedToken: false };
  }
  const generatedToken = crypto.randomBytes(24).toString("hex");
  const nextCfg = {
    ...params.cfg,
    gateway: {
      ...params.cfg.gateway,
      auth: {
        ...params.cfg.gateway?.auth,
        mode: "token",
        token: generatedToken,
      },
    },
  };
  const persist = shouldPersistGeneratedToken({
    persistRequested,
    resolvedAuth: resolved,
  });
  if (persist) {
    await writeConfigFile(nextCfg);
  }
  const nextAuth = resolveGatewayAuthFromConfig({
    cfg: nextCfg,
    env,
    authOverride: params.authOverride,
    tailscaleOverride: params.tailscaleOverride,
  });
  return {
    cfg: nextCfg,
    auth: nextAuth,
    generatedToken,
    persistedGeneratedToken: persist,
  };
}
