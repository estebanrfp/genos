# GenosOS — Architecture Analysis

## Vision

**GenosOS is not a developer framework. It's a product for people and businesses.**

The core thesis: _"The user knows WHAT they want, not HOW to configure it — the agent knows the HOW."_ A dental clinic owner says "I want patients to reach me on WhatsApp and schedule appointments by phone." They don't know what `dmPolicy`, `PBKDF2`, or `per-channel-peer` means. Nor should they.

GenosOS handles the complexity. The user just says what they want.

## OpenClaw vs GenosOS

**OpenClaw (~40%):** Core gateway, 37 channel extensions, browser/CDP integration, base memory infrastructure, plugin pipeline. A developer SDK — powerful, but requires technical knowledge to configure.

**GenosOS (~60%, 85 phases):** Everything below. A product — where the agent takes initiative, decides secure defaults, and guides non-technical users through natural conversation.

|                   | OpenClaw                 | GenosOS                                  |
| ----------------- | ------------------------ | ---------------------------------------- |
| **Target**        | Developers               | People and businesses                    |
| **Setup**         | Config files + CLI flags | Natural conversation                     |
| **Channels**      | 37 (everything included) | ~11 core + optional by market            |
| **Voice**         | Raw infrastructure       | "Answer calls and schedule appointments" |
| **CRM/APIs**      | Doesn't exist            | Connector templates + service guides     |
| **Security**      | Manual                   | Agent decides secure defaults            |
| **Extensibility** | Plugins for developers   | Agent configures its own APIs            |

---

## Key Architectural Decisions

### 1. Bun Runtime + TypeScript Eradication

Not just a runtime swap — an ideological purge. Bun provides `bun:sqlite`, instant startup, and a unified runtime. Eliminating TypeScript in favor of pure ES2024+ is counterintuitive for the industry, but correct for a single-developer personal companion project: zero build friction, more compact code, and no abstraction layer that adds no value without a large team to coordinate.

### 2. Conversational Configuration Strategy

12+ UI tabs eliminated and replaced with `config_manage` (30 actions, 190 blueprints, 12 operational guides). Most AI projects add UI on top of UI. GenosOS does the opposite: _configuration is conversation_. The blueprint system acts as a semantic bridge between raw JSON paths and natural language guidance — not just CRUD, but contextual validation with cross-field rules, auto-type coercion, and intelligent post-set defaults.

**Layered Instruction Architecture:** Unified Capabilities catalog (Skills + Config domains in system prompt, ~14KB total) → Tool description (compact mechanics, ~3KB) → Operational guides (complex flows, loaded on-demand via `loadGuide()`) → Blueprints (validation/coercion). Each layer has a distinct purpose. The catalog provides clear disambiguation: "send a message" = Skill (read SKILL.md), "configure the channel" = Config (use config*manage). Guides are action-oriented `.md` files in `src/agents/tools/guides/` — 13 files in TOON format covering channels, providers, agents, sessions, gateway, and advanced config. Zero token footprint until requested. Diagnostic directive: *"Resolve what you can, inform what you know, ask only what you cannot determine."\_

Coherent with the premise: if your AI companion can understand and modify its own configuration through dialogue, why do you need forms?

### 3. Security — Paranoid in the Right Way

**Two-layer security architecture:**

- **Immutable layer** (`## Safety` in `system-prompt.js`, position 4) — anti-injection patterns, identity verification, session integrity. Hardcoded in the codebase — no agent, user, or external content can modify or delete these rules. This is architectural protection, not just textual.
- **Personalizable layer** (`SECURITY.md` in workspace, position 18) — scope of trust, vault awareness, channel restrictions, custom red lines. Editable per-agent, per-workspace.

**Encryption & access control:**

- NYXENC1 with AES-256-GCM
- macOS Keychain integration
- Buffer zeroing
- WebAuthn/Touch ID
- Auto-lock at 30 minutes
- Audit log with anti-tampering checksums
- Spotlight and Time Machine exclusion
- Transparent SDK write/edit encryption — agents don't even know they're encrypting

For a project storing intimate conversations and personal memory, this is exactly the right level of paranoia.

### 3b. Channel Tool Restrictions — Trust-Proportional Permissions

Not all channels are equal. A localhost WebUI with Touch ID is not the same as an inbound voice call from an unknown number. Channel restrictions automatically deny dangerous tools based on the communication channel:

- **WebUI**: unrestricted (localhost + WebAuthn + DENY_BINS already protect)
- **WhatsApp/Telegram/Discord/Signal**: `exec`, `bash`, `process` denied (can still read, search, message)
- **Voice calls**: nearly everything denied except session management (anyone can call)

This is a **deny-only pipeline step** applied after all profile/allow steps — it uses the existing `filterToolsByPolicy()` infrastructure. No new profiles needed. Granular, auditable, and overrideable per-agent.

### 4. Opaque UUID Agent Directories

`agents/9073c46a/` instead of `agents/lumina/` — decouples identity from filesystem. `agents.rename` is zero filesystem operations, only config + session key rewrite. Mature systems design.

### 5. Seamless A2A with Input Provenance

- Visibility separated from A2A policy
- Ping-pong with limited turns
- `REPLY_SKIP`/`ANNOUNCE_SKIP` as control signals
- `external_user` vs `inter_session` provenance distinction
- Multi-agent system that scales without agents confusing who's talking to them

---

