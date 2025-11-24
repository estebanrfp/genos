/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "commands.native",
    valueType: "scalar",
    enumValues: [true, false],
    guidance:
      "Enable native channel commands (slash commands in Discord, Telegram, etc.). Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "commands.nativeSkills",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Register skill commands as native channel commands. Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "commands.text",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable text-based command parsing (/command in messages). Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "commands.bash",
    valueType: "scalar",
    enumValues: [true, false],
    guidance:
      "Enable bash chat commands (!command). Runs shell commands from chat. Default: false. Use with caution.",
    examples: { set: false },
  },
  {
    pathPattern: "commands.bashForegroundMs",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Timeout in ms before a bash command is sent to background. Default: 5000.",
    examples: { set: 5000 },
  },
  {
    pathPattern: "commands.config",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable /config command in chat. Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "commands.debug",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable /debug command in chat. Default: false.",
    examples: { set: false },
  },
  {
    pathPattern: "commands.restart",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enable /restart command in chat. Default: true.",
    examples: { set: true },
  },
  {
    pathPattern: "commands.useAccessGroups",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Enforce access group restrictions on commands. Default: false.",
    examples: { set: false },
  },
  {
    pathPattern: "commands.ownerAllowFrom",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Sender IDs allowed to use owner-level commands. Add one at a time.",
    examples: { set: "+34660123456" },
  },
];
