iMessage:
Summary: macOS only. Requires imsg CLI + Full Disk Access for Bun. The #1 cause of "not connected" is missing Full Disk Access.

Prerequisites:
· macOS with Messages app signed into Apple ID
· imsg CLI: brew install steipete/tap/imsg
· Full Disk Access granted to Bun (or Terminal) in System Settings → Privacy & Security → Full Disk Access
· Automation permission for Messages.app (triggered on first imsg send)

Setup:

1. Verify imsg works: imsg rpc --help
2. Configure:
   config_manage set channels.imessage.enabled true
   config_manage set channels.imessage.cliPath "/usr/local/bin/imsg"
   · Apple Silicon Homebrew: /opt/homebrew/bin/imsg
   · dbPath defaults to ~/Library/Messages/chat.db — only set if non-standard location or remote Mac

Diagnostic (iMessage-specific):
· chat.db / permissions / access denied error → TELL user: Bun needs Full Disk Access. System Settings → Privacy & Security → Full Disk Access → add ~/.bun/bin/bun → restart gateway. This is the #1 cause.
· imsg binary error → check cliPath, verify path exists
· Probe running but not connected (no specific error) → restart gateway
· Non-standard dbPath → check channels.imessage.dbPath

Remote Mac (SSH):
config_manage set channels.imessage.cliPath "~/.genosv1/scripts/imsg-ssh"
config_manage set channels.imessage.remoteHost "user@mac-host"
config_manage set channels.imessage.includeAttachments true

SSH wrapper script (~/.genosv1/scripts/imsg-ssh):
#!/usr/bin/env bash
exec ssh -T user@mac-host imsg "$@"

Use SSH keys for non-interactive auth.

Group Messages:
config_manage set channels.imessage.groupPolicy allowlist
config_manage set channels.imessage.groupAllowFrom '["user@icloud.com"]'
iMessage has no native mention metadata — mention detection uses regex from agents.list[].groupChat.mentionPatterns.

Addressing (send targets):
· chat_id:123 — stable, recommended
· imessage:+15551234567 or sms:+15551234567 — by phone
· user@icloud.com — by email handle
· List chats: imsg chats --limit 20

iMessage-Specific Paths:
channels.imessage.cliPath: string, "imsg" — Path to imsg binary
channels.imessage.dbPath: string, ~/Library/Messages/chat.db — Messages database
channels.imessage.includeAttachments: boolean, false — Ingest inbound attachments
channels.imessage.remoteHost: string — SSH host for remote Mac
channels.imessage.textChunkLimit: number, 4000 — Max chars per message
channels.imessage.mediaMaxMb: number, 16 — Max outbound media size