## The Simplicity Layer

The simplicity layer is NOT new code, a new UI, or a new dashboard. It's **how the agent behaves with someone who knows nothing technical**.

All infrastructure pieces already exist: `config_manage`, `agents.create`, `auto-config`, blueprints, vault, voice-call, `web_fetch`. What's missing is that the agent takes initiative and hides complexity behind natural conversation.

### The Principle: Agent as Business Advisor

The agent doesn't ask "what dmPolicy do you want?" — it decides the secure default and explains in human terms:

| Situation                    | Agent decides                                | User sees                              |
| ---------------------------- | -------------------------------------------- | -------------------------------------- |
| New WhatsApp channel         | `dmPolicy: "open"`, `allowFrom: ["*"]`       | "Anyone can message you"               |
| New channel for personal use | `dmPolicy: "pairing"`                        | "Only contacts you approve"            |
| Business agent               | `tools.shell: disabled`, `webFetch: enabled` | Nothing (secure by default)            |
| Agent with voice             | `inboundPolicy: "open"`, auto-greeting       | "Calls are active"                     |
| API key stored               | Vault NYXENC1, auto-lock 30min               | "Your credentials are stored securely" |
| Model for business           | default model (boost when needed)            | Nothing (picks the most efficient)     |

### Example: Dental Clinic Setup

```
User: "I want an assistant for my dental clinic"

Nyx: "Perfect. I need to know 3 things:
      1. What's your clinic called?
      2. How do your patients reach you? (WhatsApp, Telegram, phone...)
      3. What should the assistant do? (answer questions, schedule
         appointments, both...)"

User: "Clínica Dental Pozzi. WhatsApp and phone. Schedule appointments
       and answer questions about services."

Nyx: "Got it. Here's what I'll do:
      ● Create an agent called 'Clínica Dental Pozzi Assistant'
      ● Connect WhatsApp (I'll ask you to scan a QR code)
      ● Activate incoming calls
      ● Only you can manage it, for security
      Shall we start?"

User: "Go ahead"

Nyx: [internally executes in sequence]
  1. agents.create → tool profile: messaging
  2. channels.whatsapp.enable → shows QR overlay
  3. voice-call.inboundPolicy: "open" + auto-greeting
  4. hardenSecurityConfig() → automatic
  5. Seed identity in agent workspace

Nyx: "WhatsApp connected ✓ Calls activated ✓
      Do you have info about your services and hours?
      You can tell me here or send a document."
```

All technical complexity is still there. The user never saw `dmPolicy`, `config_manage`, `blueprint`, or `inboundPolicy`.

### Implementation: Skills, Not Features — ✅ DONE (Phase 62)

The simplicity layer is a **skill** — a directory with markdown instructions + templates that the agent loads and follows:

```
skills/agent-templates/
├── SKILL.md                              ← triggers, 11-step guided flow with tier escalation, safety rules
└── templates/
    ├── dental-clinic.md                  ← WhatsApp + Voice, Calendar, CRM, Stripe
    ├── law-firm.md                       ← WhatsApp + Email, Calendar, CRM, Stripe
    ├── online-store.md                   ← WhatsApp + Discord/Telegram, Stripe, CRM
    ├── restaurant.md                     ← WhatsApp + Voice, Calendar, Stripe
    ├── real-estate.md                    ← WhatsApp + Email, Calendar, CRM, Stripe
    ├── hair-salon.md                     ← WhatsApp, Calendar, CRM, Stripe
    ├── gym-fitness.md                    ← WhatsApp, Calendar, CRM, Stripe recurring
    ├── hotel.md                          ← WhatsApp + Voice, Calendar, Stripe
    ├── accounting-firm.md               ← WhatsApp + Email, Calendar, CRM
    ├── content-creator.md               ← AI YouTuber, full production pipeline
    └── security-guard.md             ← Gateway security monitoring + audit automation
```

No new `.js` files. All logic is executed by the agent with existing tools. The skill is **knowledge, not code**.

This pattern replicates:

| Skill                | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `agent-templates`    | Create specialized agents from templates (business, security, operations) |
| `voice-receptionist` | Configure phone receptionist with greeting + hours                        |
| `crm-connect`        | Connect any CRM via connector templates                                   |
| `team-onboard`       | Add agents for a team (sales, support, admin)                             |
| `security-audit`     | Review config and harden what's missing                                   |

### The Channel Gap: Two Disconnected Worlds

Today there are two disconnected guidance systems:

**CLI world (rich, guided):**

```
src/channels/plugins/onboarding/discord.js
→ noteDiscordTokenHelp() — step by step with links
→ promptDiscordAllowFrom() — interactive guidance
→ 406 lines of conversational onboarding
```

**Agent world (poor, generic):**

```
config_manage channels enable discord
→ { warnings: ["Missing: token"], hint: "Set: channels.discord.token" }
→ Agent improvises or dumps the raw path
```

**Solution:** Move onboarding guidance into blueprints. No new code — enrich existing blueprint `guidance` fields with the step-by-step instructions already written in CLI onboarding files.

Today:

```javascript
{ pathPattern: "channels.discord.token", guidance: "Discord bot token string" }
```

Should be:

