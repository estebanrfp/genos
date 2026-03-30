// GenosOS — Esteban & Nyx
import { html, nothing } from "lit";

/**
 * Evaluate a skipIf condition against state.
 * @param {object} condition - { stateKey, eq }
 * @param {object} state
 * @returns {boolean}
 */
const shouldSkip = (condition, state) => {
  if (!condition?.stateKey) {
    return false;
  }
  return state?.[condition.stateKey] === condition.eq;
};

/**
 * Render QR linking view (WhatsApp).
 * @param {object} state - GenosOSApp host
 * @param {object} active - Queue entry
 * @param {object} step - Descriptor step
 * @returns {import("lit").TemplateResult}
 */
const renderQrStep = (state, active, step) => {
  const qrData = state.channelSetupQr;
  const loading = state.channelSetupQrLoading;
  const waiting = state.channelSetupQrWaiting;

  return html`
    <p class="exec-approval-sub">${step.description}</p>
    ${
      qrData
        ? html`<div class="channel-setup-qr">
          <img src=${qrData} alt="QR Code" />
        </div>`
        : html`<div class="exec-approval-command mono">${loading ? "Generating QR code\u2026" : "Preparing\u2026"}</div>`
    }
    ${
      waiting
        ? html`
            <div class="exec-approval-sub">Waiting for scan\u2026</div>
          `
        : nothing
    }
    ${
      state.channelSetupError
        ? html`<div class="exec-approval-error">${state.channelSetupError}</div>
        <div class="exec-approval-actions">
          <button class="btn primary"
            @click=${() => {
              state.channelSetupError = null;
              state.channelSetupQr = null;
              state.channelSetupQrLoading = false;
              state.channelSetupQrWaiting = false;
              state.requestUpdate();
            }}>
            Retry
          </button>
        </div>`
        : nothing
    }
  `;
};

/**
 * Render token input view (Telegram and similar).
 * @param {object} state - GenosOSApp host
 * @param {object} active - Queue entry
 * @param {object} step - Descriptor step
 * @returns {import("lit").TemplateResult}
 */
const renderTokenStep = (state, active, step) => {
  const busy = state.channelSetupBusy;
  const instructions = step.instructions;
  return html`
    <p class="exec-approval-sub">${step.description}</p>
    ${
      instructions?.length
        ? html`<ol class="channel-setup-instructions">${instructions.map((s) => html`<li>${s}</li>`)}</ol>`
        : nothing
    }
    <input
      class="channel-setup-token-input"
      type="text"
      placeholder=${step.placeholder ?? ""}
      .value=${state.channelSetupTokenValue ?? ""}
      ?disabled=${busy}
      @input=${(e) => {
        state.channelSetupTokenValue = e.target.value;
        state.channelSetupError = null;
        state.requestUpdate();
      }}
      @keydown=${(e) => {
        if (e.key === "Enter" && !busy) {
          state.handleChannelSetupTokenSubmit(active.id);
        }
      }}
    />
    ${
      state.channelSetupError
        ? html`<div class="exec-approval-error">${state.channelSetupError}</div>`
        : nothing
    }
    <div class="exec-approval-actions">
      <button class="btn primary" ?disabled=${busy || !state.channelSetupTokenValue?.trim()}
        @click=${() => state.handleChannelSetupTokenSubmit(active.id)}>
        ${busy ? "Linking\u2026" : "Link"}
      </button>
      <button class="btn" ?disabled=${busy}
        @click=${() => state.dismissChannelSetup(active.id)}>
        Cancel
      </button>
    </div>
  `;
};

/**
 * Render pairing code input view (after token is saved, user approves access).
 * @param {object} state - GenosOSApp host
 * @param {object} active - Queue entry
 * @param {object} step - Descriptor step
 * @returns {import("lit").TemplateResult}
 */
const renderPairingStep = (state, active, step) => {
  const busy = state.channelSetupBusy;
  const setupState = active.state ?? {};
  const botName = setupState.botUsername ? `@${setupState.botUsername}` : "your bot";
  return html`
    <p class="exec-approval-sub">DM <strong>${botName}</strong> in Telegram (send /start). You will receive a pairing code \u2014 paste it below.</p>
    <input
      class="channel-setup-token-input"
      type="text"
      placeholder=${step.placeholder ?? ""}
      .value=${state.channelSetupPairingValue ?? ""}
      ?disabled=${busy}
      @input=${(e) => {
        state.channelSetupPairingValue = e.target.value;
        state.channelSetupError = null;
        state.requestUpdate();
      }}
      @keydown=${(e) => {
        if (e.key === "Enter" && !busy) {
          state.handleChannelSetupPairingSubmit(active.id);
        }
      }}
    />
    ${
      state.channelSetupError
        ? html`<div class="exec-approval-error">${state.channelSetupError}</div>`
        : nothing
    }
    <div class="exec-approval-actions">
      <button class="btn primary" ?disabled=${busy || !state.channelSetupPairingValue?.trim()}
        @click=${() => state.handleChannelSetupPairingSubmit(active.id)}>
        ${busy ? "Approving\u2026" : "Approve"}
      </button>
      <button class="btn" ?disabled=${busy}
        @click=${() => state.dismissChannelSetup(active.id)}>
        Skip
      </button>
    </div>
  `;
};

