import { loadLogs } from "./controllers/logs.js";
export function startLogsPolling(host) {
  if (host.logsPollInterval != null) {
    return;
  }
  host.logsPollInterval = window.setInterval(() => {
    if ((host.logsViewQueue ?? []).length === 0) {
      return;
    }
    loadLogs(host, { quiet: true });
  }, 2000);
}
export function stopLogsPolling(host) {
  if (host.logsPollInterval == null) {
    return;
  }
  clearInterval(host.logsPollInterval);
  host.logsPollInterval = null;
}
