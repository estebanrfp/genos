/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "env.shellEnv.enabled",
    valueType: "scalar",
    enumValues: [true, false],
    guidance:
      "Capture shell environment variables on startup. Provides $PATH, locale, etc. to exec. Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "env.shellEnv.timeoutMs",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Timeout in ms for shell environment capture. Default: 5000.",
    examples: { set: 5000 },
  },
  {
    pathPattern: "update.channel",
    valueType: "scalar",
    enumValues: ["stable", "beta", "dev"],
    guidance:
      "'stable' = production releases. 'beta' = pre-release features. 'dev' = latest builds (may be unstable).",
    examples: { set: "stable" },
  },
  {
    pathPattern: "update.checkOnStart",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Check for updates when the gateway starts. Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "plugins.enabled",
    valueType: "scalar",
    enumValues: [true, false],
    guidance:
      "Enable plugin loading. When disabled, no plugins are loaded regardless of allow/deny lists.",
    examples: { set: true },
  },
  {
    pathPattern: "plugins.allow",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Plugin allowlist. Only these plugins will be loaded. Empty = all allowed (minus deny).",
    examples: { set: "my-plugin" },
  },
  {
    pathPattern: "plugins.deny",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Plugin denylist. These plugins will never be loaded, even if in allow list.",
    examples: { set: "untrusted-plugin" },
  },
  {
    pathPattern: "diagnostics.flags",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Diagnostic flags for troubleshooting. Each flag enables specific debug output.",
    examples: { set: "http-trace" },
  },
  {
    pathPattern: "diagnostics.cacheTrace.enabled",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable cache trace logging. Logs cache hits/misses for debugging. Default: false.",
    examples: { set: false },
  },
  {
    pathPattern: "canvasHost.enabled",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable the canvas host server for interactive visual tools. Default: false.",
    examples: { set: false },
  },
  {
    pathPattern: "canvasHost.port",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Canvas host server port. Default: 18790. Range: 1-65535.",
    examples: { set: 18790 },
  },
  {
    pathPattern: "canvasHost.liveReload",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable live reload for canvas previews during development. Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "discovery.mdns.mode",
    valueType: "scalar",
    enumValues: ["minimal", "full", "off"],
    guidance:
      "'minimal' = broadcast name only. 'full' = broadcast name + capabilities. 'off' = no mDNS.",
    examples: { set: "minimal" },
  },
  {
    pathPattern: "broadcast.strategy",
    valueType: "scalar",
    enumValues: ["parallel", "sequential"],
    guidance:
      "'parallel' = send to all channels simultaneously. 'sequential' = send one-by-one in order.",
    examples: { set: "parallel" },
  },
  {
    pathPattern: "media.preserveFilenames",
    valueType: "scalar",
    enumValues: [true, false],
    guidance:
      "Preserve original filenames for media files. When false, files are renamed to hashes. Default: false.",
    examples: { set: false },
  },
];
