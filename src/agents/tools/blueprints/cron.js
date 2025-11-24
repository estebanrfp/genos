/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "cron.enabled",
    valueType: "scalar",
    enumValues: [true, false],
    guidance:
      "Enable or disable the cron scheduler globally. When disabled, no scheduled jobs fire.",
    examples: { set: true },
  },
  {
    pathPattern: "cron.store",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "File path for the cron SQLite database. Default: '~/.genosv1/cron.db'. Change to isolate cron state.",
    examples: { set: "~/.genosv1/cron.db" },
  },
  {
    pathPattern: "cron.maxConcurrentRuns",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Maximum number of cron jobs that can run simultaneously. Prevents resource exhaustion. Default: 3.",
    examples: { set: 3 },
  },
  {
    pathPattern: "cron.sessionRetention",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "How long to keep cron session transcripts. Duration string (e.g. '7d', '30d') or false to disable retention. Default: '7d'.",
    examples: { set: "7d" },
  },
  {
    pathPattern: "cron.webhookToken",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "Bearer token required to trigger cron jobs via the webhook endpoint. Leave empty to disable webhook triggers.",
    examples: { set: "my-secret-token" },
  },
];
