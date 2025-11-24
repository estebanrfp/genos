let gatewayWsLogStyle = "auto";
export function setGatewayWsLogStyle(style) {
  gatewayWsLogStyle = style;
}
export function getGatewayWsLogStyle() {
  return gatewayWsLogStyle;
}
export const DEFAULT_WS_SLOW_MS = 50;

/**
 * Methods silenced from WS logs at all verbosity levels.
 * Used for high-frequency polling methods that would otherwise flood the console.
 */
export const WS_SILENT_METHODS = new Set();
