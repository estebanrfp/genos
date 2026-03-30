# GenosOS Documentation

GenosOS is configured through conversation. You talk to your agent — it handles the rest.

## Quick Start

```bash
pnpm install
bun genosos.mjs gateway
```

Open `http://localhost:18789` in your browser. The agent starts a 4-question onboarding:

1. **Name & purpose** — your name, the agent's name, its role
2. **Personality** — communication style, tone, vibe
3. **Expertise** — domains and specialization
4. **Rules** — permissions, restrictions, boundaries

The agent creates its identity files automatically (`IDENTITY.md`, `USER.md`, `SOUL.md`). No manual editing needed.

## Conversational Configuration

Everything is configured by talking to the agent. Say what you want — the agent translates it to config.

### Examples

| You say                                        | What happens                            |
| ---------------------------------------------- | --------------------------------------- |
| "Connect my WhatsApp"                          | Agent guides you through WhatsApp setup |
| "Switch to Claude Opus"                        | Agent updates the primary model         |
| "Enable Telegram with this bot token: 123:abc" | Agent configures Telegram channel       |
| "Schedule a daily summary at 8am"              | Agent creates a cron job                |
| "Enable vault encryption"                      | Agent activates AES-256-GCM encryption  |
| "Show me the config"                           | Agent displays the 13 config sections   |

### Config Sections

The agent organizes configuration into 13 sections:

| #   | Section       | What it controls                                     |
| --- | ------------- | ---------------------------------------------------- |
| 1   | **Providers** | AI model providers (Anthropic, OpenAI, Gemini)       |
| 2   | **Models**    | Default model, fallbacks, image models               |
| 3   | **Agents**    | Agent list, workspaces, tools, sandbox               |
| 4   | **Channels**  | WhatsApp, Telegram, Discord, Slack, Signal, iMessage |
| 5   | **Messages**  | TTS, streaming, markdown formatting                  |
| 6   | **Session**   | Session scoping, send policy, history                |
| 7   | **Skills**    | Installed skills and limits                          |
| 8   | **Cron**      | Scheduled jobs and automation                        |
| 9   | **Memory**    | Memory backend, search, embeddings                   |
| 10  | **Browser**   | Chrome remote debugging, CDP                         |
| 11  | **Hooks**     | Webhooks, event mappings                             |
| 12  | **Gateway**   | Port, bind address, TLS, auth                        |
| 13  | **Advanced**  | Environment, logging, diagnostics, plugins           |

## Channels

Seven channels, one agent brain. Each channel shares the same memory and personality.

| Channel      | Setup                       | Key config                    |
| ------------ | --------------------------- | ----------------------------- |
| **WhatsApp** | QR code scan via gateway    | `channels.whatsapp.allowFrom` |
| **Telegram** | Bot token from @BotFather   | `channels.telegram.botToken`  |
| **Discord**  | Bot token + guild ID        | `channels.discord.botToken`   |
| **Slack**    | Bot token + Socket Mode     | `channels.slack.botToken`     |
| **Signal**   | Phone number registration   | `channels.signal.number`      |
| **iMessage** | macOS native (Messages.app) | `channels.imessage.allowFrom` |
| **WebChat**  | Built-in, always available  | No config needed              |

### Access Control

Every channel uses the same DM policy model:

- **`pairing`** (default) — unknown senders need a one-time approval code
- **`allowlist`** — only IDs in `allowFrom` can interact
- **`open`** — accept messages from everyone (requires `allowFrom: ["*"]`)

Tell the agent: "Set WhatsApp to allowlist mode" or "Add +34660777328 to WhatsApp allowlist."

## Providers

Three curated providers with smart model routing:

| Provider      | Default model     | Boost model     |
| ------------- | ----------------- | --------------- |
| **Anthropic** | Claude Sonnet 4.6 | Claude Opus 4.6 |
| **OpenAI**    | GPT-5.4           | o3              |
| **Gemini**    | Gemini 2.5 Pro    | Gemini 3 Pro    |

The agent uses the default model for everyday tasks and automatically escalates to the boost model when the task demands it. No manual switching needed.

Tell the agent: "Use Anthropic as my provider" and paste your API key when asked.

## Security

### Vault Encryption

All state files encrypted at rest with AES-256-GCM (NYXENC1 format). PBKDF2 key derivation with 100,000 iterations.

Tell the agent: "Enable vault encryption" or "Lock the vault."

### Fortress Mode

One command to harden everything: audit log, rate limiting, Spotlight/Time Machine exclusion, vault auto-lock.

Tell the agent: "Enable fortress mode."

### Tool Sandbox

Controls what the agent can execute:

- **`off`** — no sandbox (trust mode)
- **`non-main`** — sandbox subagents only
- **`all`** — sandbox everything

Tell the agent: "Enable sandbox for all agents."

## Memory

GenosOS uses semantic memory with embeddings. The agent remembers across sessions and channels.

- **Compaction** — old messages are summarized into durable memories
- **Semantic search** — relevant context retrieved automatically via embeddings
- **Cross-session** — memories persist across conversations

Memory configuration is automatic. The agent manages compaction thresholds, search parameters, and cleanup.

## Agents

### Multi-Agent

Create specialist agents for different domains. Each agent has its own workspace, identity, and memory.

Tell the agent: "Create a new agent called SEO Specialist."

### Identity Files

Each agent has workspace files that define who it is:

| File          | Purpose                               |
| ------------- | ------------------------------------- |
| `IDENTITY.md` | Name, emoji, vibe, avatar             |
| `SOUL.md`     | Personality and behavioral guidelines |
| `USER.md`     | Information about the user            |
| `AGENTS.md`   | Agent registry and capabilities       |
| `SECURITY.md` | Permissions and restrictions          |

These files are created during onboarding and updated conversationally. The agent manages them — you don't edit them manually.

## Cron Jobs

Schedule recurring or one-time tasks via conversation.

Tell the agent: "Remind me every Monday at 9am to review analytics" or "Send a daily WhatsApp summary at 8pm."

## Skills

Extend the agent with optional capabilities. Skills are opt-in — only installed skills are active.

Tell the agent: "Show available skills" or "Install the coding-agent skill."

## Config File

While everything is conversational, the config lives in `~/.genosv1/genosos.json` (JSON5 format). The agent reads and writes this file automatically. Hot-reload applies changes instantly — no restart needed for most settings.

You can edit this file directly if you prefer, but the recommended path is always through conversation.

## Data Directory

```
~/.genosv1/
  genosos.json          — configuration (JSON5, hot-reloaded)
  vault.enc             — encrypted vault (AES-256-GCM)
  workspace/            — agent workspaces
    {agent-name}/
      IDENTITY.md       — agent identity (encrypted)
      SOUL.md           — personality (encrypted)
      USER.md           — user info (encrypted)
      memory/           — memory files (encrypted)
  agents/               — agent sessions
    {uuid}/
      sessions/         — transcripts (JSONL)
  credentials/          — OAuth tokens
```

## Author

Esteban Fuster Pozzi (@estebanrfp) — Full Stack JavaScript Developer