/**
 * Render prerequisite/info step with instructions, system settings link, and enable button.
 * @param {object} state - GenosOSApp host
 * @param {object} active - Queue entry
 * @param {object} step - Descriptor step
 * @returns {import("lit").TemplateResult}
 */
const renderPrereqStep = (state, active, step) => {
  const busy = state.channelSetupBusy;
  const instructions = step.instructions;
  const setupState = active.state ?? {};
  return html`
    <p class="exec-approval-sub">${step.description}</p>
    ${
      instructions?.length
        ? html`<ol class="channel-setup-instructions">${instructions.map((s) => html`<li>${s}</li>`)}</ol>`
        : nothing
    }
    ${
      setupState.probeError
        ? html`<div class="exec-approval-error">${setupState.probeError}</div>`
        : nothing
    }
    ${
      state.channelSetupError
        ? html`<div class="exec-approval-error">${state.channelSetupError}</div>`
        : nothing
    }
    <div class="exec-approval-actions">
      ${
        step.systemSettingsUrl
          ? html`<a class="btn" href=${step.systemSettingsUrl} target="_blank" rel="noopener">Open Settings</a>`
          : nothing
      }
      <button class="btn primary" ?disabled=${busy}
        @click=${() => state.handleChannelSetupEnable(active.id)}>
        ${busy ? "Enabling\u2026" : "Enable"}
      </button>
      <button class="btn" ?disabled=${busy}
        @click=${() => state.dismissChannelSetup(active.id)}>
        Cancel
      </button>
    </div>
  `;
};

/**
 * Render already-linked view with unlink option.
 * @param {object} state - GenosOSApp host
 * @param {object} active - Queue entry
 * @param {object} step - Descriptor step
 * @returns {import("lit").TemplateResult}
 */
const renderLinkedStep = (state, active, step) => {
  const unlinking = state.channelSetupUnlinking;
  const setupState = active.state ?? {};
  const detail = setupState.botUsername ? `@${setupState.botUsername}` : null;
  return html`
    <p class="exec-approval-sub">${step.description}${detail ? html` &mdash; <strong>${detail}</strong>` : nothing}</p>
    <div class="exec-approval-actions">
      <button class="btn danger" ?disabled=${unlinking}
        @click=${() => state.handleChannelSetupUnlink(active, step)}>
        ${unlinking ? `${step.unlinkLabel ?? "Unlink"}ing\u2026` : (step.unlinkLabel ?? "Unlink")}
      </button>
      <button class="btn"
        @click=${() => state.dismissChannelSetup(active.id)}>
        Close
      </button>
    </div>
    ${
      state.channelSetupError
        ? html`<div class="exec-approval-error">${state.channelSetupError}</div>`
        : nothing
    }
  `;
};

/** @type {Record<string, Function>} */
const STEP_RENDERERS = {
  "qr-scan": renderQrStep,
  "token-input": renderTokenStep,
  "pairing-input": renderPairingStep,
  prereq: renderPrereqStep,
  info: renderLinkedStep,
};

/**
 * Render the channel setup overlay.
 * @param {object} state - GenosOSApp instance (host)
 * @returns {import("lit").TemplateResult}
 */
export function renderChannelSetupOverlay(state) {
  const active = (state.channelSetupQueue ?? [])[0];
  if (!active) {
    return nothing;
  }

  const desc = active.descriptor ?? {};
  const steps = desc.steps ?? [];
  const setupState = active.state ?? {};

  // Pick the first non-skipped step
  const currentStep = steps.find((s) => !shouldSkip(s.skipIf, setupState)) ?? steps[0];
  if (!currentStep) {
    return nothing;
  }

  // Auto-start QR generation for qr-scan steps
  if (
    currentStep.type === "qr-scan" &&
    !state.channelSetupQr &&
    !state.channelSetupQrLoading &&
    !state.channelSetupError
  ) {
    if (!state._qrAutoStarted) {
      state._qrAutoStarted = true;
      Promise.resolve().then(() => state.handleChannelSetupQrStart(active.id, currentStep));
    }
  }

  const renderer = STEP_RENDERERS[currentStep.type];
  if (!renderer) {
    return nothing;
  }

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          state.dismissChannelSetup(active.id);
        }
      }}>
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div class="exec-approval-title">${desc.title ?? "Channel Setup"}</div>
        </div>
        ${renderer(state, active, currentStep)}
      </div>
    </div>
  `;
}
