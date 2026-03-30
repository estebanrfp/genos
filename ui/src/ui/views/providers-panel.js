// GenosOS — Esteban & Nyx 🦀🌙
import { html, nothing } from "lit";

/** @type {{ profiles: Array, loading: boolean, error: string|null, adding: string|null, editingId: string|null, form: object }} */
const state = {
  profiles: [],
  loading: false,
  error: null,
  adding: null, // provider name being added to, null if not adding
  editingId: null,
  form: { provider: "", type: "api_key", value: "", profileId: "" },
};

const TYPE_LABELS = { api_key: "API Key", token: "Token", oauth: "OAuth" };

/** Group flat profiles array into { provider → profiles[] } map. */
const groupByProvider = (profiles) => {
  const map = new Map();
  for (const p of profiles) {
    const list = map.get(p.provider) ?? [];
    list.push(p);
    map.set(p.provider, list);
  }
  return map;
};

export async function loadProviders(client, requestUpdate) {
  state.loading = true;
  state.error = null;
  requestUpdate();
  try {
    const res = await client.request("providers.list", {});
    state.profiles = res?.profiles ?? [];
  } catch (err) {
    state.error = err?.message ?? "Failed to load providers";
  } finally {
    state.loading = false;
    requestUpdate();
  }
}

async function toggleDisabled(profile, client, requestUpdate) {
  try {
    await client.request("providers.setDisabled", {
      profileId: profile.profileId,
      disabled: !profile.disabled,
    });
    await loadProviders(client, requestUpdate);
  } catch (err) {
    state.error = err?.message ?? "Failed to update credential";
    requestUpdate();
  }
}

async function deleteCredential(profileId, client, requestUpdate) {
  if (!window.confirm(`Delete credential "${profileId}"?`)) {
    return;
  }
  try {
    await client.request("providers.delete", { profileId });
    await loadProviders(client, requestUpdate);
  } catch (err) {
    state.error = err?.message ?? "Failed to delete credential";
    requestUpdate();
  }
}

async function saveCredential(client, requestUpdate) {
  const { provider, type, value, profileId } = state.form;
  if (!provider.trim() || !value.trim()) {
    return;
  }
  try {
    await client.request("providers.set", {
      provider: provider.trim(),
      type,
      value: value.trim(),
      ...(profileId.trim() ? { profileId: profileId.trim() } : {}),
    });
    state.adding = null;
    state.editingId = null;
    state.form = { provider: "", type: "api_key", value: "", profileId: "" };
    await loadProviders(client, requestUpdate);
  } catch (err) {
    state.error = err?.message ?? "Failed to save credential";
    requestUpdate();
  }
}

function startAddForProvider(provider, requestUpdate) {
  state.adding = provider;
  state.editingId = null;
  state.form = { provider, type: "api_key", value: "", profileId: "" };
  requestUpdate();
}

function startEdit(profile, requestUpdate) {
  state.editingId = profile.profileId;
  state.adding = null;
  state.form = {
    provider: profile.provider,
    type: profile.type === "oauth" ? "token" : profile.type,
    value: "",
    profileId: profile.profileId,
  };
  requestUpdate();
}

function cancelForm(requestUpdate) {
  state.adding = null;
  state.editingId = null;
  requestUpdate();
}

/**
 * Render a single credential row.
 * @param {object} p - profile entry
 * @param {boolean} isFormOpen
 * @param {object} client
 * @param {function} requestUpdate
 */
function renderCredentialRow(p, isFormOpen, client, requestUpdate) {
  return html`
    <li class="providers-cred-item ${p.disabled ? "providers-cred-item--paused" : ""}">
      <div class="providers-cred-info">
        <span class="providers-cred-id">${p.profileId.includes(":") ? p.profileId.split(":").slice(1).join(":") : p.profileId}</span>
        <span class="providers-cred-type">(${TYPE_LABELS[p.type] ?? p.type})</span>
        ${
          p.disabled
            ? html`
                <span class="providers-cred-type">(Paused)</span>
              `
            : nothing
        }
        <span class="providers-cred-masked"><code>${p.maskedValue}</code></span>
        ${p.email ? html`<span class="muted">${p.email}</span>` : nothing}
      </div>
      <div class="providers-cred-actions">
        <button class="btn btn--sm"
          @click=${() => startEdit(p, requestUpdate)}
          ?disabled=${isFormOpen}>Update</button>
        <button class="btn btn--sm"
          title=${p.disabled ? "Resume" : "Pause"}
          @click=${() => toggleDisabled(p, client, requestUpdate)}
          ?disabled=${isFormOpen}>${p.disabled ? "▶" : "⏸"}</button>
        <button class="btn btn--sm btn--danger-icon"
          @click=${() => deleteCredential(p.profileId, client, requestUpdate)}
          ?disabled=${isFormOpen}>✕</button>
      </div>
    </li>
    ${
      state.editingId === p.profileId
        ? html`
      <li class="providers-form">
        ${renderCredentialForm(client, requestUpdate)}
      </li>
    `
        : nothing
    }
  `;
}

