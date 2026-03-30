/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "hooks.enabled",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable the webhook HTTP endpoint. When disabled, no webhook requests are accepted.",
    examples: { set: true },
  },
  {
    pathPattern: "hooks.path",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "URL path prefix for the webhook endpoint. Default: '/hooks'.",
    examples: { set: "/hooks" },
  },
  {
    pathPattern: "hooks.token",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "Bearer authentication token for webhook requests. Sensitive — will be masked in output.",
    examples: { set: "my-webhook-secret" },
  },
  {
    pathPattern: "hooks.defaultSessionKey",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Default session key for webhook-triggered conversations. Default: 'hooks'.",
    examples: { set: "hooks" },
  },
  {
    pathPattern: "hooks.allowRequestSessionKey",
    valueType: "scalar",
    enumValues: [true, false],
    guidance:
      "Allow webhook callers to specify a custom session key in the request. Default: false.",
    examples: { set: false },
  },
  {
    pathPattern: "hooks.allowedSessionKeyPrefixes",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Restrict which session key prefixes are allowed when allowRequestSessionKey=true.",
    examples: { set: "webhook:" },
  },
  {
    pathPattern: "hooks.allowedAgentIds",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Restrict which agent IDs can be targeted by webhook requests. Empty = all agents allowed.",
    examples: { set: "main" },
  },
  {
    pathPattern: "hooks.maxBodyBytes",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Maximum webhook request body size in bytes. Default: 524288 (512 KB).",
    examples: { set: 524288 },
  },
  {
    pathPattern: "hooks.presets",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Bundled webhook integration presets. Available: 'gmail'. Adds pre-configured routes.",
    examples: { set: "gmail" },
  },
  {
    pathPattern: "hooks.gmail.account",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Gmail address for the Gmail webhook preset. Required when 'gmail' is in presets.",
    examples: { set: "user@gmail.com" },
  },
];