```javascript
{
  pathPattern: "channels.discord.token",
  guidance: "Discord bot token. Steps: 1) Go to discord.com/developers/applications → New Application. 2) Bot → Add Bot → Reset Token → copy. 3) OAuth2 → URL Generator → scope 'bot' + 'applications.commands' → invite to server. 4) Enable 'Message Content Intent'. Paste the token here.",
  postSetup: [
    { action: "describe", path: "channels.discord.dmPolicy", ask: "Who should be able to DM your bot?" },
    { action: "channels", subAction: "probe", auto: true }
  ]
}
```

The agent reads the blueprint, guides the user step-by-step, and automatically runs post-setup (dmPolicy + connectivity probe) without being told.

### Channel Setup: What Should Happen

| Channel      | User says                 | Agent does                                                                         |
| ------------ | ------------------------- | ---------------------------------------------------------------------------------- |
| **WhatsApp** | "Connect WhatsApp"        | Enable → show QR overlay → scan → done ✓ (already works)                           |
| **Telegram** | "Connect Telegram"        | "Open Telegram, find @BotFather, type /newbot, paste the token here" → set → probe |
| **Discord**  | "Connect Discord"         | Step-by-step Developer Portal guide → set token → set dmPolicy → probe             |
| **Slack**    | "Connect Slack"           | "Go to api.slack.com/apps → Create App → Bot Token → paste here" → set → probe     |
| **Phone**    | "I want to receive calls" | "Which provider? Twilio/Telnyx/Plivo" → set credentials → set greeting → probe     |
| **Signal**   | "Connect Signal"          | "Install signal-cli, set up your number, tell me the path" → set → probe           |

### Connector Templates: APIs Without Code

For external services (CRM, calendars, payments), the agent configures its own API connections:

```json
{
  "id": "google-calendar",
  "name": "Google Calendar",
  "trigger": ["calendar", "appointment", "schedule"],
  "setup": {
    "questions": ["Which Google account?"],
    "auth": "oauth2:google:calendar.events"
  },
  "actions": {
    "create_event": {
      "method": "POST",
      "url": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      "bodyTemplate": { "summary": "{{title}}", "start": { "dateTime": "{{start}}" } }
    }
  }
}
```

The agent reads the template, executes OAuth, stores the token in vault, and from then on knows how to schedule. **The user never sees the API.**

---

## Architecture Overview

### Runtime & Toolchain

- **Runtime:** Bun (>=1.2) — NOT Node.js
- **Language:** Pure JavaScript (ES2024+) — TypeScript fully eradicated
- **Package manager:** pnpm (NOT npm/yarn) — Bun only for runtime/bundling
- **UI build:** Vite (ui/) → dist/control-ui/
- **Tests:** Vitest — unit + E2E
- **Linter:** oxlint (NOT eslint)

### Project Structure

```
GenosOS/
├── src/                        # Core server (~475K LOC, 3,200 files)
│   ├── agents/                 # Multi-agent architecture (391 files)
│   │   ├── tools/              # Agent tools + blueprints
│   │   │   └── blueprints/     # 12 files, 190 declarative blueprints
│   │   ├── auto-config.js      # 6 pure functions for intelligent defaults
│   │   ├── subagent-spawn.js   # Subagent lifecycle + depth limits
│   │   ├── system-prompt.js    # Dynamic system prompt builder
│   │   ├── pi-embedded-runner.js # Pi agent integration + tool loop
│   │   └── static-model-catalog.json # 3 curated providers
│   ├── gateway/                # Server implementation (166 files)
│   │   ├── server.impl.js      # Gateway initialization orchestrator
│   │   └── server-methods/     # 20+ RPC handlers (139 methods)
│   ├── config/                 # Configuration system (115 files)
│   ├── memory/                 # Dual-backend memory (QMD + SQLite)
│   ├── cron/                   # Scheduling (croner-based)
│   ├── browser/                # CDP integration (playwright-core)
│   ├── tts/                    # Kokoro TTS (local, CPU)
│   ├── canvas-host/            # Visual workspace (port 18793)
│   └── infra/                  # Vault, encryption, audit log
├── ui/                         # Control UI (Lit 3 + Vite 7)
├── extensions/                 # Channel integrations (see Extension Tiers below)
├── skills/                     # Bundled skills platform
├── packages/                   # npm compatibility shims
├── apps/                       # Native apps (iOS, Android, macOS)
├── genosos.mjs                 # Entry point → src/entry.js
└── package.json                # v2026.2.21
```

### Gateway Startup Sequence

```
bun genosos.mjs gateway
  1. CLI routing → gateway handler
  2. Load .env + validate Bun runtime
  3. Harden state directory permissions
  4. Init audit log (Fortress Mode)
  5. Build Control UI assets
  6. Load + validate genosos.json
  7. Load channel extensions
  8. Init subagent registry
  9. Load model catalog (static JSON + discovery)
 10. Build cron service (croner)
 11. Warm memory search manager (~150ms)
 12. Create channel manager → start all channels
 13. Attach WebSocket handlers (ws 8.19.0)
 14. Listen on port 18789 (Express + HTTP)
 15. Run onboarding wizard (first run)
 16. Start mDNS/Bonjour discovery
 17. Start maintenance timers (heartbeat, skills)
```

### Data Flow: Inbound Message (WhatsApp → Nyx)

```
WhatsApp Baileys plugin receives message
  → callGateway({ method: "chat", channel, peer, message })
  → Resolve session key (DM policy + channel + peer)
  → Create session if needed (dmScope: per-channel-peer)
  → Load session transcript
  → Agent run (Pi embedded runner)
    → System prompt + tools loaded
    → Pi message loop (tool calls → gateway → memory, A2A, etc.)
  → Auto-reply streamed back to WhatsApp
  → Session transcript persisted (NYXENC1 encrypted)
```

