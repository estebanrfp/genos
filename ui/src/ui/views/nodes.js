let renderDevices = function (props) {
    const list = props.devicesList ?? { pending: [], paired: [] };
    const pending = Array.isArray(list.pending) ? list.pending : [];
    const paired = Array.isArray(list.paired) ? list.paired : [];
    return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Devices</div>
          <div class="card-sub">Pairing requests + role tokens.</div>
        </div>
        <button class="btn" ?disabled=${props.devicesLoading} @click=${props.onDevicesRefresh}>
          ${props.devicesLoading ? "Loading\u2026" : "Refresh"}
        </button>
      </div>
      ${props.devicesError ? html`<div class="callout danger" style="margin-top: 12px;">${props.devicesError}</div>` : nothing}
      <div class="list" style="margin-top: 16px;">
        ${
          pending.length > 0
            ? html`
              <div class="muted" style="margin-bottom: 8px;">Pending</div>
              ${pending.map((req) => renderPendingDevice(req, props))}
            `
            : nothing
        }
        ${
          paired.length > 0
            ? html`
              <div class="muted" style="margin-top: 12px; margin-bottom: 8px;">Paired</div>
              ${paired.map((device) => renderPairedDevice(device, props))}
            `
            : nothing
        }
        ${
          pending.length === 0 && paired.length === 0
            ? html`
                <div class="muted">No paired devices.</div>
              `
            : nothing
        }
      </div>
    </section>
  `;
  },
  renderPendingDevice = function (req, props) {
    const name = req.displayName?.trim() || req.deviceId;
    const age = typeof req.ts === "number" ? formatRelativeTimestamp(req.ts) : "n/a";
    const role = req.role?.trim() ? `role: ${req.role}` : "role: -";
    const repair = req.isRepair ? " \xB7 repair" : "";
    const ip = req.remoteIp ? ` \xB7 ${req.remoteIp}` : "";
    return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${name}</div>
        <div class="list-sub">${req.deviceId}${ip}</div>
        <div class="muted" style="margin-top: 6px;">
          ${role} · requested ${age}${repair}
        </div>
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--sm primary" @click=${() => props.onDeviceApprove(req.requestId)}>
            Approve
          </button>
          <button class="btn btn--sm" @click=${() => props.onDeviceReject(req.requestId)}>
            Reject
          </button>
        </div>
      </div>
    </div>
  `;
  },
  renderPairedDevice = function (device, props) {
    const name = device.displayName?.trim() || device.deviceId;
    const ip = device.remoteIp ? ` \xB7 ${device.remoteIp}` : "";
    const roles = `roles: ${formatList(device.roles)}`;
    const scopes = `scopes: ${formatList(device.scopes)}`;
    const tokens = Array.isArray(device.tokens) ? device.tokens : [];
    return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${name}</div>
        <div class="list-sub">${device.deviceId}${ip}</div>
        <div class="muted" style="margin-top: 6px;">${roles} · ${scopes}</div>
        ${
          tokens.length === 0
            ? html`
                <div class="muted" style="margin-top: 6px">Tokens: none</div>
              `
            : html`
              <div class="muted" style="margin-top: 10px;">Tokens</div>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                ${tokens.map((token) => renderTokenRow(device.deviceId, token, props))}
              </div>
            `
        }
      </div>
    </div>
  `;
  },
  renderTokenRow = function (deviceId, token, props) {
    const status = token.revokedAtMs ? "revoked" : "active";
    const scopes = `scopes: ${formatList(token.scopes)}`;
    const when = formatRelativeTimestamp(
      token.rotatedAtMs ?? token.createdAtMs ?? token.lastUsedAtMs ?? null,
    );
    return html`
    <div class="row" style="justify-content: space-between; gap: 8px;">
      <div class="list-sub">${token.role} · ${status} · ${scopes} · ${when}</div>
      <div class="row" style="justify-content: flex-end; gap: 6px; flex-wrap: wrap;">
        <button
          class="btn btn--sm"
          @click=${() => props.onDeviceRotate(deviceId, token.role, token.scopes)}
        >
          Rotate
        </button>
        ${
          token.revokedAtMs
            ? nothing
            : html`
              <button
                class="btn btn--sm danger"
                @click=${() => props.onDeviceRevoke(deviceId, token.role)}
              >
                Revoke
              </button>
            `
        }
      </div>
    </div>
  `;
  },
  resolveBindingsState = function (props) {
    const config = props.configForm;
    const nodes = resolveExecNodes(props.nodes);
    const { defaultBinding, agents } = resolveAgentBindings(config);
    const ready = Boolean(config);
    const disabled = props.configSaving || props.configFormMode === "raw";
    return {
      ready,
      disabled,
      configDirty: props.configDirty,
      configLoading: props.configLoading,
      configSaving: props.configSaving,
      defaultBinding,
      agents,
      nodes,
      onBindDefault: props.onBindDefault,
      onBindAgent: props.onBindAgent,
      onSave: props.onSaveBindings,
      onLoadConfig: props.onLoadConfig,
      formMode: props.configFormMode,
    };
  },
  renderBindings = function (state) {
    const supportsBinding = state.nodes.length > 0;
    const defaultValue = state.defaultBinding ?? "";
    return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div>
          <div class="card-title">Exec node binding</div>
          <div class="card-sub">
            Pin agents to a specific node when using <span class="mono">exec host=node</span>.
          </div>
        </div>
        <button
          class="btn"
          ?disabled=${state.disabled || !state.configDirty}
          @click=${state.onSave}
        >
          ${state.configSaving ? "Saving\u2026" : "Save"}
        </button>
      </div>

      ${
        state.formMode === "raw"
          ? html`
              <div class="callout warn" style="margin-top: 12px">
                Switch the Config tab to <strong>Form</strong> mode to edit bindings here.
              </div>
            `
          : nothing
      }

      ${
        !state.ready
          ? html`<div class="row" style="margin-top: 12px; gap: 12px;">
            <div class="muted">Load config to edit bindings.</div>
            <button class="btn" ?disabled=${state.configLoading} @click=${state.onLoadConfig}>
              ${state.configLoading ? "Loading\u2026" : "Load config"}
            </button>
          </div>`
          : html`
            <div class="list" style="margin-top: 16px;">
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">Default binding</div>
                  <div class="list-sub">Used when agents do not override a node binding.</div>
                </div>
                <div class="list-meta">
                  <label class="field">
                    <span>Node</span>
                    <select
                      ?disabled=${state.disabled || !supportsBinding}
                      @change=${(event) => {
                        const target = event.target;
                        const value = target.value.trim();
                        state.onBindDefault(value ? value : null);
                      }}
                    >
                      <option value="" ?selected=${defaultValue === ""}>Any node</option>
                      ${state.nodes.map(
                        (node) => html`<option
                            value=${node.id}
                            ?selected=${defaultValue === node.id}
                          >
                            ${node.label}
                          </option>`,
                      )}
                    </select>
                  </label>
                  ${
                    !supportsBinding
                      ? html`
                          <div class="muted">No nodes with system.run available.</div>
                        `
                      : nothing
                  }
                </div>
              </div>

              ${
                state.agents.length === 0
                  ? html`
                      <div class="muted">No agents found.</div>
                    `
                  : state.agents.map((agent) => renderAgentBinding(agent, state))
              }
            </div>
          `
      }
    </section>
  `;
  },
  renderAgentBinding = function (agent, state) {
    const bindingValue = agent.binding ?? "__default__";
    const label = agent.name?.trim() ? `${agent.name} (${agent.id})` : agent.id;
    const supportsBinding = state.nodes.length > 0;
    return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${label}</div>
        <div class="list-sub">
          ${agent.isDefault ? "default agent" : "agent"} ·
          ${bindingValue === "__default__" ? `uses default (${state.defaultBinding ?? "any"})` : `override: ${agent.binding}`}
        </div>
      </div>
      <div class="list-meta">
        <label class="field">
          <span>Binding</span>
          <select
            ?disabled=${state.disabled || !supportsBinding}
            @change=${(event) => {
              const target = event.target;
              const value = target.value.trim();
              state.onBindAgent(agent.index, value === "__default__" ? null : value);
            }}
          >
            <option value="__default__" ?selected=${bindingValue === "__default__"}>
              Use default
            </option>
            ${state.nodes.map(
              (node) => html`<option
                  value=${node.id}
                  ?selected=${bindingValue === node.id}
                >
                  ${node.label}
                </option>`,
            )}
          </select>
        </label>
      </div>
    </div>
  `;
  },
  resolveExecNodes = function (nodes) {
    const list = [];
    for (const node of nodes) {
      const commands = Array.isArray(node.commands) ? node.commands : [];
      const supports = commands.some((cmd) => String(cmd) === "system.run");
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
  },
  resolveAgentBindings = function (config) {
    const fallbackAgent = {
      id: "main",
      name: undefined,
      index: 0,
      isDefault: true,
      binding: null,
    };
    if (!config || typeof config !== "object") {
      return { defaultBinding: null, agents: [fallbackAgent] };
    }
    const tools = config.tools ?? {};
    const exec = tools.exec ?? {};
    const defaultBinding =
      typeof exec.node === "string" && exec.node.trim() ? exec.node.trim() : null;
    const agentsNode = config.agents ?? {};
    const list = Array.isArray(agentsNode.list) ? agentsNode.list : [];
    if (list.length === 0) {
      return { defaultBinding, agents: [fallbackAgent] };
    }
    const agents = [];
    list.forEach((entry, index) => {
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
      const toolsEntry = record.tools ?? {};
      const execEntry = toolsEntry.exec ?? {};
      const binding =
        typeof execEntry.node === "string" && execEntry.node.trim() ? execEntry.node.trim() : null;
      agents.push({
        id,
        name: name || undefined,
        index,
        isDefault,
        binding,
      });
    });
    if (agents.length === 0) {
      agents.push(fallbackAgent);
    }
    return { defaultBinding, agents };
  },
  renderNode = function (node) {
    const connected = Boolean(node.connected);
    const paired = Boolean(node.paired);
    const title =
      (typeof node.displayName === "string" && node.displayName.trim()) ||
      (typeof node.nodeId === "string" ? node.nodeId : "unknown");
    const caps = Array.isArray(node.caps) ? node.caps : [];
    const commands = Array.isArray(node.commands) ? node.commands : [];
    return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${title}</div>
        <div class="list-sub">
          ${typeof node.nodeId === "string" ? node.nodeId : ""}
          ${typeof node.remoteIp === "string" ? ` \xB7 ${node.remoteIp}` : ""}
          ${typeof node.version === "string" ? ` \xB7 ${node.version}` : ""}
        </div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${paired ? "paired" : "unpaired"}</span>
          <span class="chip ${connected ? "chip-ok" : "chip-warn"}">
            ${connected ? "connected" : "offline"}
          </span>
          ${caps.slice(0, 12).map((c) => html`<span class="chip">${String(c)}</span>`)}
          ${commands.slice(0, 8).map((c) => html`<span class="chip">${String(c)}</span>`)}
        </div>
      </div>
    </div>
  `;
  };
import { html, nothing } from "lit";
import { formatRelativeTimestamp, formatList } from "../format.js";
import { renderExecApprovals, resolveExecApprovalsState } from "./nodes-exec-approvals.js";
export function renderNodes(props) {
  const bindingState = resolveBindingsState(props);
  const approvalsState = resolveExecApprovalsState(props);
  return html`
    ${renderExecApprovals(approvalsState)}
    ${renderBindings(bindingState)}
    ${renderDevices(props)}
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Nodes</div>
          <div class="card-sub">Paired devices and live links.</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading\u2026" : "Refresh"}
        </button>
      </div>
      <div class="list" style="margin-top: 16px;">
        ${
          props.nodes.length === 0
            ? html`
                <div class="muted">No nodes found.</div>
              `
            : props.nodes.map((n) => renderNode(n))
        }
      </div>
    </section>
  `;
}
