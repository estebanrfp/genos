/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "agents.list.*.id",
    valueType: "scalar",
    guidance:
      "Unique agent identifier (lowercase, kebab-case). READ-ONLY via set — use 'config_manage agents rename {oldId} {newId}'. Directories use opaque IDs, so rename is instant with zero filesystem changes.",
  },
  {
    pathPattern: "agents.list.*.name",
    valueType: "scalar",
    guidance: "Display name for the agent. Free text.",
  },
  {
    pathPattern: "agents.list.*.model",
    valueType: "scalar",
    guidance:
      "Default model for this agent. Overrides agents.defaults.model.default. Use model id or alias (sonnet, opus, gpt, etc.).",
  },
  {
    pathPattern: "agents.list.*.identity.name",
    valueType: "scalar",
    guidance: "Agent identity name shown in chat. Can differ from agent id.",
  },
  {
    pathPattern: "agents.list.*.identity.emoji",
    valueType: "scalar",
    guidance: "Emoji displayed next to agent name in UI.",
  },
  {
    pathPattern: "agents.list.*.identity.avatar",
    valueType: "scalar",
    guidance: "Avatar URL or path for the agent.",
  },
  {
    pathPattern: "agents.list.*.workspace",
    valueType: "scalar",
    guidance:
      "Absolute path to the agent workspace directory. Contains AGENTS.md, SOUL.md, IDENTITY.md, etc.",
  },
  {
    pathPattern: "agents.list.*.default",
    valueType: "scalar",
    coerce: "boolean",
    guidance: "Whether this is the default agent. Only one agent can be default.",
  },
  {
    pathPattern: "agents.list.*.skills",
    valueType: "object",
    guidance: "Per-agent skill configuration overrides.",
  },
  {
    pathPattern: "agents.list.*.memorySearch",
    valueType: "object",
    guidance: "Per-agent memory search settings override.",
  },
  {
    pathPattern: "agents.list.*.tools.profile",
    valueType: "scalar",
    enumValues: ["minimal", "coding", "messaging", "full"],
    guidance:
      "Tool profile preset. 'minimal' = session_status only. 'coding' = fs+runtime+sessions+memory+image. 'messaging' = messaging+sessions. 'full' = all tools (default).",
  },
  {
    pathPattern: "agents.list.*.tools.allow",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Explicit allow list — overrides profile. Use tool names or group: prefixes (group:fs, group:runtime, group:web, group:memory, group:sessions, group:ui, group:messaging, group:automation, group:nodes, group:genosos).",
  },
  {
    pathPattern: "agents.list.*.tools.alsoAllow",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Additional tools to allow ON TOP of the profile. Same format as allow (names or group: prefixes).",
  },
  {
    pathPattern: "agents.list.*.tools.deny",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Tools to deny even if profile or allow would include them. Same format as allow.",
  },
  {
    pathPattern: "agents.list.*.tools.exec.denyBins",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Shell binaries blocked from exec tool. Default 14: sudo, su, doas, rm, ssh, scp, rsync, sftp, open, defaults, networksetup, scutil, launchctl, diskutil. Set [] for full trust.",
  },
  {
    pathPattern: "agents.list.*.tools.exec.safeBins",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Shell binaries always allowed without approval in exec tool.",
  },
  {
    pathPattern: "tools.exec.denyBins",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Global deny bins (applies to all agents without per-agent override). Same 14 defaults as per-agent.",
  },
  {
    pathPattern: "tools.exec.safeBins",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Global safe bins (applies to all agents without per-agent override).",
  },
  {
    pathPattern: "tools.exec.node",
    valueType: "scalar",
    guidance:
      "Node ID to pin command execution to. Use config_manage nodes list to see available nodes. Leave unset for gateway-local execution.",
  },
  {
    pathPattern: "agents.list.*.tools.exec.node",
    valueType: "scalar",
    guidance: "Per-agent node binding. Overrides global tools.exec.node for this agent.",
  },
  {
    pathPattern: "tools.channelRestrictions.*.deny",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Global channel tool restrictions. Deny specific tools per communication channel. External channels default to deny exec/bash/process. Voice defaults to minimal (deny exec/bash/process/write/edit/read/browser/canvas/nodes). webchat has no restrictions. Per-agent override via agents.list.*.tools.channelRestrictions.*.deny.",
  },
  {
    pathPattern: "agents.list.*.tools.channelRestrictions.*.deny",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Per-agent channel tool restrictions. Overrides global tools.channelRestrictions for this agent. Set deny to empty array [] to remove restrictions for a channel.",
  },
  {
    pathPattern: "tools.allow",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Global tool allow list (applies to all agents without per-agent override).",
  },
  {
    pathPattern: "tools.deny",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Global tool deny list (applies to all agents without per-agent override).",
  },

  // --- Subagent defaults ---
  {
    pathPattern: "agents.defaults.subagents.maxSpawnDepth",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Maximum nesting depth for sub-agent spawning. 1 = sub-agents cannot spawn children (default). 2 = orchestrator pattern (sub-agents can spawn workers). Max 5.",
    examples: { set: "2", remove: true },
  },
  {
    pathPattern: "agents.defaults.subagents.maxChildrenPerAgent",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Maximum active children a single agent session can spawn concurrently. Range 1–20, default 5.",
    examples: { set: "10", remove: true },
  },
  {
    pathPattern: "agents.defaults.subagents.maxConcurrent",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Global maximum concurrent sub-agent runs across all sessions. Default 8.",
    examples: { set: "12", remove: true },
  },
  {
    pathPattern: "agents.defaults.subagents.archiveAfterMinutes",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Minutes after a sub-agent completes before its session is archived. Default 60.",
    examples: { set: "120", remove: true },
  },
  {
    pathPattern: "agents.defaults.subagents.cleanup",
    valueType: "scalar",
    enumValues: ["keep", "delete"],
    guidance:
      'Default session lifecycle after sub-agent completion. "delete" = auto-delete session (default). "keep" = persist session in sidebar. ' +
      "Agents can override per-spawn via the keep parameter in sessions_spawn. " +
      'Use "keep" globally only if most sub-agent sessions need to persist (e.g. ongoing companions). ' +
      'Use "delete" (default) for transient task-oriented workflows.',
    examples: { set: "keep", remove: true },
  },
  {
    pathPattern: "agents.defaults.subagents.thinking",
    valueType: "scalar",
    guidance:
      "Default thinking level for all sub-agents. Values: off, minimal, low, medium, high, xhigh.",
    enumValues: ["off", "minimal", "low", "medium", "high", "xhigh"],
    examples: { set: "low", remove: true },
  },

  // --- Per-agent subagent overrides ---
  {
    pathPattern: "agents.list.*.subagents.allowAgents",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      'Agent IDs this agent is allowed to spawn as sub-agents. Use "*" to allow any agent. Supports wildcards like "*-helper".',
    examples: { set: "researcher,validator", remove: true },
  },
  {
    pathPattern: "agents.list.*.subagents.model",
    valueType: "scalar",
    guidance:
      "Model override for sub-agents spawned by this specific agent. Overrides the global default.",
    examples: { set: "claude-sonnet-4-6", remove: true },
  },
  {
    pathPattern: "agents.list.*.subagents.thinking",
    valueType: "scalar",
    guidance: "Thinking level for sub-agents spawned by this specific agent.",
    enumValues: ["off", "minimal", "low", "medium", "high", "xhigh"],
    examples: { set: "medium", remove: true },
  },

  // --- Agent-to-agent messaging (tools.agentToAgent → routed via BLUEPRINT_ROOT_MAP) ---
  {
    pathPattern: "tools.agentToAgent.enabled",
    valueType: "scalar",
    itemCoerce: "smart",
    guidance:
      "Master switch for inter-agent messaging via sessions_send. When false, all cross-agent calls are blocked. Default true (all agents can communicate).",
    examples: { set: "true", remove: true },
  },
  {
    pathPattern: "tools.agentToAgent.allow",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      'Agent IDs allowed for cross-agent messaging. Both sender and receiver must match. Supports globs like "*-bot". Empty = no cross-agent messaging.',
    examples: { set: "analyzer,researcher,*-bot", remove: true },
  },
];
