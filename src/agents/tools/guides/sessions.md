Sessions:
Summary: Sessions hold conversation history per contact/channel. Key decisions: reset mode (when to clear), maintenance (size limits), DM isolation (how contacts map to sessions).

Reset Modes:
· manual (default): Only via /reset command or reset triggers — full control, long-running conversations
· daily: Auto-reset at fixed hour — daily fresh start (morning briefing)
· idle: Auto-reset after inactivity timeout — support bots, ephemeral interactions

config_manage set session.reset.mode manual
config_manage set session.reset.mode daily
config_manage set session.reset.atHour 4 (0-23, default: 4, auto-set if not configured)
config_manage set session.reset.mode idle
config_manage set session.reset.idleMinutes 30 (default: 30, auto-set if not configured)

Cross-Field Dependencies:
· reset.mode='daily' REQUIRES reset.atHour — auto-defaulted to 4
· reset.mode='idle' REQUIRES reset.idleMinutes — auto-defaulted to 30

Custom Reset Triggers:
config_manage set session.resetTriggers "/reset"
config_manage set session.resetTriggers "/new"

Maintenance (session size control):
· warn: Log warnings for oversized sessions but don't prune — development, debugging
· enforce: Auto-prune/rotate past limits — production

config_manage set session.maintenance.mode enforce
config_manage set session.maintenance.pruneAfter "7d" (duration: 7d, 30d, etc.)
config_manage set session.maintenance.maxEntries 200 (max history entries, default: 200)
config_manage set session.maintenance.rotateBytes "1MB" (max transcript size, default: 1MB)

Cross-Field: maintenance.mode='enforce' REQUIRES pruneAfter — auto-defaulted to 7d

DM Session Isolation:
See channels-overview guide for full documentation.
config_manage set session.dmScope per-channel-peer

Agent-to-Agent:
config_manage set session.agentToAgent.maxPingPongTurns 2 (0=fire-and-forget, default: 2)

Tier Profiles:
Routing tiers can carry full profiles (model + thinking + verbose + reasoning).
When session_status model=complex (or normal), the full tier profile is applied.
When session_status model=default, all overrides (model + thinking + verbose + reasoning) are reset.
Config example:
"tiers": {
"normal": { "model": "anthropic/claude-sonnet-4-6", "thinking": "medium" },
"complex": { "model": "anthropic/claude-opus-4-6", "thinking": "high", "verbose": "on" }
}
String tiers ("anthropic/claude-sonnet-4-6") still work — treated as model-only, no profile overrides.

Operations:
config_manage sessions list
config_manage sessions get {sessionKey}
config_manage sessions patch {sessionKey} '{"model":"claude-sonnet-4-6","thinkingLevel":"low"}'
config_manage sessions reset {sessionKey}
config_manage sessions compact {sessionKey}
config_manage sessions delete {sessionKey}

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. config_manage sessions list — check session exists and state
2. Missing session:
   · Agent session → check config_manage agents list (agent may be deleted)
   · DM session → check session.dmScope (may need isolation change)
3. Too large (slow responses, high tokens) → config_manage sessions compact {key}. If recurring, set maintenance limits.
4. No auto-reset → check session.reset.mode (manual = no auto-reset). Check atHour/idleMinutes.
5. DMs in wrong session → check session.dmScope. per-channel-peer recommended.

Session Paths:
session.scope: enum, per-sender — per-sender, global
session.dmScope: enum, per-channel-peer — main, per-peer, per-channel-peer, per-account-channel-peer
session.mainKey: string, main — Custom main session key
session.idleMinutes: number, 30 — Global idle threshold
session.resetTriggers: array, [] — Message patterns that trigger reset
session.reset.mode: enum, manual — manual, daily, idle
session.reset.atHour: number, 4 — Hour for daily reset (0-23)
session.reset.idleMinutes: number, 30 — Idle timeout for reset
session.maintenance.mode: enum, warn — warn, enforce
session.maintenance.pruneAfter: string, 7d — Duration before prune (enforce mode)
session.maintenance.maxEntries: number, 200 — Max history entries
session.maintenance.rotateBytes: string, 1MB — Max transcript size
session.agentToAgent.maxPingPongTurns: number, 2 — A2A reply limit