### Voice Call Architecture

Bidirectional phone calls with two modes:

- **Outbound:** `realtime_call initiate_call { to: "+34...", message: "..." }` — returns immediately, transcript delivered async
- **Inbound:** Webhook server + inbound policy (allowlist/pairing/open)
- **4 providers:** Twilio, Telnyx, Plivo + Mock for dev
- **Realtime Call** (Phase 68): true bidirectional voice via OpenAI Realtime API (audio in → audio out, zero intermediate steps). Per-call context injection, automatic transcript capture
- **Voice Call** (legacy): STT → LLM → TTS pipeline with Kokoro (local), OpenAI, or ElevenLabs
- **Async calls** (Phase 69): `initiate_call` returns immediately, transcript delivered to originating session via `chat.send`. Subagent routing per phone number (WhatsApp DM pattern)
- **Tunneling:** Cloudflare Tunnel (recommended), ngrok, or Tailscale Funnel for webhook exposure

An agent can answer a phone call, listen, respond with voice, query a CRM, and hang up. Today.

### Multi-Agent Architecture

Agents are isolated execution contexts with:

- **UUID directory** (opaque 8-char hex): `~/.genosv1/agents/{uuid}/`
- **Main session key**: `agent:{agentId}:main` (always present)
- **Tool profile** (inferred from name): coding/messaging/minimal/full
- **Smart model routing** (boost tool — LLM auto-escalates to advanced model)
- **Encrypted workspace** (SOUL.md, IDENTITY.md, AGENTS.md, etc.)

### Agent-to-Agent Communication

- Decoupled from visibility — agents can message without seeing each other's sessions
- Ping-pong default: 2 turns per exchange (max 5)
- Agent existence guard: `sessions_send` validates target exists before routing
- Input provenance: `external_user` vs `inter_session` — agents know who's talking
- `REPLY_SKIP` / `ANNOUNCE_SKIP` control signals for early exit

### Smart Model Routing

The LLM auto-escalates to the advanced model via the `boost` tool when the user expresses importance, urgency, or need for excellence. The tool calls `agent.setModel()` directly — switching the model mid-conversation within the same request. Model pairs per provider:

| Provider  | Default        | Boost        |
| --------- | -------------- | ------------ |
| Anthropic | Sonnet 4.6     | Opus 4.6     |
| OpenAI    | GPT-5.4        | o3           |
| Gemini    | Gemini 2.5 Pro | Gemini 3 Pro |

### Configuration System

- **Format:** JSON5 with Zod validation
- **Caching:** 200ms TTL with immediate invalidation on write
- **Blueprints:** 190 declarative configs across 12 files + 16 operational guides in TOON format
- **Auto-config:** 6 pure functions for intelligent defaults
- **config_manage:** 30 RPC actions, all from chat
- **Config Map:** 13-section discovery grid in UI
- **Config Editor:** Raw JSON with syntax highlighting + Touch ID gate

### Security Layers

| Layer              | Implementation                              |
| ------------------ | ------------------------------------------- |
| Encryption at rest | NYXENC1 (AES-256-GCM, PBKDF2)               |
| Key management     | macOS Keychain → env → .env fallback        |
| Biometric auth     | WebAuthn / Touch ID                         |
| DM policy          | Pairing (6-digit code) / allowlist / closed |
| Tool execution     | Approval gates per tool category            |
| Filesystem         | Transparent write/edit encryption           |
| Audit              | Tamper-evident checksums                    |
| Secrets            | Buffer zeroing after use                    |
| OS hardening       | Spotlight + Time Machine exclusion          |
| Auto-lock          | 30-minute vault timeout                     |

### UI: Two Interfaces, Same Gateway

**Control UI** (web — `http://127.0.0.1:18789`):

- **No bubbles, avatars, or shadows** — pure text with structural markers
- **Sender names:** `[NYX]` / `[YOU]` / `[SYSTEM]` — uppercase, muted, bracketed
- **Prompt dots:** 11px `●` with semaphore colors (green/yellow/red)
- **Thinking spinner:** `✢` rotating star
- **Dividers:** "NEW SESSION" / "COMPACTION" — uppercase pills
- **Tier bars:** `■ ■ □` with tooltip (tier + thinking + reasoning + verbose)
- **nyx-ui:** 4 inline component types (status-grid, stat-bars, data-table, key-value)
- **10 browser overlays:** WhatsApp QR, Telegram Setup, Config Editor, Config Map, Exec/File Approval, WebAuthn, Usage Chart, Cron Board, Logs, Files Browser
- **Sidebar:** agent groups (collapsible), session tree, activity dots for running agents

**TUI** (terminal — `bun genosos.mjs tui`):

- Full terminal chat interface built on `@mariozechner/pi-tui`
- **37 source files** in `src/tui/` (~4,080 lines), 26 tests
- WebSocket connection to Gateway (same as Control UI)
- Pickers: model (Ctrl+L), agent (Ctrl+G), session (Ctrl+P)
- Slash commands, local shell (`!`), syntax highlighting, fuzzy search
- 24-color theme system (chalk hex)
- Currently uses 9/118 RPCs, 2/17 push events — TUI parity with Control UI is a planned enhancement

