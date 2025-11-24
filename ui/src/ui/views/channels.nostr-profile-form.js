let isFormDirty = function (state) {
  const { values, original } = state;
  return (
    values.name !== original.name ||
    values.displayName !== original.displayName ||
    values.about !== original.about ||
    values.picture !== original.picture ||
    values.banner !== original.banner ||
    values.website !== original.website ||
    values.nip05 !== original.nip05 ||
    values.lud16 !== original.lud16
  );
};
import { html, nothing } from "lit";
export function renderNostrProfileForm(params) {
  const { state, callbacks, accountId } = params;
  const isDirty = isFormDirty(state);
  const renderField = (field, label, opts = {}) => {
    const { type = "text", placeholder, maxLength, help } = opts;
    const value = state.values[field] ?? "";
    const error = state.fieldErrors[field];
    const inputId = `nostr-profile-${field}`;
    if (type === "textarea") {
      return html`
        <div class="nostr-form__field">
          <label for="${inputId}" class="nostr-form__label">
            ${label}
          </label>
          <textarea
            id="${inputId}"
            class="nostr-form__textarea"
            .value=${value}
            placeholder=${placeholder ?? ""}
            maxlength=${maxLength ?? 2000}
            rows="3"
            @input=${(e) => {
              const target = e.target;
              callbacks.onFieldChange(field, target.value);
            }}
            ?disabled=${state.saving}
          ></textarea>
          ${help ? html`<div class="nostr-form__help">${help}</div>` : nothing}
          ${error ? html`<div class="nostr-form__error">${error}</div>` : nothing}
        </div>
      `;
    }
    return html`
      <div class="nostr-form__field">
        <label for="${inputId}" class="nostr-form__label">
          ${label}
        </label>
        <input
          id="${inputId}"
          class="nostr-form__input"
          type=${type}
          .value=${value}
          placeholder=${placeholder ?? ""}
          maxlength=${maxLength ?? 256}
          @input=${(e) => {
            const target = e.target;
            callbacks.onFieldChange(field, target.value);
          }}
          ?disabled=${state.saving}
        />
        ${help ? html`<div class="nostr-form__help">${help}</div>` : nothing}
        ${error ? html`<div class="nostr-form__error">${error}</div>` : nothing}
      </div>
    `;
  };
  const renderPicturePreview = () => {
    const picture = state.values.picture;
    if (!picture) {
      return nothing;
    }
    return html`
      <div class="nostr-form__avatar-wrap">
        <img
          src=${picture}
          alt="Profile picture preview"
          class="nostr-form__avatar"
          @error=${(e) => {
            const img = e.target;
            img.style.display = "none";
          }}
          @load=${(e) => {
            const img = e.target;
            img.style.display = "block";
          }}
        />
      </div>
    `;
  };
  return html`
    <div class="nostr-profile-form">
      <div class="nostr-form__header">
        <div class="nostr-form__title">Edit Profile</div>
        <div class="nostr-form__account">Account: ${accountId}</div>
      </div>

      ${state.error ? html`<div class="callout danger nostr-form__callout">${state.error}</div>` : nothing}

      ${state.success ? html`<div class="callout success nostr-form__callout">${state.success}</div>` : nothing}

      ${renderPicturePreview()}

      ${renderField("name", "Username", {
        placeholder: "satoshi",
        maxLength: 256,
        help: "Short username (e.g., satoshi)",
      })}

      ${renderField("displayName", "Display Name", {
        placeholder: "Satoshi Nakamoto",
        maxLength: 256,
        help: "Your full display name",
      })}

      ${renderField("about", "Bio", {
        type: "textarea",
        placeholder: "Tell people about yourself...",
        maxLength: 2000,
        help: "A brief bio or description",
      })}

      ${renderField("picture", "Avatar URL", {
        type: "url",
        placeholder: "https://example.com/avatar.jpg",
        help: "HTTPS URL to your profile picture",
      })}

      ${
        state.showAdvanced
          ? html`
            <div class="divider-section">
              <div class="nostr-form__advanced-label">Advanced</div>

              ${renderField("banner", "Banner URL", {
                type: "url",
                placeholder: "https://example.com/banner.jpg",
                help: "HTTPS URL to a banner image",
              })}

              ${renderField("website", "Website", {
                type: "url",
                placeholder: "https://example.com",
                help: "Your personal website",
              })}

              ${renderField("nip05", "NIP-05 Identifier", {
                placeholder: "you@example.com",
                help: "Verifiable identifier (e.g., you@domain.com)",
              })}

              ${renderField("lud16", "Lightning Address", {
                placeholder: "you@getalby.com",
                help: "Lightning address for tips (LUD-16)",
              })}
            </div>
          `
          : nothing
      }

      <div class="nostr-form__actions">
        <button
          class="btn primary"
          @click=${callbacks.onSave}
          ?disabled=${state.saving || !isDirty}
        >
          ${state.saving ? "Saving..." : "Save & Publish"}
        </button>

        <button
          class="btn"
          @click=${callbacks.onImport}
          ?disabled=${state.importing || state.saving}
        >
          ${state.importing ? "Importing..." : "Import from Relays"}
        </button>

        <button
          class="btn"
          @click=${callbacks.onToggleAdvanced}
        >
          ${state.showAdvanced ? "Hide Advanced" : "Show Advanced"}
        </button>

        <button
          class="btn"
          @click=${callbacks.onCancel}
          ?disabled=${state.saving}
        >
          Cancel
        </button>
      </div>

      ${
        isDirty
          ? html`
              <div class="nostr-form__unsaved">You have unsaved changes</div>
            `
          : nothing
      }
    </div>
  `;
}
export function createNostrProfileFormState(profile) {
  const values = {
    name: profile?.name ?? "",
    displayName: profile?.displayName ?? "",
    about: profile?.about ?? "",
    picture: profile?.picture ?? "",
    banner: profile?.banner ?? "",
    website: profile?.website ?? "",
    nip05: profile?.nip05 ?? "",
    lud16: profile?.lud16 ?? "",
  };
  return {
    values,
    original: { ...values },
    saving: false,
    importing: false,
    error: null,
    success: null,
    fieldErrors: {},
    showAdvanced: Boolean(profile?.banner || profile?.website || profile?.nip05 || profile?.lud16),
  };
}
