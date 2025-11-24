import { connectGateway } from "./app-gateway.js";
import { stopLogsPolling } from "./app-polling.js";
import { observeTopbar, scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.js";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.js";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.js";
import { initPendingCharts } from "./interactive/chart-init.js";
export function handleConnected(host) {
  host.basePath = inferBasePath();
  loadControlUiBootstrapConfig(host);
  applySettingsFromUrl(host);
  syncTabWithLocation(host, true);
  syncThemeWithSettings(host);
  attachThemeListener(host);
  window.addEventListener("popstate", host.popStateHandler);
  connectGateway(host);
}
export function handleFirstUpdated(host) {
  observeTopbar(host);
}
export function handleDisconnected(host) {
  window.removeEventListener("popstate", host.popStateHandler);
  stopLogsPolling(host);
  detachThemeListener(host);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}
export function handleUpdated(host, changed) {
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    scheduleChatScroll(host, forcedByTab || forcedByLoad || !host.chatHasAutoScrolled);
    requestAnimationFrame(initPendingCharts);
  }
  if (
    (host.logsViewQueue ?? []).length > 0 &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("logsViewQueue"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(host, changed.has("logsViewQueue") || changed.has("logsAutoFollow"));
    }
  }
}