**All config via chat** — overlays only for visual tasks (QR codes, charts, kanban)

---

## Extension Tiers (29 active, 9 removed)

### Core — Always present (8)

| Extension         | Why                                                     |
| ----------------- | ------------------------------------------------------- |
| **whatsapp**      | #1 global business channel                              |
| **telegram**      | #2 global, trivial bot setup                            |
| **discord**       | Communities, teams, support                             |
| **slack**         | Enterprise internal comms                               |
| **signal**        | Privacy-focused (sensitive data)                        |
| **imessage**      | Apple ecosystem                                         |
| **voice-call**    | Bidirectional phone (Twilio/Telnyx/Plivo) — STT→LLM→TTS |
| **realtime-call** | True bidirectional voice via OpenAI Realtime API        |

### Infrastructure — Needed but invisible (4)

| Extension          | Why                                |
| ------------------ | ---------------------------------- |
| **memory-core**    | Base memory system                 |
| **memory-lancedb** | Vector search for long-term recall |
| **device-pair**    | Connect user devices               |
| **llm-task**       | Internal LLM task pipeline         |

### Dev / Power-user (8)

| Extension                   | Why                                                             |
| --------------------------- | --------------------------------------------------------------- |
| **matrix**                  | Open federation, popular in dev/open-source communities         |
| **twitch**                  | Streamers with technical bots — legitimate market               |
| **phone-control**           | Power-user iOS device control (not exposed in agent-templates)  |
| **google-antigravity-auth** | OAuth portal for Google provider                                |
| **google-gemini-cli-auth**  | OAuth portal for Gemini CLI                                     |
| **minimax-portal-auth**     | OAuth portal for MiniMax (Chinese AI provider)                  |
| **qwen-portal-auth**        | OAuth portal for Alibaba Qwen                                   |
| **talk-voice**              | ElevenLabs voice control for Talk iOS — complements voice stack |

### Optional by market (8)

| Extension               | Market                  | Trigger                  |
| ----------------------- | ----------------------- | ------------------------ |
| **line**                | Japan, Taiwan, Thailand | User says "I use LINE"   |
| **zalo** + **zalouser** | Vietnam                 | User says "I use Zalo"   |
| **feishu**              | China (Lark)            | User says "I use Feishu" |
| **msteams**             | Microsoft enterprise    | User says "I use Teams"  |
| **googlechat**          | Google enterprise       | User says "Google Chat"  |
| **mattermost**          | Self-hosted enterprise  | User says "Mattermost"   |
| **nostr**               | Crypto/decentralized    | Niche use case           |

### Removed (9) — deleted from repository

| Extension            | Reason                                   |
| -------------------- | ---------------------------------------- |
| **bluebubbles**      | Redundant with imessage                  |
| **irc**              | Legacy protocol, no real users in 2026   |
| **tlon**             | Urbit, ~0 potential users                |
| **nextcloud-talk**   | Requires Nextcloud, ultra-niche          |
| **lobster**          | Developer workflow engine, not a channel |
| **open-prose**       | Developer skill pack, not a channel      |
| **thread-ownership** | Slack-specific multi-agent utility       |
| **diagnostics-otel** | 10 OpenTelemetry deps, pure DevOps       |
| **copilot-proxy**    | Incomplete/private provider proxy        |

**Result:** From 37 → **29 active** (8 core + 4 infra + 8 dev + 9 market), **9 removed**.

---

## Completed Phases (82)

