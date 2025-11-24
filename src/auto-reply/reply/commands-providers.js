import { loadAuthProfileStoreFromConfig } from "../../agents/auth-profiles/store.js";
import { PROVIDER_REGISTRY } from "../../gateway/server-methods/providers-login-registry.js";
import { logVerbose } from "../../globals.js";

const FLOW_LABELS = { "api-key": "API key", device: "device flow", "browser-oauth": "OAuth" };

/**
 * Build the /providers reply — shows all available providers from the registry,
 * marking which ones are already connected.
 * @param {object} cfg
 * @returns {{text: string}}
 */
function buildProvidersReply(cfg) {
  const store = loadAuthProfileStoreFromConfig(cfg);
  const connectedProviders = new Set(
    Object.values(store.profiles ?? {})
      .filter((c) => !c.disabled)
      .map((c) => c.provider),
  );

  const entries = Object.entries(PROVIDER_REGISTRY).toSorted((a, b) => a[0].localeCompare(b[0]));

  // Group by flow type
  const byFlow = new Map();
  for (const [name, entry] of entries) {
    const flow = entry.flow ?? "api-key";
    if (!byFlow.has(flow)) {
      byFlow.set(flow, []);
    }
    byFlow.get(flow).push({ name, ...entry });
  }

  const lines = ["Available Providers"];

  for (const [flow, providers] of byFlow) {
    const label = FLOW_LABELS[flow] ?? flow;
    lines.push(`\n${label.toUpperCase()}`);
    for (const p of providers) {
      const connected = connectedProviders.has(p.name);
      const mark = connected ? " [connected]" : "";
      const model = p.defaultModel ? ` — ${p.defaultModel}` : "";
      lines.push(`  ${p.name}${model}${mark}`);
    }
  }

  const total = entries.length;
  const active = connectedProviders.size;
  lines.push("", `${active}/${total} connected`);
  lines.push("Connect: genosos models auth login --provider <id>");

  return { text: lines.join("\n") };
}

/**
 * Handle /providers slash command.
 * @param {object} params
 * @param {boolean} allowTextCommands
 */
export const handleProvidersCommand = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const body = params.command.commandBodyNormalized;
  if (body !== "/providers" && !body.startsWith("/providers ")) {
    return null;
  }

  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /providers from unauthorized sender: ${params.command.senderId}`);
    return { shouldContinue: false };
  }

  const reply = buildProvidersReply(params.cfg);
  return reply ? { reply, shouldContinue: false } : null;
};
