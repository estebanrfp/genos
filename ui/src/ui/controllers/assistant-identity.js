import { normalizeAssistantIdentity } from "../assistant-identity.js";
export async function loadAssistantIdentity(state, opts) {
  if (!state.client || !state.connected) {
    return;
  }
  const sessionKey = opts?.sessionKey?.trim() || state.sessionKey.trim();
  const params = sessionKey ? { sessionKey } : {};
  try {
    const res = await state.client.request("agent.identity.get", params);
    if (!res) {
      return;
    }
    const normalized = normalizeAssistantIdentity(res);
    state.assistantName = normalized.name;
    state.assistantAvatar = normalized.avatar;
    state.assistantAgentId = normalized.agentId ?? null;
  } catch {}
}
