/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "session.scope",
    valueType: "scalar",
    enumValues: ["per-sender", "global"],
    guidance:
      "'per-sender' = each sender gets their own session. 'global' = all senders share one session.",
    examples: { set: "per-sender" },
  },
  {
    pathPattern: "session.dmScope",
    valueType: "scalar",
    enumValues: ["main", "per-peer", "per-channel-peer", "per-account-channel-peer"],
    guidance:
      "DM session isolation level (default: 'per-channel-peer'). 'per-channel-peer' = per contact per channel. 'per-peer' = per contact across channels. 'per-account-channel-peer' = per contact per account per channel. 'main' = all DMs share the main session (legacy).",
    examples: { set: "per-peer" },
  },
  {
    pathPattern: "session.mainKey",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Custom key for the main session. Default: 'main'.",
    examples: { set: "main" },
  },
  {
    pathPattern: "session.idleMinutes",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Minutes of inactivity before a session is considered idle. Used by idle-based reset. Default: 30.",
    examples: { set: 30 },
  },
  {
    pathPattern: "session.resetTriggers",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Message patterns that trigger a session reset. Add one at a time with 'set'. Use 'remove' to delete.",
    examples: { set: "/reset" },
  },
  {
    pathPattern: "session.reset.mode",
    valueType: "scalar",
    enumValues: ["daily", "idle", "manual"],
    guidance:
      "'daily' = auto-reset at a fixed hour. 'idle' = reset after idle timeout. 'manual' = only via /reset or reset trigger.",
    examples: { set: "manual" },
    crossField: [
      { eq: "daily", message: "reset.mode='daily' requires reset.atHour (0–23). Default: 4." },
      { eq: "idle", message: "reset.mode='idle' requires reset.idleMinutes. Default: 30." },
    ],
  },
  {
    pathPattern: "session.reset.atHour",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Hour of day (0-23) for daily reset. Only used when reset.mode='daily'. Default: 4 (4 AM).",
    examples: { set: 4 },
  },
  {
    pathPattern: "session.reset.idleMinutes",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Idle timeout in minutes for session reset. Only used when reset.mode='idle'. Default: 30.",
    examples: { set: 30 },
  },
  {
    pathPattern: "session.maintenance.mode",
    valueType: "scalar",
    enumValues: ["enforce", "warn"],
    guidance:
      "'enforce' = automatically prune/rotate sessions. 'warn' = log warnings but don't prune.",
    examples: { set: "enforce" },
    crossField: [
      {
        eq: "enforce",
        message: "maintenance.mode='enforce' requires maintenance.pruneAfter (e.g. '7d').",
      },
    ],
  },
  {
    pathPattern: "session.maintenance.pruneAfter",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "Duration string after which inactive sessions are pruned (e.g. '7d', '30d'). Only when mode='enforce'.",
    examples: { set: "7d" },
  },
  {
    pathPattern: "session.maintenance.maxEntries",
    valueType: "scalar",
    itemCoerce: "number",
    guidance: "Maximum number of history entries per session before rotation. Default: 200.",
    examples: { set: 200 },
  },
  {
    pathPattern: "session.maintenance.rotateBytes",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Max transcript size before rotation (e.g. '1MB', '500KB'). Default: '1MB'.",
    examples: { set: "1MB" },
  },

  // --- Agent-to-agent session config ---
  {
    pathPattern: "session.agentToAgent.maxPingPongTurns",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Maximum reply-back turns in agent-to-agent conversations. 0 = fire-and-forget, 1–5 = multi-turn exchange. Default 2.",
    examples: { set: "3", remove: true },
  },
];
