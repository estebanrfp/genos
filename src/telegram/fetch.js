let applyTelegramNetworkWorkarounds = function (network) {
  const decision = resolveTelegramAutoSelectFamilyDecision({ network });
  if (decision.value === null || decision.value === appliedAutoSelectFamily) {
    return;
  }
  appliedAutoSelectFamily = decision.value;
  if (typeof net.setDefaultAutoSelectFamily === "function") {
    try {
      net.setDefaultAutoSelectFamily(decision.value);
      const label = decision.source ? ` (${decision.source})` : "";
      log.info(`telegram: autoSelectFamily=${decision.value}${label}`);
    } catch {}
  }
};
import * as net from "node:net";
import { resolveFetch } from "../infra/fetch.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveTelegramAutoSelectFamilyDecision } from "./network-config.js";
let appliedAutoSelectFamily = null;
const log = createSubsystemLogger("telegram/network");
export function resolveTelegramFetch(proxyFetch, options) {
  applyTelegramNetworkWorkarounds(options?.network);
  if (proxyFetch) {
    return resolveFetch(proxyFetch);
  }
  const fetchImpl = resolveFetch();
  if (!fetchImpl) {
    throw new Error("fetch is not available; set channels.telegram.proxy in config");
  }
  return fetchImpl;
}
export function resetTelegramFetchStateForTests() {
  appliedAutoSelectFamily = null;
}