1. Node → Bun migration
2. TypeScript eradication
3. Functional verification + full rebrand
4. Full repository audit
5. Encrypted vault (NYXENC1), WebAuthn, full state dir encryption
6. Fortress Mode — Keychain, buffer zeroing, SQLite hardening, audit log, rate limiting
7. Kokoro TTS (local, CPU mode)
8. Ollama local models integration
9. Providers unification — single source of truth
10. Prefetch unified under memorySearch.prefetch
11. Onboarding wizard migrated to providers format
12. Control UI simplification — Debug, Security, Instances tabs removed
13. Channels Conversacional
14. Operation Blueprints — declarative config coercion/validation/guidance
15. Usage Conversacional
16. Connection → Topbar Modal
17. Tools Conversacional
18. Sessions Conversacional
19. Cron Board Conversacional
20. Logs Conversacional
21. Nodes Conversacional
22. Files Conversacional
23. Skills Conversacional
24. Coverage Audit
25. Full Blueprint Coverage — 131 total blueprints
26. Providers Overlay + Config Map
27. Agents Conversacional
28. Smart Model Routing
29. HEARTBEAT label fix
30. Static Model Catalog
31. DM Session Isolation
32. Sidebar Real-Time
33. UI Polish
34. Chat CLI Style
35. System Instruction Annotation
36. Sender Name Styling
37. Subagent Delegation Blueprints
38. Intelligent Auto-Configuration
39. Subagent Waiting Indicator
40. Transparent NYXENC1 Write/Edit
41. Disconnect Toast CLI Style
42. Subagent Session Continuation
43. Subagent Keep Parameter
44. Seamless A2A
45. Agent Rename
46. Config Editor + Config Map Hub
47. Canvas Host
48. Opaque UUID Agent Directories
49. Agent Session Bootstrap
50. Sidebar Real-Time Agents
51. Config Cache Invalidation
52. Residual Directory Cleanup
53. A2A Agent Existence Guard
54. Contextual Activity Hints — tool-aware spinner states + A2A stop token cleanup
55. Operational Guides System — 13 on-demand guides, layered instruction architecture
56. Interactive Chat Components (nyx-ui) — inline status-grid, stat-bars, data-table, key-value
57. Provider + Tier Architecture — defaultTier replaces model.primary, UI dropdown sync, subagent-only routing
58. TOON Operational Guides — 13 guides converted to TOON format, 43% size reduction (87KB → 50KB)
59. Unified Capabilities Catalog — single Capabilities section in system prompt (~14KB), config_manage description 84% reduction, skillEntriesCache
60. Prompt Efficiency — coreToolSummaries eliminated (~400 tokens), TOOLS.md lazy-load for subagents (~1K tokens), skill description compaction (22 skills ≤100 chars), common prefix extraction, sectional guide loading + cache, AGENTS.md template reduction
61. Agent Personality Injection — `description` param in agents.create, gateway injects `## Purpose` into SOUL.md before encryption. Foundation for specialized business templates (per-industry profiles, connected services, CRM/calendar/payment connectors)
62. Guided Business Setup Skill — `skills/agent-templates/` (originally business-setup) with 10 industry templates, tier escalation (Opus for creation, Sonnet for normal ops), `defaultTier` schema support. Pure knowledge, zero new JS. Auto-discovered by `loadSkillEntries()`
63. Intelligent Tier Profiles + UI Cleanup — full capability profiles per tier (simple/normal/complex with thinking+verbose+reasoning), `classifyTierEscalation()` for auto-escalation on config/destructive tasks, session overrides popover → tier bars, A2A activity fix, sidebar non-blocking delegation
64. Agent Templates + Security Guard — `skills/business-setup/` → `skills/agent-templates/`, flat `templates/` dir, optional section model (business vs operations), security-guard + seo-specialist templates, `config_manage security audit` exposed, `security-ops.md` TOON guide, 14 operational guides
65. Dynamic Specialist Delegation + SOUL.md Protection — runtime agent list injection into system prompt, SOUL.md/IDENTITY.md overwrite protection, adaptive-routing log shows thinking/reasoning/verbose
66. Reliable Delegation — normal tier thinking "medium" (was "low"), single analysis keyword score +3, specialist agents hint moved to early system prompt (position ~5/14), anti-greedy instruction, main agent guaranteed normal/medium minimum
67. Skill-Equipped Templates — templates declare `Skills:` section auto-installed to agent workspace, NYXENC1 skill loader fixed, 2 bundled SEO skills (gsc-analytics, site-auditor), `copyDirRecursive()`, `parseAgentTemplate` with fall-through
68. Realtime Bidirectional Voice — `extensions/realtime-call/` with OpenAI Realtime API, Twilio Media Streams (g711_ulaw), per-call context injection, automatic transcript capture, voice `sage`
69. Async Calls + Subagent Routing — `initiate_call` returns immediately, transcript delivered via `chat.send`, factory tool captures `ctx.sessionKey`, module-level singleton eliminates port conflicts, `voice_call` → `realtime_call`, 10 business templates get `AlsoAllow: realtime_call`
70. TOON Compaction Pipeline — compaction summaries converted Markdown→TOON post-compaction, SDK template overridden, empty sections omitted, manual `/compact` at any session size, validated 4 successive compactions with zero information degradation
71. UI Polish + Channel Status Dots — real-time channel connection dots in sidebar, lifecycle-based activity animation, tool output HTML auto-detection, compaction stats
72. UI Simplification + Responsive — Settings 5→4 tabs, mobile sidebar overlay, Reset replaces Refresh, ~700 lines removed
73. Cron Reliability + Tool Card Dedup + Queue — cron soft warnings, delivery via `chat.send`, tool card dedup, minimal queue redesign
74. Intent-Based Simplification + Security Audit — Tools tab removed (4→3), Config Map 13→5, commands 15→7, ~1,160 lines dead code cleanup
75. Channel Tool Restrictions — deny-only pipeline step per communication channel, built-in safe defaults
76. Two-Tier Routing — Provider+Tier architecture, `defaultTier` replaces `model.primary`, clickable tier bars
77. Security Audit Intelligence — known node commands, loopback severity, real vault status, Kokoro TTS fix, compaction token refresh
78. Immutable Security Layer + Autonomous Doctor — two-layer security (hardcoded `## Safety` + personalizable `SECURITY.md`), autonomous doctor engine (7 checks, auto-fix), 37 legacy doctor files deleted, security-guard template uses `config_manage doctor`
79. Activity Tips Curation + Config Map Cleanup — activity tips curated 33→15, Config Map hints cleaned, chat prompt pulse animation removed
80. Auth Hardening + Local-First Skills Documentation — authentication hardening, local-first skills documentation
81. Backup Engine + Approval Snapshot Binding + Permissions-Policy — backup engine, approval snapshot binding for integrity verification, Permissions-Policy HTTP header
82. Smart Incremental Backup Engine — auto full/incremental/skip detection, cycle-based retention policy, Desktop and iCloud auto-copy

---

## Roadmap: From Companion to Business Platform

### Product Thesis

