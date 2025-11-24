/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "security.vault.enabled",
    valueType: "scalar",
    guidance:
      "Enable/disable encrypted vault for all state files. When enabled, all files in ~/.genosv1/ are encrypted at rest with NYXENC1.",
    examples: { set: true },
  },
  {
    pathPattern: "security.vault.autoLockMinutes",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Auto-lock vault after N minutes of inactivity. Minimum 1. Set 0 to disable auto-lock.",
    examples: { set: 30 },
  },
  {
    pathPattern: "security.fortress.enabled",
    valueType: "scalar",
    guidance:
      "Enable Fortress Mode — audit log, rate limiting, Spotlight/Time Machine exclusion, vault auto-lock.",
    examples: { set: true },
    crossField: [
      {
        eq: true,
        message:
          "Fortress Mode is most effective with vault. Consider enabling security.vault.enabled.",
      },
    ],
  },
  {
    pathPattern: "security.fortress.auditLog",
    valueType: "scalar",
    guidance: "Enable audit logging of all sensitive operations when Fortress Mode is active.",
    examples: { set: true },
  },
  {
    pathPattern: "security.fortress.rateLimiting",
    valueType: "scalar",
    guidance: "Enable rate limiting on gateway endpoints when Fortress Mode is active.",
    examples: { set: true },
  },
  {
    pathPattern: "security.webauthn.enabled",
    valueType: "scalar",
    guidance:
      "Enable WebAuthn/Touch ID gate on sensitive operations. Managed via 'config_manage webauthn' sub-actions.",
    examples: { set: true },
  },
  {
    pathPattern: "security.webauthn.timeout",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "WebAuthn authentication timeout in milliseconds. Default: 60000 (1 minute).",
    examples: { set: 60000 },
  },
];
