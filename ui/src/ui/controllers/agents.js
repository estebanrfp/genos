import { loadAssistantIdentity } from "./assistant-identity.js";
export async function loadAgents(state) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
      await loadAssistantIdentity(state);
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
    state.requestUpdate();
  }
}
