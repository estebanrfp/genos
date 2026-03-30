Discord:
Summary: Bot token from Developer Portal + Message Content Intent (CRITICAL). Snowflake IDs are always strings. Token starts with base64 segment (MTA4NDcw...), NOT hex. Public Key ≠ Bot Token.

Setup:

1. Create bot: discord.com/developers/applications → New Application → name → create → Bot sidebar → set Username
2. Enable Privileged Intents (CRITICAL):
   · Bot → Privileged Gateway Intents → enable:
   · Message Content Intent (required — without this, error 4014 crashes connection)
   · Server Members Intent (recommended — role allowlists, name resolution)
   · Presence Intent (optional)
   · Save changes
3. Copy Bot Token: Bot → Reset Token → copy
   WARNING: Do NOT copy Public Key or Application ID from General Information — those are NOT tokens. Public Key is hex and will fail with 401.
4. Add Bot to Server:
   · Installation → Guild Install → scopes: bot, applications.commands → permissions: Send Messages (minimum)
   · Recommended: View Channels, Read Message History, Embed Links, Attach Files, Add Reactions
   · Copy install link → paste in browser → select server → Continue
5. Get User IDs:
   · User Settings → Advanced → Developer Mode ON
   · Right-click server icon → Copy Server ID
   · Right-click own avatar → Copy User ID
6. Configure:
   config_manage set channels.discord.token "BOT_TOKEN_HERE"
   config_manage set channels.discord.enabled true
   Env fallback: DISCORD_BOT_TOKEN
   Auto-validates: checks token, verifies intents, detects guilds, auto-configures guild entries.

Diagnostic (Discord-specific):
· Error 4014 or Fatal Gateway error → Message Content Intent not enabled. TELL user: go to Developer Portal → Bot → Privileged Gateway Intents → enable Message Content Intent → restart gateway
· Error 401 or token verification failed → Wrong value set. TELL user: Bot Token ≠ Public Key. Go to Developer Portal → Bot → Reset Token → copy new token
· Connected but not responding in guild → check groupPolicy and guilds config (see below)
· For generic checks (dmPolicy, groupPolicy, allowFrom) → see channels-overview

Guild Workspace:
config_manage set channels.discord.groupPolicy allowlist
config_manage set channels.discord.guilds.SERVER_ID.requireMention false
config_manage set channels.discord.guilds.SERVER_ID.users '["USER_ID"]'

Each Discord channel gets its own isolated session (agent:{agentId}:discord:channel:{channelId}).

Restrict to specific channels:
config_manage set channels.discord.guilds.SERVER_ID.channels.CHANNEL_ID.allow true

Presence/Activity:
config_manage set channels.discord.activity "Working"
config_manage set channels.discord.activityType 4
· Types: 0=Playing, 1=Streaming (needs activityUrl), 2=Listening, 3=Watching, 4=Custom, 5=Competing
config_manage set channels.discord.status idle
· Status: online, idle, dnd, invisible

Role-Based Agent Routing:
config_manage set bindings '[{"agentId":"opus","match":{"channel":"discord","guildId":"SERVER_ID","roles":["ROLE_ID"]}}]'

Exec Approvals (Discord buttons):
config_manage set channels.discord.execApprovals.enabled true
config_manage set channels.discord.execApprovals.approvers '["USER_ID"]'
config_manage set channels.discord.execApprovals.target dm
· target: dm, channel, both

Ack Reaction:
config_manage set channels.discord.ackReaction "👀"
· Empty string disables: config_manage set channels.discord.ackReaction ""

History Context:
config_manage set channels.discord.historyLimit 20
config_manage set channels.discord.replyToMode off
· replyToMode: off, first, all

Action Gates:
config_manage set channels.discord.actions.moderation true
config_manage set channels.discord.actions.presence true
config_manage set channels.discord.actions.roles true

Interactive Components (v2):
· Send buttons, selects, modals via message tool with components payload
· Blocks: text, section, separator, actions, media-gallery, file
· Action rows: up to 5 buttons or 1 select
· components.reusable: true for multi-use
· components.modal for forms (up to 5 fields)
· allowedUsers on buttons restricts who can click

Discord-Specific Paths:
channels.discord.token: string — Bot token (secret)
channels.discord.guilds.{ID}: object — Per-guild config
channels.discord.guilds.{ID}.requireMention: boolean, true — Respond without @mention
channels.discord.guilds.{ID}.users: array, [] — Allowed user IDs
channels.discord.guilds.{ID}.roles: array, [] — Allowed role IDs
channels.discord.guilds.{ID}.channels.{ID}.allow: boolean — Channel allowlist
channels.discord.historyLimit: number, 20 — Guild message context
channels.discord.replyToMode: enum, off — off, first, all
channels.discord.ackReaction: string, agent emoji — Processing indicator
channels.discord.activity: string — Bot activity text
channels.discord.activityType: number, 4 — Activity type (0-5)
channels.discord.status: string — online, idle, dnd, invisible
channels.discord.textChunkLimit: number, 2000 — Max chars per message
channels.discord.commands.native: string, auto — Slash command registration
channels.discord.proxy: string — HTTP proxy for gateway
channels.discord.actions._: boolean — Action gates
channels.discord.execApprovals._: object — Button-based exec approvals
channels.discord.ui.components.accentColor: string — Component container color (hex)
