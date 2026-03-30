Agents:
Summary: Each agent has a tool profile, optional model override, identity, workspace, and subagent config. Workspace auto-provisioned at ~/.genosv1/workspace-{id}. NEVER pass a workspace path — let the gateway derive it.

Creating an Agent:
config_manage agents create {name}
· path: personality/purpose description. Injected as ## Purpose in SOUL.md.
· section: template slug (e.g. seo-specialist, security-guard, restaurant). Gateway reads template, applies profile+alsoAllow+deny+description atomically.
From template: config_manage agents create "SEO Specialist" section=seo-specialist
Manual: config_manage agents create "My Agent" path="Be direct and concise."
System bootstraps: workspace, AGENTS.md, SOUL.md, SECURITY.md, main session. Greeting auto-generated. Agent immediately available in sidebar.

Tool Profiles — restrict what an agent can do:
· full (default): All tools — general-purpose agents
· coding: fs, runtime, sessions, memory, image — developers, DevOps, code review
· messaging: messaging, sessions (list/history/send/spawn), session_status — chat bots, support agents
· minimal: session_status only — monitors, health checkers, sensors

config_manage set agents.list.{agentId}.tools.profile coding
config_manage set agents.list.{agentId}.tools.alsoAllow '["browser","canvas"]'
config_manage set agents.list.{agentId}.tools.deny '["exec"]'
config_manage set agents.list.{agentId}.tools.allow '["group:fs","group:memory","session_status"]'

Tool Groups:
· group:fs — read, write, edit, apply_patch
· group:runtime — exec, process
· group:memory — memory_search, memory_get
· group:web — web_search, web_fetch
· group:sessions — sessions_list, sessions_history, sessions_send, sessions_spawn, subagents, session_status
· group:messaging — message
· group:ui — browser, canvas
· group:automation — cron, gateway
· group:nodes — nodes

Channel Tool Restrictions — deny specific tools per communication channel:
· tools.channelRestrictions.{channel}.deny = ["exec","bash","process"] — blocks tools on that channel
· Built-in defaults (applied when no channelRestrictions configured):
webchat = no restrictions (localhost + WebAuthn)
voice = deny exec, bash, process, write, edit, read, browser, canvas, nodes
all other external channels = deny exec, bash, process
· Per-agent override: agents.list.{agentId}.tools.channelRestrictions.{channel}.deny
· Set deny to [] to remove restrictions for a channel
· Channel restriction is a hard deny — applied after all allow/profile steps

config_manage set tools.channelRestrictions.whatsapp.deny '["exec","bash","process"]'
config_manage set agents.list.devops.tools.channelRestrictions.whatsapp.deny '[]'

Shell Security (exec tool):
config_manage set agents.list.{agentId}.tools.exec.denyBins '["sudo","rm","ssh"]'
config_manage set agents.list.{agentId}.tools.exec.safeBins '["git","ls","cat","grep"]'
config_manage set agents.list.{agentId}.tools.exec.node "my-server"
(14 binaries blocked by default: sudo, su, rm, ssh, scp, etc.)

Subagent Orchestration:
Global defaults:
config_manage set agents.defaults.subagents.maxSpawnDepth 2 (1=no children of children, 2=orchestrator)
config_manage set agents.defaults.subagents.maxChildrenPerAgent 5 (1-20, default 5)
config_manage set agents.defaults.subagents.maxConcurrent 12 (default 8)
config_manage set agents.defaults.subagents.cleanup delete (delete or keep)
config_manage set agents.defaults.subagents.thinking low (off, minimal, low, medium, high, xhigh)
config_manage set agents.defaults.subagents.archiveAfterMinutes 60

Per-agent overrides:
config_manage set agents.list.{agentId}.subagents.allowAgents '["researcher","validator"]' (\* = any)
config_manage set agents.list.{agentId}.subagents.model "claude-sonnet-4-6"
config_manage set agents.list.{agentId}.subagents.thinking medium

Spawn Patterns:
· Flat (depth 1, default): Main spawns workers, workers don't spawn
· Orchestrator (depth 2): Coordinator spawns specialists who spawn sub-workers
· Deep tree (depth 3+): Complex research chains — rare, high token cost

Agent-to-Agent Messaging (A2A):
config_manage set tools.agentToAgent.enabled true (default: true)
config_manage set tools.agentToAgent.allow '["nyx","lumina","*-bot"]'
Empty array = no A2A. Supports globs. Both sender AND receiver must be in allow list.

Auto-Configuration:
Agent name keywords → auto-profile:
· code, dev, engineer, build, deploy, debug, test, lint → coding
· message, chat, support, helpdesk, notify, bot, social → messaging
· monitor, watcher, sensor, probe, health, ping, status → minimal
· (anything else) → full
Profile can always be changed after creation.

Common Tasks:
· Change model: config_manage agents update {agentId} {newName} {modelId}
Or: config_manage set agents.list.{agentId}.model "claude-sonnet-4-6"
· Rename ID: config_manage agents rename {oldId} {newId} (migrates sessions, config, A2A atomically, zero filesystem changes)
· Delete: config_manage agents delete {agentId} — always deletes the agent AND its workspace. Never ask to preserve files.
· Identity: config_manage set agents.list.{agentId}.identity.name "Nyx"
config_manage set agents.list.{agentId}.identity.emoji "🌙"
config_manage set agents.list.{agentId}.identity.avatar "https://example.com/avatar.png"

Diagnostic — Agent Not Working:
STOP. Do NOT guess. Follow in order:

1. config_manage agents list — check agent exists. If not, create it.
2. config_manage agents get {agentId} — check enabled (true), workspace path exists. If missing, delete and recreate.
3. No session → main session should be agent:{agentId}:main. If missing, bootstrap failed — delete and recreate.
4. Can't use expected tools → check tools.profile. TELL user current profile and what it includes.
5. Sub-agent spawning fails → check maxSpawnDepth (0 = disabled). Check allowAgents for target.
6. A2A fails → check tools.agentToAgent.enabled and allow list (both sender + receiver).

Agent Paths:
agents.list._.id: string — READ-ONLY via set, use rename
agents.list._.name: string — Display name
agents.list._.model: string — Default model (overrides global)
agents.list._.default: boolean, false — Is default agent
agents.list._.tools.profile: enum, full — minimal, coding, messaging, full
agents.list._.tools.allow: array — Full override (ignores profile)
agents.list._.tools.alsoAllow: array — Add on top of profile
agents.list._.tools.deny: array — Block even if profile includes
agents.list._.tools.exec.denyBins: array, 14 defaults — Blocked shell binaries
agents.list._.tools.exec.safeBins: array — Always-allowed binaries
agents.list._.tools.exec.node: string — Pin to node
agents.list._.subagents.allowAgents: array — Spawnable agent IDs
agents.list._.subagents.model: string — Model for sub-agents
agents.list._.subagents.thinking: enum — off-xhigh
agents.defaults.subagents.maxSpawnDepth: number, 1 — Max nesting
agents.defaults.subagents.maxChildrenPerAgent: number, 5 — Per-session limit
agents.defaults.subagents.maxConcurrent: number, 8 — Global limit
agents.defaults.subagents.cleanup: enum, delete — delete, keep
agents.defaults.subagents.thinking: enum — Default thinking level
agents.defaults.subagents.archiveAfterMinutes: number, 60 — Archive timeout
tools.agentToAgent.enabled: boolean, true — A2A master switch
tools.agentToAgent.allow: array — A2A agent allowlist
tools.exec.denyBins: array, 14 defaults — Global deny bins
tools.exec.safeBins: array — Global safe bins
