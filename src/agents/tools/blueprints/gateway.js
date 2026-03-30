/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "gateway.port",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Gateway HTTP port. Range: 1-65535. Default: 18789.",
    examples: { set: 18789 },
  },
  {
    pathPattern: "gateway.bind",
    valueType: "scalar",
    enumValues: ["auto", "loopback", "tailscale", "any"],
    guidance:
      "'auto' = loopback + Tailscale if available. 'loopback' = 127.0.0.1 only. 'tailscale' = Tailscale IP only. 'any' = 0.0.0.0 (all interfaces — use with caution).",
    examples: { set: "auto" },
  },
  {
    pathPattern: "gateway.mode",
    valueType: "scalar",
    enumValues: ["local", "remote"],
    guidance: "'local' = single-device setup. 'remote' = multi-device with external access.",
    examples: { set: "local" },
  },
  {
    pathPattern: "gateway.auth.token",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "Authentication token for gateway API access. Required by default. Sensitive value — will be masked in output.",
    examples: { set: "my-secret-token" },
  },
  {
    pathPattern: "gateway.auth.password",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Password for Control UI login. Sensitive value — will be masked in output.",
    examples: { set: "my-password" },
  },
  {
    pathPattern: "gateway.reload.mode",
    valueType: "scalar",
    enumValues: ["hybrid", "full", "none"],
    guidance:
      "'hybrid' = hot-reload config, full-reload channels. 'full' = restart everything on config change. 'none' = no auto-reload.",
    examples: { set: "hybrid" },
  },
  {
    pathPattern: "gateway.controlUi.basePath",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Base URL path for Control UI. Default: '/' (root). Change for reverse proxy setups.",
    examples: { set: "/" },
  },
  {
    pathPattern: "gateway.controlUi.allowedOrigins",
    valueType: "array",
    itemCoerce: "string",
    guidance: "CORS allowed origins for Control UI. Add one at a time with 'set'.",
    examples: { set: "https://my-domain.com" },
  },
  {
    pathPattern: "gateway.tls.enabled",
    valueType: "scalar",
    guidance: "Enable TLS/HTTPS on the gateway. Requires cert and key paths.",
    crossField: [
      { field: "cert", eq: true, message: "tls.enabled=true requires tls.cert path to be set." },
      { field: "key", eq: true, message: "tls.enabled=true requires tls.key path to be set." },
    ],
    examples: { set: true },
  },
  {
    pathPattern: "gateway.tls.cert",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Path to TLS certificate file (PEM format).",
    examples: { set: "/path/to/cert.pem" },
  },
  {
    pathPattern: "gateway.tls.key",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Path to TLS private key file (PEM format).",
    examples: { set: "/path/to/key.pem" },
  },
];
