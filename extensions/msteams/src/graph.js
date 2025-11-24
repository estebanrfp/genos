let readAccessToken = function (value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const token = value.accessToken ?? value.token;
    return typeof token === "string" ? token : null;
  }
  return null;
};
import { GRAPH_ROOT } from "./attachments/shared.js";
import { loadMSTeamsSdkWithAuth } from "./sdk.js";
import { resolveMSTeamsCredentials } from "./token.js";
export function normalizeQuery(value) {
  return value?.trim() ?? "";
}
export function escapeOData(value) {
  return value.replace(/'/g, "''");
}
export async function fetchGraphJson(params) {
  const res = await fetch(`${GRAPH_ROOT}${params.path}`, {
    headers: {
      Authorization: `Bearer ${params.token}`,
      ...params.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph ${params.path} failed (${res.status}): ${text || "unknown error"}`);
  }
  return await res.json();
}
export async function resolveGraphToken(cfg) {
  const creds = resolveMSTeamsCredentials(cfg?.channels?.msteams);
  if (!creds) {
    throw new Error("MS Teams credentials missing");
  }
  const { sdk, authConfig } = await loadMSTeamsSdkWithAuth(creds);
  const tokenProvider = new sdk.MsalTokenProvider(authConfig);
  const token = await tokenProvider.getAccessToken("https://graph.microsoft.com");
  const accessToken = readAccessToken(token);
  if (!accessToken) {
    throw new Error("MS Teams graph token unavailable");
  }
  return accessToken;
}
export async function listTeamsByName(token, query) {
  const escaped = escapeOData(query);
  const filter = `resourceProvisioningOptions/Any(x:x eq 'Team') and startsWith(displayName,'${escaped}')`;
  const path = `/groups?\$filter=${encodeURIComponent(filter)}&\$select=id,displayName`;
  const res = await fetchGraphJson({ token, path });
  return res.value ?? [];
}
export async function listChannelsForTeam(token, teamId) {
  const path = `/teams/${encodeURIComponent(teamId)}/channels?\$select=id,displayName`;
  const res = await fetchGraphJson({ token, path });
  return res.value ?? [];
}
