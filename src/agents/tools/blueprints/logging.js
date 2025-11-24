/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "logging.level",
    valueType: "scalar",
    enumValues: ["silent", "fatal", "error", "warn", "info", "debug", "trace"],
    guidance:
      "Log verbosity level. 'info' is the default. Use 'debug' or 'trace' for troubleshooting, 'error' or 'silent' for production.",
    examples: { set: "info" },
  },
  {
    pathPattern: "logging.file",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "Log file path. Default: '~/.genosv1/logs/gateway.log'. Set empty to disable file logging.",
    examples: { set: "~/.genosv1/logs/gateway.log" },
  },
  {
    pathPattern: "logging.consoleLevel",
    valueType: "scalar",
    enumValues: ["silent", "fatal", "error", "warn", "info", "debug", "trace"],
    guidance:
      "Console-only log level override. When set, console shows this level while file uses logging.level. Unset = same as logging.level.",
    examples: { set: "warn" },
  },
  {
    pathPattern: "logging.consoleStyle",
    valueType: "scalar",
    enumValues: ["pretty", "compact", "json"],
    guidance:
      "'pretty' = colorized human output. 'compact' = one line per entry. 'json' = structured JSON lines.",
    examples: { set: "pretty" },
  },
  {
    pathPattern: "logging.redactSensitive",
    valueType: "scalar",
    enumValues: ["off", "tools"],
    guidance: "'off' = no redaction. 'tools' = redact tokens and keys in tool call summaries.",
    examples: { set: "tools" },
  },
  {
    pathPattern: "logging.redactPatterns",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Additional regex patterns to redact from logs. Added on top of built-in patterns.",
    examples: { set: "sk-[a-zA-Z0-9]+" },
  },
];
