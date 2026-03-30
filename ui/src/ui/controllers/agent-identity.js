export async function loadAgentIdentity(state, agentId) {
  if (!state.client || !state.connected || state.agentIdentityLoading) {
    return;
  }
  if (state.agentIdentityById[agentId]) {
    return;
  }
  state.agentIdentityLoading = true;
  state.agentIdentityError = null;
  try {
    const res = await state.client.request("agent.identity.get", {
      agentId,
    });
    if (res) {
      state.agentIdentityById = { ...state.agentIdentityById, [agentId]: res };
    }
  } catch (err) {
    state.agentIdentityError = String(err);
  } finally {
    state.agentIdentityLoading = false;
  }
}
export async function loadAgentIdentities(state, agentIds) {
  if (!state.client || !state.connected || state.agentIdentityLoading) {
    return;
  }
  const missing = agentIds.filter((id) => !state.agentIdentityById[id]);
  if (missing.length === 0) {
    return;
  }
  state.agentIdentityLoading = true;
  state.agentIdentityError = null;
  try {
    for (const agentId of missing) {
      const res = await state.client.request("agent.identity.get", {
        agentId,
      });
      if (res) {
        state.agentIdentityById = { ...state.agentIdentityById, [agentId]: res };
      }
    }
  } catch (err) {
    state.agentIdentityError = String(err);
  } finally {
    state.agentIdentityLoading = false;
  }
}
