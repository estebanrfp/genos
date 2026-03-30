# GenosOS Conversational Configuration Guide

GenosOS is configured by talking to the assistant — not by clicking through panels. The `config_manage` tool handles everything behind the scenes: you speak naturally, the agent resolves the right action, blueprints validate and coerce values, and browser overlays fire when visual interaction is needed.

## How It Works

1. You say what you want in plain language
2. The agent resolves the intent to a `config_manage` action + sub-action
3. Blueprints validate types, coerce values, and enforce cross-field rules
4. If visual interaction is required (QR code, chart, kanban board), a browser overlay opens automatically

## Quick Reference

All 26 actions available through natural language:

| Action      | What it does                           | Example phrase                    |
| ----------- | -------------------------------------- | --------------------------------- |
| `sections`  | List all config sections               | "What can I configure?"           |
| `view`      | Show a section's key-values            | "Show me the channels config"     |
| `get`       | Read a config value                    | "What model am I using?"          |
| `set`       | Write a config value (validated)       | "Set the gateway port to 8080"    |
| `remove`    | Remove an array element                | "Remove that relay from Nostr"    |
| `describe`  | Help text + valid options for a path   | "Describe gateway options"        |
| `status`    | Gateway status summary                 | "Show me the gateway status"      |
| `webauthn`  | Manage Touch ID credentials            | "Register my fingerprint"         |
| `channels`  | Manage communication channels          | "Connect WhatsApp"                |
| `usage`     | Query usage analytics                  | "How much did I spend this week?" |
| `tools`     | Manage agent tool policies             | "Show me the tools"               |
| `sessions`  | Manage active sessions                 | "List all sessions"               |
| `cron`      | Manage scheduled jobs                  | "Show me the cron board"          |
| `logs`      | View gateway logs                      | "Show me error logs"              |
| `nodes`     | List nodes and exec binding            | "What nodes are connected?"       |
| `devices`   | Manage paired devices                  | "List paired devices"             |
| `approvals` | Exec security/approval policies        | "Show the approval policy"        |
| `files`     | Browse/manage workspace files          | "Open the file browser"           |
| `skills`    | Manage agent skills                    | "Show me the skills"              |
| `providers` | Manage AI provider credentials         | "List my providers"               |
| `models`    | Model selection and fallbacks          | "Switch to Sonnet"                |
| `tts`       | Text-to-speech config                  | "Enable TTS"                      |
| `memory`    | Memory/search configuration            | "What memory backend am I using?" |
| `agents`    | Manage agents (create, rename, delete) | "Create an SEO agent"             |
| `security`  | Alias for tools status overlay         | "Show security tools"             |
| `backup`    | Create, list, verify, restore backups  | "Create a backup"                 |

## Providers & Models

**Providers — credentials and API keys:** (shows inline status-grid)

- "Show me my providers" — inline status-grid in chat
- "List my providers"
- "Add an OpenAI API key"
- "Pause the Anthropic provider"
- "Resume OpenAI"
- "Delete the Gemini credential"
- "Which providers are enabled?"

**Models — selection, fallbacks, aliases:**

- "What model am I using?"
- "Switch to Sonnet"
- "Set the default model to openai/gpt-5.2"
- "Add Claude Haiku as a fallback"
- "Remove the fallback model"
- "List available models"
- "Show model aliases"

## Agents & Tools

**Tool policies — allow, deny, profiles:**

- "Show me the tools" — opens the interactive tools status overlay
- "Set the tool profile to coding"
- "Allow the exec tool"
- "Deny the browser tool"
- "Remove exec from the deny list"
- "Set safe binaries to git and curl"
- "Show global tool config"

**Exec approvals — security policies:**

- "Show the approval policy"
- "Set security mode to allowlist"
- "Set ask mode to always"
- "Enable auto-allow for skills"
- "Add 'git \*' to the exec allowlist"
- "Remove that pattern from the allowlist"

## Agent Delegation

**Creating agents — automatic communication wiring:**

When you create an agent, GenosOS automatically enables agent-to-agent communication and adds it to the allow list. No extra configuration needed.

- "Create an SEO agent" — creates agent + auto-wires delegation
- "Create a researcher agent" — ready to receive work immediately
- "Delete the SEO agent" — removes agent + cleans all delegation references

**Subagent defaults — global limits:**

- "Set the max spawn depth to 2" — orchestrator pattern (agents can spawn sub-agents)
- "Limit concurrent sub-agents to 12"
- "Set the sub-agent archive time to 120 minutes"
- "Set sub-agent thinking to low"
- "What is the max children per agent?"
- "Describe agents.defaults.subagents" — full guidance for all subagent settings

