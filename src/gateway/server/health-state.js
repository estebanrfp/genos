import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { getHealthSnapshot } from "../../commands/health.js";
import { CONFIG_PATH, STATE_DIR, loadConfig } from "../../config/config.js";
import { resolveMainSessionKey } from "../../config/sessions.js";
import { listSystemPresence } from "../../infra/system-presence.js";
import { getUpdateAvailable } from "../../infra/update-startup.js";
import { normalizeMainKey } from "../../routing/session-key.js";
import { resolveGatewayAuth } from "../auth.js";
let presenceVersion = 1;
let healthVersion = 1;
let healthCache = null;
let healthRefresh = null;
let broadcastHealthUpdate = null;
export function buildGatewaySnapshot() {
  const cfg = loadConfig();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const mainKey = normalizeMainKey(cfg.session?.mainKey);
  const mainSessionKey = resolveMainSessionKey(cfg);
  const scope = cfg.session?.scope ?? "per-sender";
  const presence = listSystemPresence();
  const uptimeMs = Math.round(process.uptime() * 1000);
  const auth = resolveGatewayAuth({ authConfig: cfg.gateway?.auth, env: process.env });
  const updateAvailable = getUpdateAvailable() ?? undefined;
  const emptyHealth = {};
  return {
    presence,
    health: emptyHealth,
    stateVersion: { presence: presenceVersion, health: healthVersion },
    uptimeMs,
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    sessionDefaults: {
      defaultAgentId,
      mainKey,
      mainSessionKey,
      scope,
    },
    authMode: auth.mode,
    updateAvailable,
    owner: cfg.owner?.displayName ? { displayName: cfg.owner.displayName } : undefined,
  };
}
export function getHealthCache() {
  return healthCache;
}
export function getHealthVersion() {
  return healthVersion;
}
export function incrementPresenceVersion() {
  presenceVersion += 1;
  return presenceVersion;
}
export function getPresenceVersion() {
  return presenceVersion;
}
export function setBroadcastHealthUpdate(fn) {
  broadcastHealthUpdate = fn;
}
export async function refreshGatewayHealthSnapshot(opts) {
  if (!healthRefresh) {
    healthRefresh = (async () => {
      const snap = await getHealthSnapshot({ probe: opts?.probe });
      healthCache = snap;
      healthVersion += 1;
      if (broadcastHealthUpdate) {
        broadcastHealthUpdate(snap);
      }
      return snap;
    })().finally(() => {
      healthRefresh = null;
    });
  }
  return healthRefresh;
}
