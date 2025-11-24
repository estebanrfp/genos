import { html, nothing } from "lit";
import { agentBadgeText, normalizeAgentLabel, resolveAgentEmoji } from "./agents-utils.js";

/**
 * Render a compact agent selector bar for standalone tabs.
 * @param {object} props
 */
export function renderAgentSelector(props) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  return html`
    <section class="card agent-selector">
      <div class="agent-selector__bar">
        <select
          class="agent-selector__select"
          .value=${selectedId ?? ""}
          ?disabled=${props.loading || agents.length === 0}
          @change=${(e) => props.onSelectAgent(e.target.value)}
        >
          ${
            agents.length === 0
              ? html`
                  <option value="">No agents</option>
                `
              : nothing
          }
          ${agents.map((agent) => {
            const label = normalizeAgentLabel(agent);
            const badge = agentBadgeText(agent.id, defaultId);
            const emoji = resolveAgentEmoji(agent, props.agentIdentityById?.[agent.id] ?? null);
            return html`
              <option value=${agent.id} ?selected=${agent.id === selectedId}>
                ${emoji ? `${emoji} ` : ""}${label}${badge ? ` (${badge})` : ""}
              </option>
            `;
          })}
        </select>
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading\u2026" : "Refresh"}
        </button>
      </div>
      ${props.error ? html`<div class="callout danger agent-selector__error">${props.error}</div>` : nothing}
    </section>
  `;
}
