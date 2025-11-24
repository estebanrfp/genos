# GenosOS Vision

Your private AI assistant — across every channel.

## Origin

GenosOS started from [OpenClaw](https://github.com/openclaw/openclaw)'s multi-channel infrastructure, then was completely rewritten: TypeScript to pure JavaScript (ES2024), Node.js to Bun, optional encryption to mandatory AES-256-GCM, config files to conversational configuration. The result is a different product with a different philosophy.

## Design Philosophy

### Companion-first

**OpenClaw treats the agent as stateless between requests.** Context is what fits in the current session; when the session compacts or resets, the slate is largely clean.

**GenosOS treats the agent as an entity with continuity.** Memory is not optional — it is a first-class concern. Compaction must not erase personality. Re-entry after a long break must feel like picking up a conversation, not starting over.

This leads to concrete decisions not found in OpenClaw:

- **Structured compaction** — deterministic 11-section template with technical + emotional sections. Prevents the cold-restart problem.
- **Structured memory documents** — `memory/YYYY-MM-DD.md` files follow an 8-section schema so vector search retrieves by section type.
- **Security as a prerequisite for intimacy** — NYXENC1 vault encryption, Fortress Mode, WebAuthn/Touch ID. A companion holds sensitive information — security is what makes it safe to store things that actually matter.
- **Local-first audio** — Kokoro TTS runs on-device. No audio leaves the machine.

### Conversational-first

The user knows WHAT they want, not HOW to configure it. The agent knows the HOW.

GenosOS replaced 12+ UI tabs with `config_manage` — 25 actions, 164 blueprints, 15 operational guides. Configuration is conversation. The blueprint system acts as a semantic bridge between raw JSON paths and natural language guidance.

**Layered Instruction Architecture:** Unified Capabilities catalog (Skills + Config) → Tool description → Operational guides (on-demand) → Blueprints (validation/coercion). Each layer serves a distinct purpose with zero token footprint until needed.

If an AI companion can understand and modify its own configuration through dialogue, forms are unnecessary.

## Technical Direction

### Why Bun?

Bun provides faster startup, native `bun:sqlite`, instant ESM resolution, and better performance for an I/O-heavy orchestration system. Not just a runtime swap — an architecture decision.

### Why pure JavaScript?

GenosOS is an orchestration system: prompts, tools, protocols, and integrations. TypeScript adds build complexity without proportional benefit. Pure JavaScript (ES2024+) keeps the codebase hackable, fast to iterate, and zero-build for development. The entire codebase was converted with full test coverage preserved (738 suites, 6,140+ tests).

## Current State (85 phases)

**Completed infrastructure:**

- Full conversational configuration — all UI tabs eliminated, chat + overlays only
- Multi-agent architecture with seamless A2A communication, agent rename, UUID directories
- Smart model routing — tier-based (normal/complex), subagent-only scope
- Provider + Tier architecture — `defaultTier` replaces hardcoded model names
- Interactive chat components (`nyx-ui`) — inline status-grid, stat-bars, data-table, key-value
- Unified Capabilities catalog — 49% prompt token reduction, zero instruction conflicts
- 15 operational guides in TOON format — 43% smaller than markdown originals
- Full security stack — NYXENC1, Fortress Mode, WebAuthn, transparent write/edit encryption
- Bidirectional voice calls (Twilio/Telnyx/Plivo) with realtime STT and local TTS
- **Realtime Call** — true bidirectional voice via OpenAI Realtime API (audio in → audio out, zero intermediate steps). Per-call context injection, automatic transcript capture, wait-for-completion tool
- **TOON Compaction Pipeline** — compaction summaries stored as TOON (~40% fewer tokens). Iterative compaction-over-compaction with zero information degradation, validated across 4 successive rounds

**Current focus:**

- Channel setup enrichment — step-by-step guidance in blueprints for Discord, Telegram, Slack, Signal
- Provider setup flows — conversational API key and OAuth setup
- Agent templates — ✅ live (`skills/agent-templates/`), 11 templates (10 business + security guard), zero new JS
- Connected service guides — YouTube Data API + HeyGen avatar video (loaded on-demand via `config_manage services`)

## What Comes Next

The engine is complete. The simplicity layer roadmap is fully implemented — 86 phases of infrastructure, from scope reduction through agent templates, voice/CRM integration, and autonomous system health monitoring.

**Completed simplicity layer:**

- ✅ **Agent templates** — `skills/agent-templates/` with 12 templates (10 business + security guard + SEO specialist). One conversation from "I want an assistant for my X" to a fully configured agent. Automatic tier escalation (Opus for creation, Sonnet for normal ops).
- ✅ **Channel setup flows** — 7 channel guides + overview hub. Agent guides through credential creation step-by-step via `config_manage channels {name}.setup`.
- ✅ **Provider setup flows** — `providers.md` guide with API key, device flow, and browser OAuth. 4 OAuth portal extensions. 6-step diagnostic checklist.
- ✅ **Connected service guides** — 6 guides (Twilio, HubSpot, Stripe, Google Calendar, YouTube, HeyGen). Full API endpoints, methods, bodies, and diagnostics. Accessible via `config_manage services {name}`.
- ✅ **Voice + CRM integration** — works through composition: `realtime_call` (phone) + `web_fetch` (APIs) + vault (credentials) + guides (documentation). No connector runtime needed — the agent is the runtime.

**Future enhancements:**

- **TUI parity** — terminal interface (`bun genosos.mjs tui`) with `@` session autocomplete, overlay selectors, 11 slash commands, nyx-ui inline renderers, approval gates. Functionally equivalent to WebUI — same gateway, same events, same streaming. Only difference: navigation is on-demand (`@`/`/sessions`) vs persistent sidebar.
- **Realtime Call enhancements** — custom voice per agent, multi-language auto-detection, call recording + storage
- **Additional service guides** — Telnyx/Plivo voice, Salesforce, Square, Cal.com, Shopify, WooCommerce

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full roadmap and phase details.

## Extensions

28 active channel extensions organized by tier:

- **Core (8):** WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Voice Call, Realtime Call
- **Infrastructure (4):** memory-core, memory-lancedb, device-pair, llm-task
- **Dev/Power-user (8):** Matrix, Twitch, phone-control, OAuth portals, talk-voice
- **Optional by market (9):** LINE, Zalo, Feishu, Teams, Google Chat, Mattermost, Nostr

9 extensions removed (IRC, Tlon, Nextcloud Talk, etc.) — documented in ARCHITECTURE.md.

## Security

**Two-layer architecture:** Critical anti-injection rules (identity verification, prompt injection defense, session integrity) are hardcoded in the system prompt (`## Safety`) — immutable, not deletable from workspace files. Agent-specific policies (scope of trust, channel restrictions, custom red lines) live in `SECURITY.md` — personalizable per agent.

Defense in depth with 10 layers: encryption at rest (NYXENC1), macOS Keychain, buffer zeroing, WebAuthn/Touch ID, DM pairing policies, tool approval gates, transparent filesystem encryption, tamper-evident audit log, OS hardening (Spotlight/TM exclusion), and vault auto-lock (30 min).

See [SECURITY.md](SECURITY.md) for the full policy.

## Constraints

- No external service dependencies (no custom domains, no hosted registries)
- No cloud-based skill distribution

## Author

Esteban Fuster Pozzi (@estebanrfp) — Full Stack JavaScript Developer