**Per-agent delegation overrides:**

- "Allow the SEO agent to spawn researcher and writer"
- "Set the SEO agent's sub-agent model to claude-sonnet-4-6"
- "Set the SEO agent's sub-agent thinking to medium"
- "Which agents can the SEO agent spawn?"

**Agent-to-agent messaging:**

- "Enable agent-to-agent messaging" — master switch
- "Allow analyzer and researcher for cross-agent messaging"
- "Add \*-bot to the agent messaging allow list"
- "Disable agent-to-agent messaging"

**Ping-pong turns:**

- "Set the max ping-pong turns to 3" — limits reply-back depth
- "Set ping-pong to 0" — fire-and-forget mode
- "What is the current ping-pong limit?"

## Channels

**Status and health:**

- "What channels do I have configured?"
- "Which channels are connected?"
- "Run a health check on the channels" — real connectivity probe

**Enable and disable:**

- "Enable Telegram"
- "Disable Discord"
- "Turn off the Signal channel"

**WhatsApp:** (opens QR overlay)

- "Connect WhatsApp" — QR modal appears, scan it, done
- "Disconnect WhatsApp"

**Telegram:**

- "Add ID 34660777328 to the Telegram allowed list"
- "Remove that number from Telegram"
- "Set DM policy to allowlist"
- "Who is on the Telegram allowed list?"

**Discord:**

- "Add user 123456789012345678 to Discord"
- "Set Discord status to 'Playing with AI'"
- "Change Discord activity type to Watching"

**Nostr:** (opens profile overlay)

- "Edit the Nostr profile" — form modal appears
- "Add relay wss://relay.damus.io"
- "Remove that relay"
- "What relays do I have configured?"

**iMessage:**

- "Add my number to the iMessage allowed list"
- "Who can message me on iMessage?"

**Any channel — common operations:**

- "Set Telegram group policy to allowlist"
- "Add this group to the allowed list"
- "Change Discord reply mode to quote"

## Messages & TTS

**TTS — text-to-speech:**

- "Enable TTS"
- "Disable TTS"
- "What TTS provider am I using?"
- "Switch TTS to Kokoro"
- "List available TTS providers"
- "Set auto-TTS to always"
- "Change the Kokoro voice to af_heart"

**Messages config:**

- "Describe messages options"
- "What is the TTS auto mode?"

## Sessions

- "List all sessions"
- "Show me session details for dm-telegram-123"
- "Set thinking level to high for that session"
- "Change the session label to 'Research'"
- "Delete that session"
- "Reset the current session"
- "Compact the session transcript"

## Cron & Automation

- "List all cron jobs"
- "Show the cron scheduler status"
- "Add a daily reminder at 9am"
- "Update the morning job schedule"
- "Disable that cron job"
- "Remove the backup job"
- "Run the report job now"
- "Show run history for that job"
- "Show me the cron board" — opens kanban overlay

## Files & Skills

**Workspace files:**

- "Open the file browser" — opens browser overlay
- "List all workspace files"
- "Show me the AGENTS.md content"
- "Update the SOUL.md file"

**Skills:**

- "Show me the skills" — inline data-table in chat
- "List enabled skills"
- "Enable the tavily skill"
- "Disable that skill"
- "Set the API key for tavily"
- "Install a new skill"

## Security

**WebAuthn / Touch ID:**

- "Register my fingerprint" — Touch ID modal appears
- "What Touch ID credentials do I have?"
- "Remove the iPhone credential"
- "Rename my credential to 'MacBook Pro'"

**Vault:**

- "Enable the vault"
- "Disable auto-lock"
- "Set auto-lock to 15 minutes"

**Fortress Mode:**

- "Enable fortress mode"
- "Is fortress mode active?"

## Backup

**Create** — the engine auto-decides full vs incremental based on change volume:

- "Create a backup"
- "Back up everything"

**List** — shows type (full/incremental), timestamp, and size:

- "List backups"
- "Show me my backups"

**Verify** — SHA-256 integrity check on any stored backup:

- "Verify the latest backup"
- "Check backup integrity"

**Restore** — walks the incremental chain automatically when needed:

- "Restore from the last backup"
- "Restore from backup 2026-03-10"

## Gateway

- "Show me the gateway status"
- "What port is the gateway running on?"
- "Change the gateway port to 8080"
- "Set bind to loopback"
- "Change mode to remote"
- "Enable TLS" — warns that cert and key paths are required
- "Set the UI password"
- "Describe gateway options" — lists all blueprints with guidance

## Logging

