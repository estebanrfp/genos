import { html, nothing } from "lit";
import { t } from "../../i18n/index.js";

/**
 * Render the Connection page — gateway access form only.
 * @param {object} props
 */
export function renderConnection(props) {
  const snapshot = props.hello?.snapshot;
  const authMode = snapshot?.authMode;
  const isTrustedProxy = authMode === "trusted-proxy";

  const authHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    const authFailed = lower.includes("unauthorized") || lower.includes("connect failed");
    if (!authFailed) {
      return null;
    }
    const hasToken = Boolean(props.settings.token.trim());
    if (!hasToken) {
      return html`
        <div class="muted" style="margin-top: 8px">
          ${t("connection.auth.required")}
          <div style="margin-top: 6px">
            <span class="mono">genosos dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">genosos doctor --generate-gateway-token</span> → set token
          </div>
          <div style="margin-top: 6px">
            <a
              class="session-link"
              href="https://docs.genos.ai/web/dashboard"
              target="_blank"
              rel="noreferrer"
              title="Control UI auth docs (opens in new tab)"
              >Docs: Control UI auth</a
            >
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("connection.auth.failed", { command: "genosos dashboard --no-open" })}
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.genos.ai/web/dashboard"
            target="_blank"
            rel="noreferrer"
            title="Control UI auth docs (opens in new tab)"
            >Docs: Control UI auth</a
          >
        </div>
      </div>
    `;
  })();

  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    if (!lower.includes("secure context") && !lower.includes("device identity required")) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("connection.insecure.hint", { url: "http://127.0.0.1:18789" })}
        <div style="margin-top: 6px">
          ${t("connection.insecure.stayHttp", { config: "gateway.controlUi.allowInsecureAuth: true" })}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.genos.ai/gateway/tailscale"
            target="_blank"
            rel="noreferrer"
            title="Tailscale Serve docs (opens in new tab)"
            >Docs: Tailscale Serve</a
          >
          <span class="muted"> · </span>
          <a
            class="session-link"
            href="https://docs.genos.ai/web/control-ui#insecure-http"
            target="_blank"
            rel="noreferrer"
            title="Insecure HTTP docs (opens in new tab)"
            >Docs: Insecure HTTP</a
          >
        </div>
      </div>
    `;
  })();

  return html`
    <section>
      <div class="card">
        <div class="card-title">${t("connection.access.title")}</div>
        <div class="card-sub">${t("connection.access.subtitle")}</div>
        <form class="form-grid" style="margin-top: 16px;" @submit=${(e) => e.preventDefault()} autocomplete="off">
          <label class="field">
            <span>${t("connection.access.wsUrl")}</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e) => {
                const v = e.target.value;
                props.onSettingsChange({ ...props.settings, gatewayUrl: v });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          ${
            isTrustedProxy
              ? nothing
              : html`
              <label class="field">
                <span>${t("connection.access.token")}</span>
                <input
                  .value=${props.settings.token}
                  @input=${(e) => {
                    const v = e.target.value;
                    props.onSettingsChange({ ...props.settings, token: v });
                  }}
                  placeholder="GENOS_GATEWAY_TOKEN"
                />
              </label>
            `
          }
        </form>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onConnect()}>${props.connected ? "Reconnect" : t("common.connect")}</button>
          <span class="muted">${props.connected ? "Connected" : isTrustedProxy ? t("connection.access.trustedProxy") : t("connection.access.connectHint")}</span>
        </div>
        ${
          props.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
            <div>${props.lastError}</div>
            ${authHint ?? ""}
            ${insecureContextHint ?? ""}
          </div>`
            : nothing
        }
      </div>
    </section>
  `;
}
