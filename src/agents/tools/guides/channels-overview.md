Channels Overview:
Summary: Every channel uses a layered security model. Understand policies before configuring any channel. This guide covers all common patterns — channel-specific guides only cover what is unique to that channel.

Policy Hierarchy:
dmPolicy → allowFrom → groupPolicy → allowGroups → groupAllowFrom

DM Policy (who can DM the bot):
· pairing (default): Unknown senders get pairing code; owner approves via genosos pairing approve
· allowlist: Only IDs in allowFrom can interact
· open: Accept DMs from anyone (requires allowFrom=['*'])
· disabled: Ignore all DMs

config_manage set channels.{channel}.dmPolicy allowlist
config_manage set channels.{channel}.allowFrom "34660777328"

Open mode (requires wildcard):
config_manage set channels.{channel}.dmPolicy open
config_manage set channels.{channel}.allowFrom '["*"]'

Group Policy (which groups the bot responds in):
· allowlist (default): Only respond in groups listed in allowGroups
· open: Respond in all groups the bot is a member of
· off: Ignore all group messages

config_manage set channels.{channel}.groupPolicy allowlist
config_manage set channels.{channel}.allowGroups '"-1001234567890"'
config_manage set channels.{channel}.groupAllowFrom '["user-id-1","user-id-2"]'

Cross-Field Dependencies:
· dmPolicy='open' REQUIRES allowFrom=['*']
· groupPolicy='allowlist' REQUIRES at least one entry in allowGroups

DM Session Isolation:
· per-channel-peer (default): One session per contact per channel — WhatsApp Alice ≠ Telegram Alice
· per-peer: One session per contact across all channels — unified identity
· per-account-channel-peer: Per contact per account per channel — multi-account setups
· main: All DMs share the main session (legacy)

config_manage set session.dmScope per-channel-peer

Channel Setup Tiers:

Interactive (modal):
· WhatsApp — QR scan: config_manage channels whatsapp.setup
· Telegram — token + pairing: config_manage channels telegram.setup

Conversational (guide):
· config_manage channels discord.setup
· config_manage channels imessage.setup
· config_manage channels slack.setup
· config_manage channels signal.setup
· config_manage channels nostr.setup
· config_manage channels matrix.setup

Each guide includes: setup steps, channel-specific diagnostics, unique config, paths.

Pairing Flow (common to all channels):
User DMs the bot → receives pairing code → owner approves:
genosos pairing list {channel}
genosos pairing approve {channel} CODE
Codes expire after 1 hour.

Diagnostic — Channel Not Working:
STOP. Do NOT guess. Follow in order — resolve what you can, inform what you know, ask only what you cannot determine:

1. Run config_manage channels status — identify channel state (connected, running, error, disabled)
2. If disabled → enable: config_manage set channels.{channel}.enabled true
3. If error → load channel-specific guide: config_manage channels {channel}.setup
4. If running but bot doesn't respond:
   · Check dmPolicy: config_manage get channels.{channel}.dmPolicy — if pairing, sender may be pending
   · Check groupPolicy: config_manage get channels.{channel}.groupPolicy — if allowlist, group must be in allowGroups
   · Check allowFrom: config_manage get channels.{channel}.allowFrom — sender must be listed
5. If responds in DMs but not groups: groupPolicy may be off or group not in allowGroups. Some channels require @mention by default.
6. If DMs create wrong sessions: check session.dmScope — use per-channel-peer (recommended)

Common Patterns:

Personal Phone (WhatsApp/iMessage):
config_manage set channels.{channel}.dmPolicy allowlist
config_manage set channels.{channel}.allowFrom '["your-id"]'
config_manage set channels.{channel}.selfChatMode true (WhatsApp only)

Dedicated Bot Account (Telegram/Discord):
config_manage set channels.{channel}.dmPolicy pairing
(Users DM bot → pairing code → owner approves)

Public Bot:
config_manage set channels.{channel}.dmPolicy open
config_manage set channels.{channel}.allowFrom '["*"]'
config_manage set channels.{channel}.groupPolicy open

Group-Only Bot:
config_manage set channels.{channel}.dmPolicy disabled
config_manage set channels.{channel}.groupPolicy allowlist
config_manage set channels.{channel}.allowGroups '["group-id"]'

Common Config Paths:
channels._.enabled: boolean, false — Enable/disable channel
channels._.dmPolicy: enum, pairing — open, allowlist, pairing, disabled
channels._.allowFrom: array, [] — Sender allowlist (also send targets)
channels._.groupPolicy: enum, allowlist — open, allowlist, off
channels._.allowGroups: array, [] — Group allowlist
channels._.groupAllowFrom: array, [] — Sender allowlist within groups
channels._.replyMode: enum, reply — reply, quote, none
channels._.displayName: string — Override agent name in channel
channels._.accountId: string — Multi-account identifier
channels._.textChunkLimit: number — Max chars per message
channels._.mediaMaxMb: number — Max outbound media size
channels._.configWrites: boolean, true — Allow /config from chat
session.dmScope: enum, per-channel-peer — DM session isolation level
session.scope: enum, per-sender — per-sender, global
