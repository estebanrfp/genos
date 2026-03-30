import { authenticateWithWebAuthn, hasRegisteredCredentials } from "../views/webauthn-panel.js";
let mergeFileEntry = function (list, entry) {
  if (!list) {
    return list;
  }
  const idx = list.files.findIndex((file) => file.name === entry.name);
  const nextFiles =
    idx >= 0
      ? // Preserve fields from the existing entry (e.g. section, editable) that agents.files.get doesn't return
        list.files.map((file, i) => (i === idx ? { ...file, ...entry } : file))
      : [...list.files, entry];
  return { ...list, files: nextFiles };
};
export async function loadAgentFiles(state, agentId) {
  if (!state.client || !state.connected || state.agentFilesLoading) {
    return;
  }
  state.agentFilesLoading = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request("agents.files.list", {
      agentId,
    });
    if (res) {
      state.agentFilesList = res;
      if (state.agentFileActive && !res.files.some((file) => file.name === state.agentFileActive)) {
        state.agentFileActive = null;
      }
    }
  } catch (err) {
    state.agentFilesError = String(err);
  } finally {
    state.agentFilesLoading = false;
  }
}
export async function loadAgentFileContent(state, agentId, name, opts) {
  if (!state.client || !state.connected || state.agentFilesLoading) {
    return;
  }
  if (!opts?.force && Object.hasOwn(state.agentFileContents, name)) {
    return;
  }
  state.agentFilesLoading = true;
  state.agentFilesError = null;
  try {
    const res = await state.client.request("agents.files.get", {
      agentId,
      name,
    });
    if (res?.file) {
      const content = res.file.content ?? "";
      const previousBase = state.agentFileContents[name] ?? "";
      const currentDraft = state.agentFileDrafts[name];
      const preserveDraft = opts?.preserveDraft ?? true;
      state.agentFilesList = mergeFileEntry(state.agentFilesList, res.file);
      state.agentFileContents = { ...state.agentFileContents, [name]: content };
      if (
        !preserveDraft ||
        !Object.hasOwn(state.agentFileDrafts, name) ||
        currentDraft === previousBase
      ) {
        state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
      }
    }
  } catch (err) {
    state.agentFilesError = String(err);
  } finally {
    state.agentFilesLoading = false;
  }
}
export async function deleteAgentFile(state, agentId, name) {
  if (!state.client || !state.connected) {
    return;
  }
  state.agentFilesError = null;
  try {
    await state.client.request("agents.files.delete", { agentId, name });
    if (state.agentFilesList) {
      state.agentFilesList = {
        ...state.agentFilesList,
        files: state.agentFilesList.files.filter((f) => f.name !== name),
      };
    }
    if (state.agentFileActive === name) {
      state.agentFileActive = null;
    }
    const { [name]: _c, ...restContents } = state.agentFileContents;
    const { [name]: _d, ...restDrafts } = state.agentFileDrafts;
    state.agentFileContents = restContents;
    state.agentFileDrafts = restDrafts;
  } catch (err) {
    state.agentFilesError = String(err);
  }
}
export async function saveAgentFile(state, agentId, name, content) {
  if (!state.client || !state.connected || state.agentFileSaving) {
    return;
  }
  state.agentFileSaving = true;
  state.agentFilesError = null;
  try {
    // WebAuthn auth gate — require Touch ID if credentials are registered
    if (hasRegisteredCredentials()) {
      const sessionToken = await authenticateWithWebAuthn();
      if (!sessionToken) {
        state.agentFilesError = "Touch ID authentication required to save files.";
        return;
      }
    }
    const res = await state.client.request("agents.files.set", {
      agentId,
      name,
      content,
    });
    if (res?.file) {
      state.agentFilesList = mergeFileEntry(state.agentFilesList, res.file);
      state.agentFileContents = { ...state.agentFileContents, [name]: content };
      state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
    }
  } catch (err) {
    state.agentFilesError = String(err);
  } finally {
    state.agentFileSaving = false;
  }
}
