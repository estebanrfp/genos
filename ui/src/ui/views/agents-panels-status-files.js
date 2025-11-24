let renderAgentContextCard = function (context, subtitle) {
    return html`
    <section class="card">
      <div class="card-title">Agent Context</div>
      <div class="card-sub">${subtitle}</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${context.workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${context.model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Name</div>
          <div>${context.identityName}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Emoji</div>
          <div>${context.identityEmoji}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${context.skillsLabel}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${context.isDefault ? "yes" : "no"}</div>
        </div>
      </div>
    </section>
  `;
  },
  resolveChannelLabel = function (snapshot, id) {
    const meta = snapshot.channelMeta?.find((entry) => entry.id === id);
    if (meta?.label) {
      return meta.label;
    }
    return snapshot.channelLabels?.[id] ?? id;
  },
  resolveChannelEntries = function (snapshot) {
    if (!snapshot) {
      return [];
    }
    const ids = new Set();
    for (const id of snapshot.channelOrder ?? []) {
      ids.add(id);
    }
    for (const entry of snapshot.channelMeta ?? []) {
      ids.add(entry.id);
    }
    for (const id of Object.keys(snapshot.channelAccounts ?? {})) {
      ids.add(id);
    }
    const ordered = [];
    const seed = snapshot.channelOrder?.length ? snapshot.channelOrder : Array.from(ids);
    for (const id of seed) {
      if (!ids.has(id)) {
        continue;
      }
      ordered.push(id);
      ids.delete(id);
    }
    for (const id of ids) {
      ordered.push(id);
    }
    return ordered.map((id) => ({
      id,
      label: resolveChannelLabel(snapshot, id),
      accounts: snapshot.channelAccounts?.[id] ?? [],
    }));
  },
  resolveChannelConfigValue = function (configForm, channelId) {
    if (!configForm) {
      return null;
    }
    const channels = configForm.channels ?? {};
    const fromChannels = channels[channelId];
    if (fromChannels && typeof fromChannels === "object") {
      return fromChannels;
    }
    const fallback = configForm[channelId];
    if (fallback && typeof fallback === "object") {
      return fallback;
    }
    return null;
  },
  formatChannelExtraValue = function (raw) {
    if (raw == null) {
      return "n/a";
    }
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      return String(raw);
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return "n/a";
    }
  },
  resolveChannelExtras = function (configForm, channelId) {
    const value = resolveChannelConfigValue(configForm, channelId);
    if (!value) {
      return [];
    }
    return CHANNEL_EXTRA_FIELDS.flatMap((field) => {
      if (!(field in value)) {
        return [];
      }
      return [{ label: field, value: formatChannelExtraValue(value[field]) }];
    });
  },
  summarizeChannelAccounts = function (accounts) {
    let connected = 0;
    let configured = 0;
    let enabled = 0;
    for (const account of accounts) {
      const probeOk =
        account.probe && typeof account.probe === "object" && "ok" in account.probe
          ? Boolean(account.probe.ok)
          : false;
      const isConnected = account.connected === true || account.running === true || probeOk;
      if (isConnected) {
        connected += 1;
      }
      if (account.configured) {
        configured += 1;
      }
      if (account.enabled) {
        enabled += 1;
      }
    }
    return {
      total: accounts.length,
      connected,
      configured,
      enabled,
    };
  },
  SECTION_LABELS = { core: "Core Files", memory: "Memory", docs: "Docs" },
  /** Build nested tree from flat file list. prefix = section key to strip (null for core). */
  buildFileTree = function (files, prefix) {
    const root = new Map();
    for (const file of files) {
      const rel = prefix ? file.name.slice(prefix.length + 1) : file.name;
      const parts = rel.split("/");
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cur.has(p)) {
          cur.set(p, { type: "dir", children: new Map() });
        }
        cur = cur.get(p).children;
      }
      cur.set(parts.at(-1), { type: "file", file });
    }
    return root;
  },
  countTreeFiles = function (nodeMap) {
    let n = 0;
    for (const node of nodeMap.values()) {
      n += node.type === "file" ? 1 : countTreeFiles(node.children);
    }
    return n;
  },
  renderFileTree = function (nodeMap, depth, active, onSelect) {
    return [...nodeMap.entries()].map(([name, node]) => {
      if (node.type === "dir") {
        const inner = html`
          <summary class="agent-dir-summary">
            <span class="agent-dir-label">${name.toUpperCase()} (${countTreeFiles(node.children)})</span>
          </summary>
          <div class="agent-dir-body">
            ${renderFileTree(node.children, depth + 1, active, onSelect)}
          </div>
        `;
        // Two separate templates: Lit won't touch the `open` attribute when not bound,
        // so user-toggled state persists across re-renders.
        return depth === 0
          ? html`<details class="agent-dir-node" open>${inner}</details>`
          : html`<details class="agent-dir-node">${inner}</details>`;
      }
      const { file } = node;
      const isActive = active === file.name;
      return html`
        <div
          class="agent-file-row ${isActive ? "active" : ""} ${file.missing ? "missing" : ""}"
          @click=${() => onSelect(file.name)}
        >
          <div class="agent-file-row-info">
            <span class="agent-file-row-name mono">${name}</span>
            ${
              file.missing
                ? html`
                    <span class="agent-pill warn">missing</span>
                  `
                : nothing
            }
          </div>
          <div class="agent-file-row-actions"></div>
        </div>
      `;
    });
  };
