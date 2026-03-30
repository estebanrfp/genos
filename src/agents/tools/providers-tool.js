import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const PROVIDERS_ACTIONS = [
  "list",
  "login",
  "login.status",
  "login.cancel",
  "set",
  // Legacy aliases (backward compat)
  "copilot.login",
  "copilot.login.status",
  "copilot.login.cancel",
];

const ProvidersToolSchema = Type.Object({
  action: stringEnum(PROVIDERS_ACTIONS),
  provider: Type.Optional(Type.String()),
  apiKey: Type.Optional(Type.String()),
  token: Type.Optional(Type.String()),
  profileId: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  // For "set" action (legacy direct set)
  type: Type.Optional(Type.String()),
  value: Type.Optional(Type.String()),
});

/**
 * Check if a provider credential exists in the providers list.
 * @param {object} gatewayOpts
 * @param {string} provider
 * @returns {Promise<{found: boolean, profileId?: string}>}
 */
async function checkProviderInList(gatewayOpts, provider) {
  try {
    const list = await callGatewayTool("providers.list", gatewayOpts, {});
    const profiles = list?.profiles ?? [];
    const match = profiles.find((p) => p.provider === provider);
    if (match) {
      return { found: true, profileId: match.profileId };
    }
  } catch {
    // Best-effort fallback
  }
  return { found: false };
}

/**
 * Create the providers tool — lets the agent manage provider credentials and login flows.
 * @returns {object}
 */
export function createProvidersTool() {
  return {
    label: "Providers",
    name: "providers",
    description: [
      "Manage AI provider credentials.",
      "Actions:",
      "- list: list all configured providers and credentials (masked)",
      "- login: connect a provider. API key providers: { provider, apiKey }. Interactive providers (device flow, OAuth) return a CLI command to run in terminal.",
      "- login.status: check status of an active login session (pass sessionId)",
      "- login.cancel: cancel an active login session (pass sessionId)",
      "- set: directly set a credential (pass provider, type, value, optional profileId)",
      "- copilot.login / copilot.login.status / copilot.login.cancel: legacy aliases for GitHub Copilot device flow",
    ].join("\n"),
    parameters: ProvidersToolSchema,
    execute: async (_toolCallId, args) => {
      const action = readStringParam(args, "action", { required: true });
      const gatewayOpts = {};

      if (action === "list") {
        const result = await callGatewayTool("providers.list", gatewayOpts, {});
        return jsonResult(result);
      }

      // --- Unified login ---
      if (action === "login") {
        const provider = readStringParam(args, "provider", { required: true });
        const apiKey = readStringParam(args, "apiKey");
        const token = readStringParam(args, "token");
        const profileId = readStringParam(args, "profileId");
        const params = {
          provider,
          ...(apiKey ? { apiKey } : {}),
          ...(token ? { token } : {}),
          ...(profileId ? { profileId } : {}),
        };
        const result = await callGatewayTool("providers.login", gatewayOpts, params);
        return jsonResult(result);
      }

      if (action === "login.status") {
        const sessionId = readStringParam(args, "sessionId", { required: true });
        try {
          const result = await callGatewayTool("providers.login.status", gatewayOpts, {
            sessionId,
          });
          return jsonResult(result);
        } catch (err) {
          // Gateway may have restarted — check providers.list as fallback
          const msg = String(err?.message ?? err);
          if (msg.includes("session not found")) {
            const provider = readStringParam(args, "provider");
            if (provider) {
              const check = await checkProviderInList(gatewayOpts, provider);
              if (check.found) {
                return jsonResult({
                  status: "authorized",
                  profileId: check.profileId,
                  note: "session lost after gateway restart, but credential was saved successfully",
                });
              }
            }
          }
          throw err;
        }
      }

      if (action === "login.cancel") {
        const sessionId = readStringParam(args, "sessionId", { required: true });
        const result = await callGatewayTool("providers.login.cancel", gatewayOpts, { sessionId });
        return jsonResult(result);
      }

      // --- Direct set ---
      if (action === "set") {
        const provider = readStringParam(args, "provider", { required: true });
        const type = readStringParam(args, "type") ?? "api_key";
        const value = readStringParam(args, "value", { required: true });
        const profileId = readStringParam(args, "profileId");
        const params = { provider, type, value, ...(profileId ? { profileId } : {}) };
        const result = await callGatewayTool("providers.set", gatewayOpts, params);
        return jsonResult(result);
      }

      // --- Legacy copilot aliases (redirect to unified handlers) ---
      if (action === "copilot.login") {
        const profileId = readStringParam(args, "profileId");
        const params = { provider: "github-copilot", ...(profileId ? { profileId } : {}) };
        const result = await callGatewayTool("providers.copilot.login", gatewayOpts, params);
        return jsonResult(result);
      }

      if (action === "copilot.login.status") {
        const sessionId = readStringParam(args, "sessionId", { required: true });
        try {
          const result = await callGatewayTool("providers.copilot.login.status", gatewayOpts, {
            sessionId,
          });
          return jsonResult(result);
        } catch (err) {
          const msg = String(err?.message ?? err);
          if (msg.includes("session not found")) {
            const check = await checkProviderInList(gatewayOpts, "github-copilot");
            if (check.found) {
              return jsonResult({
                status: "authorized",
                profileId: check.profileId,
                note: "session lost after gateway restart, but credential was saved successfully",
              });
            }
          }
          throw err;
        }
      }

      if (action === "copilot.login.cancel") {
        const sessionId = readStringParam(args, "sessionId", { required: true });
        const result = await callGatewayTool("providers.copilot.login.cancel", gatewayOpts, {
          sessionId,
        });
        return jsonResult(result);
      }

      throw new Error(`Unknown providers action: ${action}`);
    },
  };
}
