Slack:
Summary: Socket Mode (recommended) or HTTP mode. Requires App Token (xapp-...) + Bot Token (xoxb-...). Socket Mode must be enabled in Slack app settings.

Setup:

1. Create Slack App: api.slack.com/apps → Create New App → From scratch → name it, select workspace
2. Enable Socket Mode: Settings → Socket Mode → Enable → create App Token (xapp-...) with scope connections:write
3. Add Bot Scopes: OAuth & Permissions → Bot Token Scopes → add:
   · chat:write, channels:history, channels:read, groups:history
   · im:history, mpim:history, users:read, app_mentions:read
   · reactions:read, reactions:write, pins:read, pins:write
   · emoji:read, commands, files:read, files:write
   · assistant:write (streaming/typing indicators)
   · Optional: chat:write.customize (custom bot username/icon per message)
4. Subscribe to Events: Event Subscriptions → bot events:
   · app_mention, message.channels, message.groups, message.im, message.mpim
   · reaction_added, reaction_removed
   · member_joined_channel, member_left_channel, channel_rename
   · pin_added, pin_removed
5. Enable App Home: App Home → Messages Tab → Enable
6. Install App: Install to Workspace → copy Bot Token (xoxb-...)
7. Configure:
   config_manage set channels.slack.enabled true
   config_manage set channels.slack.mode socket
   config_manage set channels.slack.appToken "xapp-..."
   config_manage set channels.slack.botToken "xoxb-..."
   Env fallback: SLACK_APP_TOKEN, SLACK_BOT_TOKEN

HTTP Mode (alternative):
config_manage set channels.slack.mode http
config_manage set channels.slack.botToken "xoxb-..."
config_manage set channels.slack.signingSecret "your-signing-secret"
config_manage set channels.slack.webhookPath "/slack/events"
Set same URL for Event Subscriptions, Interactivity, and Slash Commands Request URL in Slack settings.

Diagnostic (Slack-specific):
· Check mode: config_manage get channels.slack.mode — socket or http
· Socket mode missing tokens → TELL user: Socket mode requires both App Token (xapp-...) and Bot Token (xoxb-...). Create them in Slack app settings.
· Socket connection refused → TELL user: Socket Mode may not be enabled. Go to Settings → Socket Mode → Enable.
· Auth error → token invalid or expired, ask user to regenerate
· No replies in channels → check groupPolicy — if allowlist, channels must be listed. Bot responds only to @mentions by default.
· DMs ignored → check dmPolicy. Also TELL user: verify App Home → Messages Tab is enabled in Slack app settings.
· HTTP mode not receiving → check signingSecret (config_manage get channels.slack.signingSecret). Verify webhook path matches Slack Request URLs.

Channel-Specific Config:
config_manage set channels.slack.channels.CHANNEL_ID.requireMention false
config_manage set channels.slack.channels.CHANNEL_ID.allow true
config_manage set channels.slack.channels.CHANNEL_ID.users '["USER_ID"]'

Slash Commands:
config_manage set channels.slack.commands.native true
(Register matching /commands in Slack app settings)

Thread Behavior:
config_manage set channels.slack.replyToMode first
· Options: off (default), first, all
config_manage set channels.slack.thread.historyScope thread
config_manage set channels.slack.thread.initialHistoryLimit 20

Ack Reaction:
config_manage set channels.slack.ackReaction "eyes"
(Slack uses shortcodes, not unicode)

Slack-Specific Paths:
channels.slack.mode: enum, socket — socket, http
channels.slack.botToken: string — Bot token xoxb-... (secret)
channels.slack.appToken: string — App token xapp-... (Socket Mode, secret)
channels.slack.signingSecret: string — Signing secret (HTTP mode, secret)
channels.slack.webhookPath: string, /slack/events — HTTP mode webhook path
channels.slack.channels.{ID}: object — Per-channel config
channels.slack.channels.{ID}.requireMention: boolean, true — Respond without @mention
channels.slack.channels.{ID}.users: array, [] — Allowed users
channels.slack.replyToMode: enum, off — off, first, all
channels.slack.historyLimit: number — Channel context messages
channels.slack.textChunkLimit: number, 4000 — Max chars per message
channels.slack.ackReaction: string, agent emoji — Processing indicator (shortcode)
channels.slack.commands.native: boolean, false — Enable slash commands
channels.slack.streaming: boolean, true — Text streaming via Agents API
channels.slack.userToken: string — Optional user token xoxp-...