import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.js";
import {
  formatCronPayload,
  formatCronSchedule,
  formatCronState,
  formatNextRun,
} from "../presenter.js";

/** Convert a base64 data URL to a blob URL for use in iframes (avoids object-src CSP). */
function pdfBlobUrl(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}
const CHANNEL_EXTRA_FIELDS = ["groupPolicy", "streamMode", "dmPolicy"];
export function renderAgentChannels(params) {
  const entries = resolveChannelEntries(params.snapshot);
  const lastSuccessLabel = params.lastSuccess
    ? formatRelativeTimestamp(params.lastSuccess)
    : "never";
  return html`
    <section class="grid grid-cols-2">
      ${renderAgentContextCard(params.context, "Workspace, identity, and model configuration.")}
      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Channels</div>
            <div class="card-sub">Gateway-wide channel status snapshot.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Refreshing\u2026" : "Refresh"}
          </button>
        </div>
        <div class="muted" style="margin-top: 8px;">
          Last refresh: ${lastSuccessLabel}
        </div>
        ${params.error ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>` : nothing}
        ${
          !params.snapshot
            ? html`
                <div class="callout info" style="margin-top: 12px">Load channels to see live status.</div>
              `
            : nothing
        }
        ${
          entries.length === 0
            ? html`
                <div class="muted" style="margin-top: 16px">No channels found.</div>
              `
            : html`
                <div class="list" style="margin-top: 16px;">
                  ${entries.map((entry) => {
                    const summary = summarizeChannelAccounts(entry.accounts);
                    const status = summary.total
                      ? `${summary.connected}/${summary.total} connected`
                      : "no accounts";
                    const config = summary.configured
                      ? `${summary.configured} configured`
                      : "not configured";
                    const enabled = summary.total ? `${summary.enabled} enabled` : "disabled";
                    const extras = resolveChannelExtras(params.configForm, entry.id);
                    return html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${entry.label}</div>
                          <div class="list-sub mono">${entry.id}</div>
                        </div>
                        <div class="list-meta">
                          <div>${status}</div>
                          <div>${config}</div>
                          <div>${enabled}</div>
                          ${extras.length > 0 ? extras.map((extra) => html`<div>${extra.label}: ${extra.value}</div>`) : nothing}
                        </div>
                      </div>
                    `;
                  })}
                </div>
              `
        }
      </section>
    </section>
  `;
}
export function renderAgentCron(params) {
  const jobs = params.jobs.filter((job) => job.agentId === params.agentId);
  return html`
    <section class="grid grid-cols-2">
      ${renderAgentContextCard(params.context, "Workspace and scheduling targets.")}
      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Scheduler</div>
            <div class="card-sub">Gateway cron status.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Refreshing\u2026" : "Refresh"}
          </button>
        </div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Enabled</div>
            <div class="stat-value">
              ${params.status ? (params.status.enabled ? "Yes" : "No") : "n/a"}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Jobs</div>
            <div class="stat-value">${params.status?.jobs ?? "n/a"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Next wake</div>
            <div class="stat-value">${formatNextRun(params.status?.nextWakeAtMs ?? null)}</div>
          </div>
        </div>
        ${params.error ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>` : nothing}
      </section>
    </section>
    <section class="card">
      <div class="card-title">Agent Cron Jobs</div>
      <div class="card-sub">Scheduled jobs targeting this agent.</div>
      ${
        jobs.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px">No jobs assigned.</div>
            `
          : html`
              <div class="list" style="margin-top: 16px;">
                ${jobs.map(
                  (job) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${job.name}</div>
                        ${job.description ? html`<div class="list-sub">${job.description}</div>` : nothing}
                        <div class="chip-row" style="margin-top: 6px;">
                          <span class="chip">${formatCronSchedule(job)}</span>
                          <span class="chip ${job.enabled ? "chip-ok" : "chip-warn"}">
                            ${job.enabled ? "enabled" : "disabled"}
                          </span>
                          <span class="chip">${job.sessionTarget}</span>
                        </div>
                      </div>
                      <div class="list-meta">
                        <div class="mono">${formatCronState(job)}</div>
                        <div class="muted">${formatCronPayload(job)}</div>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
      }
    </section>
  `;
}
export function renderAgentFiles(params) {
  const list = params.agentFilesList?.agentId === params.agentId ? params.agentFilesList : null;
  const files = list?.files ?? [];
  const active = params.agentFileActive ?? null;
  const activeEntry = active ? (files.find((f) => f.name === active) ?? null) : null;
  const baseContent = active ? (params.agentFileContents[active] ?? "") : "";
  const draft = active ? (params.agentFileDrafts[active] ?? baseContent) : "";

  // Group by top-level section preserving insertion order
  const sections = new Map([
    ["core", []],
    ["memory", []],
    ["docs", []],
  ]);
  for (const f of files) {
    const s = f.section ?? "core";
    (sections.get(s) ?? sections.get("core")).push(f);
  }

  return html`
      ${params.agentFilesError ? html`<div class="callout danger" style="margin-top: 12px;">${params.agentFilesError}</div>` : nothing}
      ${
        !list
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load the agent workspace files to edit core instructions.
              </div>
            `
          : html`
              <div class="agent-files-grid">
                <div class="agent-files-list">
                  ${
                    files.length === 0
                      ? html`
                          <div class="muted">No files found.</div>
                        `
                      : [...sections.entries()]
                          .filter(([, sf]) => sf.length > 0)
                          .map(([section, sectionFiles]) => {
                            const tree = buildFileTree(
                              sectionFiles,
                              section === "core" ? null : section,
                            );
                            const sectionInner = html`
                              <summary class="agent-files-section-label">
                                ${SECTION_LABELS[section] ?? section}
                                <span class="muted" style="font-weight:400;">(${sectionFiles.length})</span>
                              </summary>
                              <div class="agent-files-section-body">
                                ${renderFileTree(tree, 0, active, (name) =>
                                  params.onSelectFile(name),
                                )}
                              </div>
                            `;
                            // Static `open` on core section; no binding on others so user state persists.
                            return section === "core"
                              ? html`<details class="agent-files-section" open>${sectionInner}</details>`
                              : html`<details class="agent-files-section">${sectionInner}</details>`;
                          })
                  }
                </div>
                <div class="agent-files-editor">
                  ${
                    !activeEntry
                      ? html`
                          <div class="muted">Select a file to view or edit.</div>
                        `
                      : html`
                          <div class="agent-file-header" style="display:none">
                          </div>
                          ${
                            activeEntry.missing
                              ? html`
                                  <div class="callout info" style="margin-top: 10px">
                                    This file is missing. Saving will create it in the agent workspace.
                                  </div>
                                `
                              : nothing
                          }
                          ${
                            activeEntry.contentType === "image"
                              ? html`<div class="agent-file-image-wrap"><img class="agent-file-preview-image" src="${draft}" alt="${activeEntry.name}"></div>`
                              : activeEntry.contentType === "pdf"
                                ? html`<iframe class="agent-file-pdf-viewer" src="${pdfBlobUrl(draft)}"></iframe>`
                                : activeEntry.contentType === "binary"
                                  ? html`
                                      <div class="callout info" style="margin-top: 12px">Binary file — cannot edit in the browser.</div>
                                    `
                                  : html`
                                  <label class="field agent-file-content" style="margin-top: 0;">
                                    <textarea
                                      .value=${draft}
                                      @input=${(e) => params.onFileDraftChange(activeEntry.name, e.target.value)}
                                    ></textarea>
                                  </label>
                                `
                          }
                        `
                  }
                </div>
              </div>
            `
      }
  `;
}
