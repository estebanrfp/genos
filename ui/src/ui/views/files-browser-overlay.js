// GenosOS — Esteban & Nyx
import { html, nothing } from "lit";
import {
  deleteAgentFile,
  loadAgentFileContent,
  loadAgentFiles,
  saveAgentFile,
} from "../controllers/agent-files.js";
import { renderAgentFiles } from "./agents-panels-status-files.js";

/**
 * Render the files browser overlay — workspace files inside a modal.
 * @param {object} state - GenosOSApp instance (host)
 * @returns {import("lit").TemplateResult}
 */
export function renderFilesBrowserOverlay(state) {
  const active = (state.filesBrowserQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const agentId = active.agentId ?? "main";

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          state.dismissFilesBrowser(active.id);
        }
      }}>
      <div class="exec-approval-card files-browser-overlay__card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Workspace Files</div>
            <div class="exec-approval-sub">Agent: ${agentId}</div>
          </div>
        </div>

        <div class="files-browser-overlay__body">
          ${renderAgentFiles({
            agentId,
            agentFilesList: state.agentFilesList,
            agentFilesLoading: state.agentFilesLoading,
            agentFilesError: state.agentFilesError,
            agentFileActive: state.agentFileActive,
            agentFileContents: state.agentFileContents,
            agentFileDrafts: state.agentFileDrafts,
            agentFileSaving: state.agentFileSaving,
            onLoadFiles: (id) => loadAgentFiles(state, id),
            onSelectFile: (name) => {
              state.agentFileActive = name;
              loadAgentFileContent(state, agentId, name);
            },
            onFileDraftChange: (name, content) => {
              state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
            },
            onFileReset: (name) => {
              const base = state.agentFileContents[name] ?? "";
              state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
            },
            onFileSave: (name) => {
              const content = state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
              saveAgentFile(state, agentId, name, content);
            },
            onDeleteFile: (name) => {
              deleteAgentFile(state, agentId, name);
            },
          })}
        </div>

        ${
          state.filesBrowserError
            ? html`<div class="exec-approval-error">${state.filesBrowserError}</div>`
            : nothing
        }

        <div class="exec-approval-actions">
          <button class="btn" @click=${() => loadAgentFiles(state, agentId)}>Refresh</button>
          <button
            class="btn primary"
            ?disabled=${state.filesBrowserBusy}
            @click=${() => state.dismissFilesBrowser(active.id)}
          >Close</button>
        </div>
      </div>
    </div>
  `;
}
