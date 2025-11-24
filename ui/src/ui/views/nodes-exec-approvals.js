let normalizeSecurity = function (value) {
    if (value === "allowlist" || value === "full" || value === "deny") {
      return value;
    }
    return "deny";
  },
  normalizeAsk = function (value) {
    if (value === "always" || value === "off" || value === "on-miss") {
      return value;
    }
    return "on-miss";
  },
  resolveExecApprovalsDefaults = function (form) {
    const defaults = form?.defaults ?? {};
    return {
      security: normalizeSecurity(defaults.security),
      ask: normalizeAsk(defaults.ask),
      askFallback: normalizeSecurity(defaults.askFallback ?? "deny"),
      autoAllowSkills: Boolean(defaults.autoAllowSkills ?? false),
    };
  },
  resolveConfigAgents = function (config) {
    const agentsNode = config?.agents ?? {};
    const list = Array.isArray(agentsNode.list) ? agentsNode.list : [];
    const agents = [];
    list.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const record = entry;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (!id) {
        return;
      }
      const name = typeof record.name === "string" ? record.name.trim() : undefined;
      const isDefault = record.default === true;
      agents.push({ id, name: name || undefined, isDefault });
    });
    return agents;
  },
  resolveExecApprovalsAgents = function (config, form) {
    const configAgents = resolveConfigAgents(config);
    const approvalsAgents = Object.keys(form?.agents ?? {});
    const merged = new Map();
    configAgents.forEach((agent) => merged.set(agent.id, agent));
    approvalsAgents.forEach((id) => {
      if (merged.has(id)) {
        return;
      }
      merged.set(id, { id });
    });
    const agents = Array.from(merged.values());
    if (agents.length === 0) {
      agents.push({ id: "main", isDefault: true });
    }
    agents.sort((a, b) => {
      if (a.isDefault && !b.isDefault) {
        return -1;
      }
      if (!a.isDefault && b.isDefault) {
        return 1;
      }
      const aLabel = a.name?.trim() ? a.name : a.id;
      const bLabel = b.name?.trim() ? b.name : b.id;
      return aLabel.localeCompare(bLabel);
    });
    return agents;
  },
  resolveExecApprovalsScope = function (selected, agents) {
    if (selected === EXEC_APPROVALS_DEFAULT_SCOPE) {
      return EXEC_APPROVALS_DEFAULT_SCOPE;
    }
    if (selected && agents.some((agent) => agent.id === selected)) {
      return selected;
    }
    return EXEC_APPROVALS_DEFAULT_SCOPE;
  },
  renderExecApprovalsTarget = function (state) {
    const hasNodes = state.targetNodes.length > 0;
    const nodeValue = state.targetNodeId ?? "";
    return html`
    <div class="list" style="margin-top: 12px;">
      <div class="list-item">
        <div class="list-main">
          <div class="list-title">Target</div>
          <div class="list-sub">
            Gateway edits local approvals; node edits the selected node.
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>Host</span>
            <select
              ?disabled=${state.disabled}
              @change=${(event) => {
                const target = event.target;
                const value = target.value;
                if (value === "node") {
                  const first = state.targetNodes[0]?.id ?? null;
                  state.onSelectTarget("node", nodeValue || first);
                } else {
                  state.onSelectTarget("gateway", null);
                }
              }}
            >
              <option value="gateway" ?selected=${state.target === "gateway"}>Gateway</option>
              <option value="node" ?selected=${state.target === "node"}>Node</option>
            </select>
          </label>
          ${
            state.target === "node"
              ? html`
                <label class="field">
                  <span>Node</span>
                  <select
                    ?disabled=${state.disabled || !hasNodes}
                    @change=${(event) => {
                      const target = event.target;
                      const value = target.value.trim();
                      state.onSelectTarget("node", value ? value : null);
                    }}
                  >
                    <option value="" ?selected=${nodeValue === ""}>Select node</option>
                    ${state.targetNodes.map(
                      (node) => html`<option
                          value=${node.id}
                          ?selected=${nodeValue === node.id}
                        >
                          ${node.label}
                        </option>`,
                    )}
                  </select>
                </label>
              `
              : nothing
          }
        </div>
      </div>
      ${
        state.target === "node" && !hasNodes
          ? html`
              <div class="muted">No nodes advertise exec approvals yet.</div>
            `
          : nothing
      }
    </div>
  `;
  },
  renderExecApprovalsTabs = function (state) {
    return html`
    <div class="row" style="margin-top: 12px; gap: 8px; flex-wrap: wrap;">
      <span class="label">Scope</span>
      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        <button
          class="btn btn--sm ${state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE ? "active" : ""}"
          @click=${() => state.onSelectScope(EXEC_APPROVALS_DEFAULT_SCOPE)}
        >
          Defaults
        </button>
        ${state.agents.map((agent) => {
          const label = agent.name?.trim() ? `${agent.name} (${agent.id})` : agent.id;
          return html`
            <button
              class="btn btn--sm ${state.selectedScope === agent.id ? "active" : ""}"
              @click=${() => state.onSelectScope(agent.id)}
            >
              ${label}
            </button>
          `;
        })}
      </div>
    </div>
  `;
  },
  renderExecApprovalsPolicy = function (state) {
    const isDefaults = state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE;
    const defaults = state.defaults;
    const agent = state.selectedAgent ?? {};
    const basePath = isDefaults ? ["defaults"] : ["agents", state.selectedScope];
    const agentSecurity = typeof agent.security === "string" ? agent.security : undefined;
    const agentAsk = typeof agent.ask === "string" ? agent.ask : undefined;
    const agentAskFallback = typeof agent.askFallback === "string" ? agent.askFallback : undefined;
    const securityValue = isDefaults ? defaults.security : (agentSecurity ?? "__default__");
    const askValue = isDefaults ? defaults.ask : (agentAsk ?? "__default__");
    const askFallbackValue = isDefaults
      ? defaults.askFallback
      : (agentAskFallback ?? "__default__");
    const autoOverride =
      typeof agent.autoAllowSkills === "boolean" ? agent.autoAllowSkills : undefined;
    const autoEffective = autoOverride ?? defaults.autoAllowSkills;
    const autoIsDefault = autoOverride == null;
    return html`
    <div class="list" style="margin-top: 16px;">
      <div class="list-item">
        <div class="list-main">
          <div class="list-title">Security</div>
          <div class="list-sub">
            ${isDefaults ? "Default security mode." : `Default: ${defaults.security}.`}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>Mode</span>
            <select
              ?disabled=${state.disabled}
              @change=${(event) => {
                const target = event.target;
                const value = target.value;
                if (!isDefaults && value === "__default__") {
                  state.onRemove([...basePath, "security"]);
                } else {
                  state.onPatch([...basePath, "security"], value);
                }
              }}
            >
              ${
                !isDefaults
                  ? html`<option value="__default__" ?selected=${securityValue === "__default__"}>
                    Use default (${defaults.security})
                  </option>`
                  : nothing
              }
              ${SECURITY_OPTIONS.map(
                (option) => html`<option
                    value=${option.value}
                    ?selected=${securityValue === option.value}
                  >
                    ${option.label}
                  </option>`,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item">
        <div class="list-main">
          <div class="list-title">Ask</div>
          <div class="list-sub">
            ${isDefaults ? "Default prompt policy." : `Default: ${defaults.ask}.`}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>Mode</span>
            <select
              ?disabled=${state.disabled}
              @change=${(event) => {
                const target = event.target;
                const value = target.value;
                if (!isDefaults && value === "__default__") {
                  state.onRemove([...basePath, "ask"]);
                } else {
                  state.onPatch([...basePath, "ask"], value);
                }
              }}
            >
              ${
                !isDefaults
                  ? html`<option value="__default__" ?selected=${askValue === "__default__"}>
                    Use default (${defaults.ask})
                  </option>`
                  : nothing
              }
              ${ASK_OPTIONS.map(
                (option) => html`<option
                    value=${option.value}
                    ?selected=${askValue === option.value}
                  >
                    ${option.label}
                  </option>`,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item">
        <div class="list-main">
          <div class="list-title">Ask fallback</div>
          <div class="list-sub">
            ${isDefaults ? "Applied when the UI prompt is unavailable." : `Default: ${defaults.askFallback}.`}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>Fallback</span>
            <select
              ?disabled=${state.disabled}
              @change=${(event) => {
                const target = event.target;
                const value = target.value;
                if (!isDefaults && value === "__default__") {
                  state.onRemove([...basePath, "askFallback"]);
                } else {
                  state.onPatch([...basePath, "askFallback"], value);
                }
              }}
            >
              ${
                !isDefaults
                  ? html`<option value="__default__" ?selected=${askFallbackValue === "__default__"}>
                    Use default (${defaults.askFallback})
                  </option>`
                  : nothing
              }
              ${SECURITY_OPTIONS.map(
                (option) => html`<option
                    value=${option.value}
                    ?selected=${askFallbackValue === option.value}
                  >
                    ${option.label}
                  </option>`,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item">
        <div class="list-main">
          <div class="list-title">Auto-allow skill CLIs</div>
          <div class="list-sub">
            ${isDefaults ? "Allow skill executables listed by the Gateway." : autoIsDefault ? `Using default (${defaults.autoAllowSkills ? "on" : "off"}).` : `Override (${autoEffective ? "on" : "off"}).`}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>Enabled</span>
            <input
              type="checkbox"
              ?disabled=${state.disabled}
              .checked=${autoEffective}
              @change=${(event) => {
                const target = event.target;
                state.onPatch([...basePath, "autoAllowSkills"], target.checked);
              }}
            />
          </label>
          ${
            !isDefaults && !autoIsDefault
              ? html`<button
                class="btn btn--sm"
                ?disabled=${state.disabled}
                @click=${() => state.onRemove([...basePath, "autoAllowSkills"])}
              >
                Use default
              </button>`
              : nothing
          }
        </div>
      </div>
    </div>
  `;
  },
  renderExecApprovalsAllowlist = function (state) {
    const allowlistPath = ["agents", state.selectedScope, "allowlist"];
    const entries = state.allowlist;
    return html`
    <div class="row" style="margin-top: 18px; justify-content: space-between;">
      <div>
        <div class="card-title">Allowlist</div>
        <div class="card-sub">Case-insensitive glob patterns.</div>
      </div>
      <button
        class="btn btn--sm"
        ?disabled=${state.disabled}
        @click=${() => {
          const next = [...entries, { pattern: "" }];
          state.onPatch(allowlistPath, next);
        }}
      >
        Add pattern
      </button>
    </div>
    <div class="list" style="margin-top: 12px;">
      ${
        entries.length === 0
          ? html`
              <div class="muted">No allowlist entries yet.</div>
            `
          : entries.map((entry, index) => renderAllowlistEntry(state, entry, index))
      }
    </div>
  `;
  },
  renderAllowlistEntry = function (state, entry, index) {
    const lastUsed = entry.lastUsedAt ? formatRelativeTimestamp(entry.lastUsedAt) : "never";
    const lastCommand = entry.lastUsedCommand ? clampText(entry.lastUsedCommand, 120) : null;
    const lastPath = entry.lastResolvedPath ? clampText(entry.lastResolvedPath, 120) : null;
    return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${entry.pattern?.trim() ? entry.pattern : "New pattern"}</div>
        <div class="list-sub">Last used: ${lastUsed}</div>
        ${lastCommand ? html`<div class="list-sub mono">${lastCommand}</div>` : nothing}
        ${lastPath ? html`<div class="list-sub mono">${lastPath}</div>` : nothing}
      </div>
      <div class="list-meta">
        <label class="field">
          <span>Pattern</span>
          <input
            type="text"
            .value=${entry.pattern ?? ""}
            ?disabled=${state.disabled}
            @input=${(event) => {
              const target = event.target;
              state.onPatch(
                ["agents", state.selectedScope, "allowlist", index, "pattern"],
                target.value,
              );
            }}
          />
        </label>
        <button
          class="btn btn--sm danger"
          ?disabled=${state.disabled}
          @click=${() => {
            if (state.allowlist.length <= 1) {
              state.onRemove(["agents", state.selectedScope, "allowlist"]);
              return;
            }
            state.onRemove(["agents", state.selectedScope, "allowlist", index]);
          }}
        >
          Remove
        </button>
      </div>
    </div>
  `;
  },
  resolveExecApprovalsNodes = function (nodes) {
    const list = [];
    for (const node of nodes) {
      const commands = Array.isArray(node.commands) ? node.commands : [];
      const supports = commands.some(
        (cmd) =>
          String(cmd) === "system.execApprovals.get" || String(cmd) === "system.execApprovals.set",
      );
      if (!supports) {
        continue;
      }
      const nodeId = typeof node.nodeId === "string" ? node.nodeId.trim() : "";
      if (!nodeId) {
        continue;
      }
      const displayName =
        typeof node.displayName === "string" && node.displayName.trim()
          ? node.displayName.trim()
          : nodeId;
      list.push({
        id: nodeId,
        label: displayName === nodeId ? nodeId : `${displayName} \xB7 ${nodeId}`,
      });
    }
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  };
import { html, nothing } from "lit";
import { clampText, formatRelativeTimestamp } from "../format.js";
const EXEC_APPROVALS_DEFAULT_SCOPE = "__defaults__";
const SECURITY_OPTIONS = [
  { value: "deny", label: "Deny" },
  { value: "allowlist", label: "Allowlist" },
  { value: "full", label: "Full" },
];
const ASK_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on-miss", label: "On miss" },
  { value: "always", label: "Always" },
];
export function resolveExecApprovalsState(props) {
  const form = props.execApprovalsForm ?? props.execApprovalsSnapshot?.file ?? null;
  const ready = Boolean(form);
  const defaults = resolveExecApprovalsDefaults(form);
  const agents = resolveExecApprovalsAgents(props.configForm, form);
  const targetNodes = resolveExecApprovalsNodes(props.nodes);
  const target = props.execApprovalsTarget;
  let targetNodeId =
    target === "node" && props.execApprovalsTargetNodeId ? props.execApprovalsTargetNodeId : null;
  if (target === "node" && targetNodeId && !targetNodes.some((node) => node.id === targetNodeId)) {
    targetNodeId = null;
  }
  const selectedScope = resolveExecApprovalsScope(props.execApprovalsSelectedAgent, agents);
  const selectedAgent =
    selectedScope !== EXEC_APPROVALS_DEFAULT_SCOPE
      ? ((form?.agents ?? {})[selectedScope] ?? null)
      : null;
  const allowlist = Array.isArray(selectedAgent?.allowlist) ? (selectedAgent.allowlist ?? []) : [];
  return {
    ready,
    disabled: props.execApprovalsSaving || props.execApprovalsLoading,
    dirty: props.execApprovalsDirty,
    loading: props.execApprovalsLoading,
    saving: props.execApprovalsSaving,
    form,
    defaults,
    selectedScope,
    selectedAgent,
    agents,
    allowlist,
    target,
    targetNodeId,
    targetNodes,
    onSelectScope: props.onExecApprovalsSelectAgent,
    onSelectTarget: props.onExecApprovalsTargetChange,
    onPatch: props.onExecApprovalsPatch,
    onRemove: props.onExecApprovalsRemove,
    onLoad: props.onLoadExecApprovals,
    onSave: props.onSaveExecApprovals,
  };
}
export function renderExecApprovals(state) {
  const ready = state.ready;
  const targetReady = state.target !== "node" || Boolean(state.targetNodeId);
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div>
          <div class="card-title">Exec approvals</div>
          <div class="card-sub">
            Allowlist and approval policy for <span class="mono">exec host=gateway/node</span>.
          </div>
        </div>
        <button
          class="btn"
          ?disabled=${state.disabled || !state.dirty || !targetReady}
          @click=${state.onSave}
        >
          ${state.saving ? "Saving\u2026" : "Save"}
        </button>
      </div>

      ${renderExecApprovalsTarget(state)}

      ${
        !ready
          ? html`<div class="row" style="margin-top: 12px; gap: 12px;">
            <div class="muted">Load exec approvals to edit allowlists.</div>
            <button class="btn" ?disabled=${state.loading || !targetReady} @click=${state.onLoad}>
              ${state.loading ? "Loading\u2026" : "Load approvals"}
            </button>
          </div>`
          : html`
            ${renderExecApprovalsTabs(state)}
            ${renderExecApprovalsPolicy(state)}
            ${state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE ? nothing : renderExecApprovalsAllowlist(state)}
          `
      }
    </section>
  `;
}