function renderCredentialForm(client, requestUpdate) {
  const isEdit = state.editingId !== null;
  return html`
    <div class="providers-form-inner">
      <h4 class="providers-form-title">${isEdit ? `Update ${state.form.profileId}` : `Add credential to ${state.form.provider}`}</h4>
      ${
        !isEdit
          ? html`
        <label class="field">
          <span class="field-label">Type</span>
          <select class="input"
            .value=${state.form.type}
            @change=${(e) => {
              state.form.type = e.target.value;
              requestUpdate();
            }}>
            <option value="api_key">API Key</option>
            <option value="token">Token (OAuth / setup-token)</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Profile ID (optional)</span>
          <input class="input" type="text" placeholder="${state.form.provider}:default"
            .value=${state.form.profileId}
            @input=${(e) => {
              state.form.profileId = e.target.value;
              requestUpdate();
            }} />
        </label>
      `
          : nothing
      }
      <label class="field">
        <span class="field-label">${state.form.type === "api_key" ? "API Key" : "Token"}</span>
        <input class="input" type="password" placeholder="Paste value here"
          .value=${state.form.value}
          @input=${(e) => {
            state.form.value = e.target.value;
            requestUpdate();
          }} />
      </label>
      <div class="providers-form-actions">
        <button class="btn btn--sm primary"
          @click=${() => saveCredential(client, requestUpdate)}
          ?disabled=${!state.form.value.trim()}>Save</button>
        <button class="btn btn--sm"
          @click=${() => cancelForm(requestUpdate)}>Cancel</button>
      </div>
    </div>
  `;
}

function renderProviderBlock(provider, profiles, isFormOpen, client, requestUpdate) {
  const isAddingHere = state.adding === provider;
  return html`
    <div class="providers-block">
      <div class="providers-block-header">
        <span class="providers-block-name">${provider.toUpperCase()}</span>
        <button class="btn btn--sm"
          @click=${() => startAddForProvider(provider, requestUpdate)}
          ?disabled=${isFormOpen}>+</button>
      </div>
      <ul class="providers-cred-list">
        ${profiles.map((p) => renderCredentialRow(p, isFormOpen, client, requestUpdate))}
      </ul>
      ${
        isAddingHere
          ? html`
        <div class="providers-form">
          ${renderCredentialForm(client, requestUpdate)}
        </div>
      `
          : nothing
      }
    </div>
  `;
}

/**
 * Render the Providers panel (credential view grouped by provider).
 * @param {{ client: object, requestUpdate: function }} props
 */
export function renderProvidersPanel({ client, requestUpdate }) {
  if (!client) {
    return nothing;
  }

  const isFormOpen = state.adding !== null || state.editingId !== null;
  const grouped = groupByProvider(state.profiles);

  return html`
    <section class="card sec-section providers-panel">
      <div class="sec-status-header">
        <div>
          <h2 class="sec-title">Providers</h2>
          <p class="sec-subtitle">AI provider credentials, endpoints, and failover order</p>
        </div>
        <button class="btn btn--sm primary"
          @click=${() => {
            loadProviders(client, requestUpdate);
            startAddForProvider("", requestUpdate);
          }}
          ?disabled=${isFormOpen}>+ Add Provider</button>
      </div>

      ${state.error ? html`<p class="callout danger">${state.error}</p>` : nothing}

      ${
        state.loading
          ? html`
              <p class="muted">Loading…</p>
            `
          : nothing
      }

      ${
        !state.loading && grouped.size === 0 && !isFormOpen
          ? html`
              <p class="muted">No providers configured. Add a credential to get started.</p>
            `
          : nothing
      }

      <!-- Provider blocks -->
      ${[...grouped.entries()].map(([provider, profiles]) =>
        renderProviderBlock(provider, profiles, isFormOpen, client, requestUpdate),
      )}

      <!-- Add new provider form (when provider field is blank) -->
      ${
        state.adding === ""
          ? html`
        <div class="providers-block">
          <div class="providers-block-header">
            <label class="field providers-field--grow">
              <span class="field-label">Provider ID</span>
              <input class="input" type="text" placeholder="e.g. openai, anthropic, custom-llm"
                .value=${state.form.provider}
                @input=${(e) => {
                  state.form.provider = e.target.value;
                  requestUpdate();
                }} />
            </label>
          </div>
          ${state.form.provider.trim() ? renderCredentialForm(client, requestUpdate) : nothing}
        </div>
      `
          : nothing
      }
    </section>
  `;
}
