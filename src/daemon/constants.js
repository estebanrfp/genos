export const GATEWAY_LAUNCH_AGENT_LABEL = "ai.genos.gateway";
export const GATEWAY_SYSTEMD_SERVICE_NAME = "genosos-gateway";
export const GATEWAY_WINDOWS_TASK_NAME = "GenosOS Gateway";
export const GATEWAY_SERVICE_MARKER = "genosos";
export const GATEWAY_SERVICE_KIND = "gateway";
export const NODE_LAUNCH_AGENT_LABEL = "ai.genos.node";
export const NODE_SYSTEMD_SERVICE_NAME = "genosos-node";
export const NODE_WINDOWS_TASK_NAME = "GenosOS Node";
export const NODE_SERVICE_MARKER = "genosos";
export const NODE_SERVICE_KIND = "node";
export const NODE_WINDOWS_TASK_SCRIPT_NAME = "node.cmd";
export const LEGACY_GATEWAY_LAUNCH_AGENT_LABELS = [];
export const LEGACY_GATEWAY_SYSTEMD_SERVICE_NAMES = [];
export const LEGACY_GATEWAY_WINDOWS_TASK_NAMES = [];
export function normalizeGatewayProfile(profile) {
  const trimmed = profile?.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") {
    return null;
  }
  return trimmed;
}
export function resolveGatewayProfileSuffix(profile) {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `-${normalized}` : "";
}
export function resolveGatewayLaunchAgentLabel(profile) {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.genos.${normalized}`;
}
export function resolveLegacyGatewayLaunchAgentLabels(_profile) {
  return [];
}
export function resolveGatewaySystemdServiceName(profile) {
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) {
    return GATEWAY_SYSTEMD_SERVICE_NAME;
  }
  return `genosos-gateway${suffix}`;
}
export function resolveGatewayWindowsTaskName(profile) {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_WINDOWS_TASK_NAME;
  }
  return `GenosOS Gateway (${normalized})`;
}
export function formatGatewayServiceDescription(params) {
  const profile = normalizeGatewayProfile(params?.profile);
  const version = params?.version?.trim();
  const parts = [];
  if (profile) {
    parts.push(`profile: ${profile}`);
  }
  if (version) {
    parts.push(`v${version}`);
  }
  if (parts.length === 0) {
    return "GenosOS Gateway";
  }
  return `GenosOS Gateway (${parts.join(", ")})`;
}
export function resolveGatewayServiceDescription(params) {
  return (
    params.description ??
    formatGatewayServiceDescription({
      profile: params.env.GENOS_PROFILE,
      version: params.environment?.GENOS_SERVICE_VERSION ?? params.env.GENOS_SERVICE_VERSION,
    })
  );
}
export function resolveNodeLaunchAgentLabel() {
  return NODE_LAUNCH_AGENT_LABEL;
}
export function resolveNodeSystemdServiceName() {
  return NODE_SYSTEMD_SERVICE_NAME;
}
export function resolveNodeWindowsTaskName() {
  return NODE_WINDOWS_TASK_NAME;
}
export function formatNodeServiceDescription(params) {
  const version = params?.version?.trim();
  if (!version) {
    return "GenosOS Node Host";
  }
  return `GenosOS Node Host (v${version})`;
}