- "Show me the logs" — opens live log viewer overlay
- "Show me error logs" — filtered log overlay
- "Show the last 100 log lines" — quick tail in chat
- "Describe logging options"

## Webhooks (Hooks)

- "Describe hooks options"
- "Set the webhook URL for message events"
- "What hooks are configured?"

## Commands

- "Describe command options"
- "What custom commands are available?"

## Advanced

Covers env, update, plugins, diagnostics, canvas, discovery, broadcast, and media paths:

- "Describe env options"
- "Describe update settings"
- "What plugins are installed?"
- "Describe diagnostics options"
- "What is the canvas host?"
- "Describe discovery options"
- "Describe broadcast settings"
- "Describe media options"

## Usage & Costs

**Summary:**

- "How much did I spend this week?"
- "What's my total cost for February?"
- "Usage summary for the last 30 days"

**Cost breakdown:**

- "What model costs the most?"
- "Which provider am I spending the most on?"
- "Break down costs by input vs output tokens"

**Sessions:**

- "Show me the top sessions by cost"
- "Which sessions had errors?"
- "List recent sessions with their token counts"

**Visual charts:** (opens chart overlay)

- "Show me usage charts" — chart overview overlay
- "Graph my costs by model" — by-model overlay
- "Show usage by provider" — by-provider overlay

## Infrastructure

**Logs:**

- "Show me the logs" — live log viewer overlay
- "Show recent errors"
- "Tail the last 50 lines"

**Nodes:**

- "What nodes are connected?"
- "Pin exec to my iPhone node"
- "Unbind exec from that node"

**Devices:**

- "List paired devices"
- "Approve that pending device"
- "Reject the pairing request"
- "Remove my old phone"
- "Rotate the device token"

## Visual Overlays

The agent triggers browser overlays automatically when visual interaction is needed. All overlays support click-outside-to-close (except approval prompts).

**Inline chat components** (`nyx-ui`) — rendered directly in the conversation:

| Component     | Triggered by           | What it shows                               |
| ------------- | ---------------------- | ------------------------------------------- |
| **Channels**  | "Show channel status"  | status-grid with semaphore dots and buttons |
| **Providers** | "Show me my providers" | status-grid with credentials and controls   |
| **Skills**    | "Show me the skills"   | data-table with enable/disable per skill    |

**Browser overlays** — open automatically when persistent visual interaction is needed:

| Overlay                   | Triggered by              | What it shows                                |
| ------------------------- | ------------------------- | -------------------------------------------- |
| **WhatsApp QR**           | "Connect WhatsApp"        | QR code — scan to pair                       |
| **Telegram Setup**        | "Connect Telegram"        | Setup wizard                                 |
| **Tools Status**          | "Show me the tools"       | Interactive tool toggles, profiles, denyBins |
| **Config Editor**         | `/config show`            | Raw JSON editor with syntax highlighting     |
| **Config Map**            | Gear icon / `/config`     | 13-section discovery grid with chat phrases  |
| **Exec/File Approval**    | Agent needs permission    | Approval prompt with allow/deny              |
| **WebAuthn Registration** | "Register my fingerprint" | Touch ID biometric prompt                    |
| **Usage Chart**           | "Show me usage charts"    | Cost/token graphs by day, model, or provider |
| **Cron Board**            | "Show me the cron board"  | Kanban board of jobs by state                |
| **Logs Viewer**           | "Show me the logs"        | Live log viewer with level/text filters      |
| **Files Browser**         | "Open the file browser"   | Workspace file explorer                      |

## Discovery

Ask "Describe [section]" or "Describe [path]" to get full guidance before making any change:

- "Describe gateway" — all gateway blueprints with types and guidance
- "Describe channels" — all channel config options
- "Describe security" — vault and WebAuthn paths
- "Describe agents" — tools, exec, model config

For a specific path:

- "Describe channels.telegram.allowFrom" — current value, valid type, coercion rules, related paths
- "Describe messages.tts.auto" — valid options, default, help text
- "Describe agents.defaults.model.defaultTier" — current tier, routing, fallbacks

The agent always uses `describe` internally before suggesting changes, ensuring every value is validated and every trade-off is explained.

## The Pattern

Always the same:

1. Say what you want in plain language
2. The agent resolves the action and calls `config_manage` internally
3. Blueprints validate types, coerce values, and check cross-field rules
4. If the action needs visual interaction, a browser overlay opens automatically
5. You never see JSON paths, config files, or forms — unless you want to

**Escape hatch:** Open the **Config Map** (gear icon in the topbar) to discover all 13 configurable sections with clickable example phrases that pre-fill the chat. The underlying config file is always `~/.genosv1/genosos.json`.