- Any business (dental clinic, law firm, online store, hair salon) can deploy AI agents through natural conversation
- The agent takes initiative, decides secure defaults, guides non-technical users
- The simplicity layer is NOT new code — it's how the agent behaves
- Skills = knowledge (markdown + JSON), not code. The agent interprets and executes.
- **All UI lives in the chat** — inline `nyx-ui` components (status-grid, stat-bars, data-table, key-value) replace overlays. Only WhatsApp QR, Cron Board kanban, and Config Editor remain as overlays (they require persistent visual interaction).

### Phase A: Reduce Scope ✅

- ✅ Removed 9 unused extensions (bluebubbles, irc, tlon, nextcloud-talk, lobster, open-prose, thread-ownership, diagnostics-otel, copilot-proxy)
- ✅ Documented Pi runner contract — 8 boundary points, fork strategy defined (only pi-agent-core if needed)
- ✅ Benchmarked TOON encoding — 13µs/call, negligible, kept

### Phase B: Operational Guides + Conversational Config ✅

- 15 operational guides in TOON format — 43% smaller than original markdown (87KB → 50KB)
- Intent-first structure: `channels-overview.md` = common knowledge hub (policies, patterns, diagnostics); each channel guide = delta only (unique setup, specific errors, specific config)
- `.md` files written in TOON (no conversion step — `loadGuide()` is `readFile` direct)
- Agent walks user through setup conversationally, shows status with inline `nyx-ui` components
- Probe result propagation — agent sees specific errors, not just "not connected"
- Diagnostic directive: "resolve what you can, inform what you know, ask only what you cannot determine"
- Result: 4-5 tool calls per setup → 1-2; zero token footprint for unused guides; ~43% fewer tokens per loaded guide
- **Unified Capabilities Catalog (Phase 59):** Single `## Capabilities` section in system prompt with two clear domains — Skills (→ SKILL.md path) and Config (→ config_manage action). config_manage description reduced 84% (18.5KB → 3KB). Total prompt savings ~49% (~27.5KB → ~14KB). In-memory `skillEntriesCache` eliminates repeat disk scans. Zero agent confusion — disambiguation rule: "send a message" = Skill, "configure/setup the channel" = Config.

### Phase B2: Channel Setup Flows ✅

7 channel-specific TOON guides + channels-overview hub. Each guide provides step-by-step setup, config paths, and diagnostic checklists. Integrated via `config_manage channels {name}.setup`.

- **Discord:** Developer Portal guide → token → privileged intents → guild workspace → role-based routing
- **Telegram:** @BotFather → token → probes → inline status (interactive modal)
- **Slack:** Socket Mode vs HTTP → app token + bot token → event subscriptions
- **Signal:** signal-cli setup (QR or SMS) → external daemon mode → reactions
- **WhatsApp:** QR overlay (interactive modal — visual scan required)
- **Nostr:** Relays + profile (name/about/picture/nip05)
- **Matrix:** Federation setup
- **iMessage:** Full Disk Access requirement (critical for macOS)

### Phase B3: Provider Setup Flows ✅

`providers.md` TOON guide covers all provider types. Integrated via `config_manage providers setup`.

- **API key providers:** Anthropic, OpenAI, Google, xAI, OpenRouter, Together, Venice, HuggingFace, etc. — agent guides through key creation, validates inline
- **Device flow:** GitHub Copilot, Qwen, MiniMax — `genosos models auth login --provider {id}`
- **Browser OAuth:** Google Antigravity, Gemini CLI — auth link + auto-detection
- **Custom endpoints:** LM Studio, vLLM, LiteLLM proxy — base URL + model config
- **Ollama:** Local discovery, base URL config
- **API Key format reference:** `sk-ant-` (Anthropic), `sk-` (OpenAI), `AIza` (Google), `xai-` (xAI), etc.
- **6-step diagnostic:** list → check exists → validate key → rate limit → model not found → timeout

### Phase B4: Connected Services Guides ✅

6 TOON guides in `src/agents/tools/guides/` for external services. Loaded on-demand via `config_manage services {name}`. Each guide includes full API endpoints, methods, headers, body examples, and diagnostic checklists.

- `voice-telephony-twilio.md` — Twilio voice setup, webhook config, Cloudflare Tunnel, realtime_call usage
- `crm-hubspot.md` — Private App setup, Contacts/Deals/Companies CRUD, search, associations, notes
- `payments-stripe.md` — Test/live keys, Payment Links, Checkout Sessions, Customers, Invoices, Refunds, PCI compliance
- `calendar-google.md` — OAuth setup, List/Create/Update/Delete events, FreeBusy availability, timezone handling
- `youtube-api.md` — YouTube Data API v3: channel info, video upload, playlists, comments, analytics
- `avatar-heygen.md` — HeyGen API: avatar video generation, digital presenters, multi-scene, webhooks

### Phase C: Agent Templates ✅ (Phases 62, 64)

One conversation to go from zero to a fully configured specialized agent. Supports business assistants, operations agents, and custom setups.

**Approach:** Pure knowledge, zero new JS. The entire feature is a skill (`skills/agent-templates/`) with templates. Nyx reads the skill, identifies the agent type, loads the matching template, and walks the user through agent creation + configuration — all conversationally.

