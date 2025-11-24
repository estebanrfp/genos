export async function loadMSTeamsSdk() {
  return await import("@microsoft/agents-hosting");
}
export function buildMSTeamsAuthConfig(creds, sdk) {
  return sdk.getAuthConfigWithDefaults({
    clientId: creds.appId,
    clientSecret: creds.appPassword,
    tenantId: creds.tenantId,
  });
}
export function createMSTeamsAdapter(authConfig, sdk) {
  return new sdk.CloudAdapter(authConfig);
}
export async function loadMSTeamsSdkWithAuth(creds) {
  const sdk = await loadMSTeamsSdk();
  const authConfig = buildMSTeamsAuthConfig(creds, sdk);
  return { sdk, authConfig };
}