- **12 templates** — 10 business (dental clinic, law firm, online store, restaurant, real estate, hair salon, gym/fitness, hotel, accounting firm, content creator) + 2 operations (security guard, SEO specialist)
- **Optional section model** — business templates use Channels/Services/BusinessHours; operations templates use Hardening/Approvals/A2A/AlsoAllow/Deny. SKILL.md processes each if present, skips if absent.
- **11-step guided flow** — identify type → load template → **escalate to Opus** → check connections → preview → **create agent (on Opus)** → channels → services → hardening/approvals/A2A → cron → **summary + reset to Sonnet**
- **Tier escalation** — complex skills automatically switch to Opus (`session_status model=complex`) before agent creation, then reset to default (`session_status model=default`). Skill-specific pattern.
- **Security audit exposed** — `config_manage security audit` (+ `value=deep`), `security-ops.md` TOON guide with remediation playbooks
- **Custom fallback** — if no template matches, asks 3 questions and builds custom config
- **Auto-discovered** by `loadSkillEntries()` — appears in Capabilities catalog automatically
- **Extensible** — adding a new agent type is just a `.md` file in `templates/`

### Phase D & E: Connector Runtime + Voice/CRM — SUPERSEDED ✅

Originally planned as separate phases requiring new JS code (OAuth handler, token refresh, connector templates). **Both are unnecessary** — the existing architecture already provides this capability through composition:

- **`web_fetch`** supports GET/POST/PUT/DELETE/PATCH with custom headers (Authorization Bearer, API keys, form-encoded)
- **Vault** stores service credentials encrypted (NYXENC1) via `config_manage set services.{name}.apiKey`
- **Service guides** (B4) contain full API endpoint documentation — the agent reads the guide and translates to `web_fetch` calls
- **`realtime_call`** provides async voice with transcript delivery to the originating session

**The agent IS the connector runtime.** Proven flow: `realtime_call` (phone call) → `web_fetch` (Google Calendar: check availability + create event) → `web_fetch` (HubSpot: search contact + create deal + log note). No intermediate layer needed.

### Dependencies — Complete

```
A ✅ → B ✅ → B2 ✅ → B3 ✅ → B4 ✅ → C ✅ → D+E superseded ✅
                                        ↑
                                  Phase 61 ✅
                              (injection mechanism)
```

The simplicity layer roadmap is **complete**. All phases implemented:

- ~~A~~ ✅ — scope reduction (37 → 29 extensions)
- ~~B~~ ✅ — operational guides + conversational config (15 TOON guides, layered instruction)
- ~~B2~~ ✅ — channel setup flows (7 guides + overview + blueprints + `config_manage channels {name}.setup`)
- ~~B3~~ ✅ — provider setup flows (`providers.md` guide + 6-step diagnostic + 4 OAuth portals)
- ~~B4~~ ✅ — connected services guides (6 guides: Twilio, HubSpot, Stripe, Google Calendar, YouTube, HeyGen)
- ~~C~~ ✅ — agent templates (12 templates, tier escalation, personality injection)
- ~~D+E~~ ✅ — superseded by `web_fetch` + vault + guides composition

---

## Areas to Watch

| Area                 | Risk   | Status                                                    |
| -------------------- | ------ | --------------------------------------------------------- |
| Scope/complexity     | Medium | ✅ Resolved — 9 extensions removed, 28 active (tiered)    |
| Pi runner dependency | Medium | ✅ Mitigated — contract documented, fork strategy defined |
| Model routing        | Low    | ✅ Resolved — Provider + Tier architecture, subagent-only |
| TOON encoding        | Low    | ✅ Resolved — 13µs/call, negligible, kept                 |

---

## Voice Call — Already Working

- Bidirectional: outbound + inbound (Twilio, Telnyx, Plivo)
- STT realtime: OpenAI Realtime API (VAD, partial + final transcriptions)
- TTS streaming: Kokoro (local), OpenAI, ElevenLabs — sentence-level pipeline
- Tunneling: Cloudflare Tunnel (recommended), ngrok, or Tailscale Funnel
- Agent tool: `realtime_call` (initiate, continue, speak, end, status)
- Missing: CRM lookup on answer, call logging on end (Phase F)

---

## Pi Runner Decision

- **Current:** @mariozechner/pi-agent-core v0.53.0 + pi-coding-agent v0.53.0 + pi-ai v0.53.0
- **Assessment:** Best option today — multi-provider, session persistence, compaction, streaming
- **Fork strategy:** If ever needed, fork only pi-agent-core (992 lines). Keep pi-ai (13K lines, 12 providers) as upstream dependency.
- **Contract:** 8 boundary points documented in `memory/pi-runner-contract.md`

---

## Verdict

GenosOS is essentially an **OS for AI-powered businesses** — stateful, local-first, encrypted, conversational, and personal. Not just a personal companion anymore, but a platform where any business can deploy AI agents through natural conversation.

The engine is complete. 86 phases of infrastructure. The simplicity layer roadmap is fully implemented — from scope reduction (Phase A) through operational guides, channel/provider/service setup flows, and agent templates (Phase C), to voice calls and CRM integration that work through pure composition (`realtime_call` + `web_fetch` + vault + guides). No connector runtime was needed — the agent itself is the runtime.

12 agent templates (10 business + security sentinel + SEO specialist), true bidirectional voice via OpenAI Realtime API, async call routing with subagent-per-number pattern, a TOON compaction pipeline that preserves information across successive compactions without degradation, two-layer security architecture (immutable anti-injection + personalizable policies), and an autonomous doctor engine for system health monitoring.

**OpenClaw is an SDK. GenosOS is a product.**

---

## Author

Esteban Fuster Pozzi (@estebanrfp) — Full Stack JavaScript Developer
