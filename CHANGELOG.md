# GenosOS Changelog

All notable changes to GenosOS are documented in this file.
This is the single source of truth for GenosOS's evolution — 85 phases from OpenClaw fork to product.

---

## [1.1.0] — 2026-03-27

### Semantic Tool Matching

- Tools filtered by embedding similarity to user intent — only relevant tools reach the LLM
- Boot: embed all tool descriptions + natural language intent phrases (single API call)
- Per-request: cosine similarity against queryVec from memory prefetch (zero extra API calls)
- Core tools always visible (read, write, edit, bash, exec, process, web_fetch, web_search, config_manage)
- Domain tools only when semantically relevant (browser, canvas, cron, message, tts, image, etc.)
- Results: "hola" 27→19 tools, "revisa mis correos" 27→16 tools (~40% token reduction)

### Curated Providers

- Reduce from 23 provider groups to 3 curated, tested providers
- Anthropic: subscription token (sk-ant-oat01-) + API key (sk-ant-api-)
- OpenAI: API key (sk-proj-)
- Gemini: API key (AIza...)
- Same provider selection as GenosOS Pro for product coherence
- Smart model routing planned: default (sonnet/gpt-5.4/2.5-pro) + boost (opus/o3/3-pro)

---

## Origin (19 Feb 2026)

- Forked OpenClaw → GenosOS
- TypeScript → pure JS (ES2024), Node.js → Bun
- 738 suites, 6,140+ tests — all passing
- Private repo: github.com/estebanrfp/GenosOS
- LICENSE: MIT, Copyright 2026 Esteban Fuster Pozzi
- Workspace: ~/.genosv1/workspace/ | Daemon: ~/.genosv1/
- Run: `bun genosos.mjs gateway`

---

## GenosOS vs OpenClaw

OpenClaw = TypeScript, Node, plaintext, no at-rest security, no prefetch, no TOON.
GenosOS = pure JS, Bun, encrypted vault, Fortress Mode, semantic prefetch, TOON.

**Remote upstream removed** from the repo (21 Feb 2026). Weekly cron monitoring (Mon 12:00) via `gh api`. If relevant changes detected, evaluate and reimplement from scratch — never cherry-pick.

| Feature             | OpenClaw          | GenosOS                                                          |
| ------------------- | ----------------- | ---------------------------------------------------------------- |
| Predictive prefetch | Does not exist    | 5 chunks, score >= 0.25, pre-LLM                                 |
| TOON encoding       | No                | Yes (~40% fewer tokens, 73.9% vs 69.7% accuracy)                 |
| Vault encryption    | No                | AES-256-GCM (NYXENC1)                                            |
| WebAuthn/Touch ID   | No                | Yes                                                              |
| Fortress Mode       | No                | Keychain, buffer zeroing, SQLite hardening, audit log, auto-lock |
| Transparent decrypt | No                | 19+ subsystems                                                   |
| Ollama streaming    | Basic             | Dynamic context window + deltas                                  |
| Conversational UI   | Classic dashboard | Pure chat + overlays                                             |

---

## Security — Defense in Depth

### Exec Hardening (19 Feb 2026)

4 layers: secured-bash.js (SDK wrapper) -> exec.js (custom tool) -> exec-runtime.js (spawn) -> node-host/invoke.js (companion apps).

- **DENY_BINS**: security, sudo, rm, ssh, scp, open, defaults, launchctl... (absolute denylist)
- **SAFE_BINS**: bun, git, curl, cat, ls, find, grep, python3, osascript, trash, ffmpeg, claude, genosos... (31)
- `checkDenyBins()` parses pipes/&&/; to prevent bypass

### Fortress Mode (21 Feb 2026, 978 tests)

- **Keychain** — passphrase in macOS Keychain (Touch ID), not in .env
- **Buffer zeroing** — buffer cleanup of key material after use
- **SQLite hardening** — secure_delete, temp_store=MEMORY, WAL truncation
- **Spotlight/TM exclusion** — .metadata_never_index + xattr
- **Rate limiting** — exemptLoopback = false, WebAuthn rate-limited
- **Vault auto-lock** — 30 min inactivity + sleep/suspend detection
- **Audit log** — HMAC-SHA256 tamper-evident, HMAC key in Keychain
- **Env sanitization** — plugins cannot see VAULT_PASSPHRASE or GATEWAY_TOKEN

### SECURITY.md — first-class bootstrap (24 Feb 2026)

- Separate file from AGENTS.md, injected in full after each compaction
- Anti-prompt-injection: documented attack patterns, trust level table
- Included in `MINIMAL_BOOTSTRAP_ALLOWLIST` (subagents and cron also receive it)

### AGENTS.md + SECURITY.md immutable via RPC (24 Feb 2026)

- `IMMUTABLE_WORKSPACE_NAMES` blocks `agents.files.set/edit` — read-only for the agent
- Agents operate within configured rules. Only direct access can modify immutable workspace files.

### Host Security (18 Feb 2026)

FileVault ON, Firewall enabled, rapportd blocked, ports denied, chmod 600, CDP localhost only, Gateway localhost only. Hardware: Apple M2 Max 12 cores 96 GB RAM.

---

## Encryption (NYXENC1)

- **Write**: sandbox tools -> agents.files.set -> automatic NYXENC1 encryption
- **Read by agent**: gateway decrypts and injects plaintext into context
- **CLI read**: `genosos vault cat <path>` -> stdout
- **Passphrase**: macOS Keychain (Touch ID). Chain: explicit -> env -> Keychain -> .env
- **Lock/Unlock**: `genosos vault lock` / `vault unlock`
- **Vector search**: works with encrypted vault. FTS disabled (accepted trade-off)
- Transparent decryption of `read` tool (23 Feb) — detects NYXENC1 header and decrypts in memory

---

## Memory System

### Predictive Prefetch (20 Feb 2026)

Before each LLM call, searches for relevant chunks via embeddings and injects them as `[Memory Prefetch]`. OpenClaw injects EVERYTHING — GenosOS only the relevant.

- Config: `agents.defaults.memorySearch.prefetch` (enabled, maxChunks: 5, minScore: 0.40)
- Dynamic gate: if `chunks[0].score < minGate` (0.20) -> inject nothing
- Language-agnostic — no per-language regex, free model + gate on top chunk
- Provider: OpenAI `text-embedding-3-small` (~170ms, $1.46/year)

### TOON Encoding (20 Feb 2026)

~40% token reduction, 73.9% vs 69.7% accuracy. Always active, no toggle.
Applied to: prefetch, memory_search, memory_recall.

### Structured Compaction — 11 sections (22 Feb 2026)

Template in `compaction-instructions.js` with technical sections (Facts, State, Constraints, Actions, Open Questions, Preferences, Errors, Next Steps) + emotional (Session Mood, Connection Moments, How to Re-enter).

### TOON Compaction Pipeline (7 Mar 2026)

Compaction summaries converted from Markdown to TOON post-compaction, stored as TOON in session JSONL. SDK template overridden to prevent dual-template conflicts. Empty sections omitted. Manual `/compact` enabled at any session size. Validated: 4 successive compactions with zero information degradation — LLM reads and re-produces TOON natively.

### Permanent Memory Template — 8 sections (22 Feb 2026)

`buildMemoryDocumentTemplate()` for `memory/YYYY-MM-DD.md`: People, Decisions, Preferences, Projects, Context, Constraints, Moments, Content.
Migration: 44 files -> 17, consolidated and restructured.

### Performance Optimizations (22 Feb 2026)

| Fix                                  | Before         | After       |
| ------------------------------------ | -------------- | ----------- |
| Cache passphrase vault-state         | 22s            | ~750ms      |
| Skip text-search fallback with vault | 12s            | <5ms        |
| Smart heuristic prefetch             | ~150ms always  | <1ms (skip) |
| Warm-up embeddings on startup        | ~2s cold start | ~150ms      |
| agents.js vault cache fix            | +80ms extra    | 0ms         |

### Sources of Truth (23 Feb 2026)

- **Static knowledge** -> memory/ (semantic prefetch): architecture, decisions, changelog
- **Live state** -> RPCs: `models.list`, `ollama.models.installed`, `providers.list`, `config.get`
- **Rule:** never answer about current state from memory. Always RPC first.

---

## Active Channels

1. WhatsApp (primary), 2. Telegram, 3. Webchat/Dashboard (localhost:18789), 4. iMessage (bidirectional), 5. Brave CDP port 9222 (browser control)

---

## Ollama — Local Models (24 Feb 2026)

- **Dynamic discovery**: `buildOllamaProvider()` on startup via `/api/tags`. If offline -> provider removed from catalog.
- **Unified download**: `triggerPull()` spawns `ollama pull <model>` as real subprocess -> visible in `ps aux` -> automatic detection
- **3 detectors**: `detectExternalOllamaPulls()` (ps aux), `detectOllamaDownloadsFromFs()` (blobs), `attachExternalTracker()` (HTTP stream)
- **RPCs**: `ollama.models.installed` (with activeDownloads), `ollama.pull.status/cancel`, `ollama.model.delete`
- **UI auto-sync**: backgroundSync 6s, self-healing when download completes
- Discovered models with `discovered: true` -> shown with ` *` in UI

---

## Model Discovery — OpenAI, Anthropic, Google (24 Feb 2026)

- OpenAI: live `/v1/models`, filters gpt-_ + o_ owned by openai/system
- Anthropic: live `/v1/models`, fallback to static if token is not sk-ant-api\*
- Google Gemini: auto-injected when `GEMINI_API_KEY` present
- `onlyAvailable: true` in `models.list` only returns discovered or ollama

---

## Kokoro TTS (21 Feb 2026)

Local, zero-latency, zero-cost via Kokoro-FastAPI (`http://localhost:8880/v1`). Voice: `af_heart`, lang: `es`. LaunchAgent auto-starts. TTS streaming sentence-level — starts on the first complete sentence mid-stream.

---

## Auth Profiles -> Providers (23-26 Feb 2026)

### Evolution

- **23 Feb**: 2-store system — `auth-profiles.json` (vault-encrypted) + `genosos.json auth.profiles` (metadata). RPCs: `auth.profiles.list/set/delete`. UI panel in Config > Authentication.
- **26 Feb**: **Full unification** — everything in `genosos.json providers[*]` (credentials + endpoints + models + failover). 4 chained migrations at startup absorb all legacy formats.

### Current State (providers)

- RPCs: `providers.list/set/delete/setDisabled` (legacy aliases maintained)
- Credential pause/resume: `disabled: boolean`. UI pause/play toggle.
- `runWithModelFallback()` fast-fail when all paused
- `auth` as schema key: definitive decision (not renaming to authentication)

---

## Configurable denyBins (26 Feb 2026)

- `DEFAULT_DENY_BINS` (14 bins) configurable per agent
- Cascade: `agent.tools.exec.denyBins ?? tools.exec.denyBins ?? DEFAULT_DENY_BINS`
- `undefined` = defaults, `[]` = full trust, `["sudo"]` = only sudo blocked

---

## Control UI + CLI (24 Feb 2026)

- Minimalist CLI banner: `GenosOS 2026.2.21 (hash)` — removed 60+ random phrases
- Event gap: silent auto-reconnection instead of red banner
- Unsupported schema nodes: hidden (previously showed red block)
- WORKFLOW_AUTO.md consolidated into AGENTS.md (## Session Startup, ## Red Lines, ## TTS, ## File Editing)

---

## Board Tab (19 Feb 2026)

Kanban + Activity Feed + Global Search integrated in dashboard. Drag & drop executes real actions on the gateway. 941 lines, 14 files. **Note:** removed as tab in the conversational conversion (27 Feb) — now overlay via `config_manage cron subAction='board'`.

---

## Bugs Fixed that OpenClaw Still Has

- Chat metadata (commit e6917e341)
- Google Fonts CSP (commit 1dbc4bb47)
- searchTextFallback with encrypted vault
- systemSent not reset after compaction — `incrementCompactionCount()` now resets `systemSent: false`
- `[[reply_to_current]]` visible in webchat — stripReplyTags() in message-extract.js

---

## agents.files.edit — RPC (21 Feb 2026)

Server-side find-and-replace for encrypted files. Decrypts -> validates unique match -> replaces -> re-encrypts. Rejects if 0 or >1 matches.

---

## 26 Feb 2026 — Providers Unification + prefetch rename

- `hippocampus` renamed to `memorySearch` across the entire codebase
- Config: `agents.defaults.memorySearch.prefetch.*`

---

## 27 Feb 2026 — Control UI -> Conversational (the great simplification)

### Strategy

GenosOS adopted a radical strategy: **eliminate all Control UI tabs** and replace them with conversational interaction. Only native UI is kept for what the browser needs (WebAuthn, QR codes, charts).

**Core principle:** the agent does everything the UI used to do, but conversationally — "show me the skills" or "enable tavily" in chat.

**Key tool: `config_manage`** — agent tool with 24 actions. Each eliminated tab becomes an action with sub-actions.

**Overlay pattern:** when visual UI is needed, the agent opens a modal overlay via RPCs `*.initiate/complete`. Blocks until the user closes. Actions within the overlay in real time via existing RPCs.

### Tabs Eliminated (in chronological order)

1. **Debug, Security, Instances** — removed directly
2. **Overview -> Connection** — moved to topbar modal (plug icon)
3. **Config -> Topbar** — topbar modal (gear icon). "settings" group removed.
4. **Channels** — `config_manage channels` (status/probe/enable/disable/logout/whatsapp.login/nostr.profile). Overlays for WhatsApp QR and Nostr profile.
5. **Usage** — `config_manage usage` (summary/cost/sessions/chart). Overlay with bar chart.
6. **Tools** — `config_manage tools` (status/profile/allow/deny/denybins/etc). Interactive overlay with toggles and chips.
7. **Sessions** — `config_manage sessions` (list/get/patch/delete/reset/compact). Gear popover with model selector + overrides.
8. **Cron + Board** — `config_manage cron` (list/status/add/update/remove/run/runs/board). Kanban overlay with 4 columns.
9. **Logs** — `config_manage logs` (view/tail). Overlay with real-time log viewer.
10. **Nodes** — `config_manage nodes/devices/approvals` (list/binding/unbind/approve/reject/remove/rotate).
11. **Files** — `config_manage files` (browse/list/get/set). Overlay with workspace file browser.
12. **Skills** — `config_manage skills` (status/list/enable/disable/key/install). Overlay with interactive skills list.

### Operation Blueprints

Declarative coercion/validation/guidance system per config path. 12 JS files in `src/agents/tools/blueprints/`:

- `channels.js` (~25), `security.js` (7), `gateway.js` (11), `agents.js` (tools), `sessions.js` (12), `cron.js` (5)
- `messages.js`, `logging.js`, `hooks.js`, `commands.js`, `advanced.js`, `models.js` — added 27 Feb 2026
- **131 total blueprints** — complete coverage of all sections
- Integrated in `handleSet`, `handleRemove`, `handleDescribe` of config_manage

### Final UI State (28 Feb 2026)

**Sidebar:** 120px, empty (no nav groups). Menu toggle in topbar.
**Topbar:** 4 buttons — gear (Config Map), plug (connection modal), shield (health modal), theme toggle.
**Active overlays (10):** WebAuthn registration, WhatsApp QR, Nostr profile, Usage chart, Tools status, Cron board, Logs view, Files browser, Skills, **Providers**.
**Config Map:** replacement for config modal — grid of 13 sections with clickable phrases that pre-fill the chat.
**Gear popover:** model selector + session overrides (label, thinking, verbose, reasoning).

### Conversational Skills (27 Feb 2026) — last tab eliminated

- Server: `pendingSkillsOverlay` Map + `skills.overlay.initiate/complete` RPCs (5min timeout)
- Agent tool: `handleSkills()` — 6 sub-actions: status (overlay), list (with filter), enable, disable, key, install
- UI overlay: reuses `renderSkills()` + all existing controllers. Close button only.
- Cleanup: "agent" group removed from sidebar, `/skills` route removed, i18n cleaned (4 locales)

### Coverage Audit + System Prompt Optimization (27 Feb 2026)

- **4 new actions**: `providers` (8 sub), `models` (6 sub), `tts` (7 sub), `memory` (6 sub)
- **Total: 24 actions** in `config_manage` — complete coverage of all sections
- **System prompt optimization**: routing guide moved from system prompt to tool description (~1.2KB/turn savings)
- **6 new blueprint files**: `messages.js`, `logging.js`, `hooks.js`, `commands.js`, `advanced.js`, `models.js`
- **131 total blueprints** — every configurable section has declarative validation

### Providers Overlay + Config Map (28 Feb 2026)

**Providers Overlay** — 10th visual overlay in the system:

- Server: `pendingProvidersOverlay` Map + `providers.overlay.initiate/complete` RPCs (5min timeout)
- Agent tool: `handleProviders()` — `case "status"` opens interactive overlay. "Show me my providers" triggers it.
- UI overlay: reuses `renderProvidersPanel()` inside `exec-approval-card`. Click-outside-to-close.
- State: `providersOverlayQueue`, `providersOverlayBusy`, `providersOverlayError` + `dismissProvidersOverlay(id)`

**Config Map** — complete replacement for the config modal:

- The topbar gear icon now opens a **Config Map** instead of the config editor
- Responsive grid of 13 sections (providers, models, agents, channels, messages, session, skills, cron, memory, browser, hooks, gateway, advanced)
- Each card shows: icon + label + description + 2-3 clickable example phrases
- Click on phrase → pre-fills `chatMessage`, closes modal, focuses chat textarea
- Sections with visual overlay marked with "overlay" badge
- WebAuthn lock preserved (if credentials exist, biometric authentication required)
- `openConfigModal()` simplified — no longer loads config/schema, just toggle

**Files modified (11):**

1. `src/gateway/server-methods/web.js` — RPCs providers overlay
2. `src/agents/tools/config-manage-tool.js` — status sub-action + description update
3. `ui/src/ui/views/providers-overlay.js` — **NEW**
4. `ui/src/ui/app.js` — state + dismiss method
5. `ui/src/ui/app-gateway.js` — event handlers
6. `ui/src/ui/app-render.js` — import + render + gear title "Config Map"
7. `ui/src/styles/board.css` — providers overlay CSS
8. `ui/src/ui/views/config.js` — export sidebarIcons
9. `ui/src/ui/views/config-modal.js` — **REWRITTEN** as Config Map
10. `ui/src/styles/components.css` — Config Map grid CSS
11. `docs/blueprints/CONVERSATIONAL_GUIDE.md` — 10th overlay + escape hatch update

---

## Phase 27 — Conversational Agents (28 Feb 2026)

**`config_manage agents`** — 25th action in the conversational system:

- Full agent CRUD via chat: list, get, create, update, delete
- Auto-derived workspace at `~/.genosv1/workspace-{id}` — no manual paths
- Full bootstrap: AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, SECURITY.md, BOOTSTRAP.md
- **Automatic encryption** of all workspace files on creation (NYXENC1 + chmod 600)
- Safe delete: responds first, deletes files 3s later (prevents crash from self-deletion)

**SECURITY.md** — new anti-injection template:

- Automatically injected into every new agent
- Covers: identity verification, prompt injection patterns, session integrity, trust scope
- Included in `WORKSPACE_ENCRYPT_PATTERNS`

**Smart Delegation** — intelligent delegation guide in AGENTS.md:

- Dedicated agents only for recurring and specialized needs
- Per-session model routing: routine tasks to cheap models (Haiku, Flash)

**Sidebar — improved session tree:**

- Agent groups always visible (collapsible), with friendly name + emoji
- ✕ button to delete agents (with confirmation and deduplication)
- Implicit main session per agent (with welcome message on first click)
- Rename blocked on main sessions (dblclick + popover label disabled)
- Clean display names: `agent:seo:f2caa4a...` → `F2CAA4A...`
- Topbar shows agent name (with emoji) instead of raw ID

---

## Phase 28 — Smart Model Routing (1 Mar 2026)

**Heuristic prompt classification into 3 complexity tiers:**

- **Module:** `src/agents/model-routing.js` — `classifyPromptTier()` + `resolveRoutedModel()`
- **Integration:** `run.js` — after hook check, before `resolveModel()`. Hooks still have priority.
- **Config:** `agents.defaults.model.routing.enabled` (default: false)
- **Tiers:** `routing.tiers.simple` / `.normal` / `.complex`
- **Scoring:** token count, code markers, analysis/reasoning keywords, image count, cron context, turn depth
- **Thresholds:** score ≤ 2 → simple, 3–7 → normal, > 7 → complex
- **Cron bias:** score −3 when sessionKey starts with "cron:"
- **4 new blueprints:** routing.enabled + 3 tier models → 145 total
- Zod schema updated with `routing` field

---

## Phase 29 — HEARTBEAT label fix (1 Mar 2026)

- Skip `originLabel` fallback for main sessions — prevents HEARTBEAT from overwriting the label

---

## Phase 30 — Static Model Catalog (1 Mar 2026)

**Single source of truth for all curated models.**

### Created

- `src/agents/static-model-catalog.json` — 4 providers × 3 tiers (complex/normal/simple)
  - **OpenAI:** gpt-5.2 / gpt-5-mini / gpt-5-nano
  - **Anthropic:** claude-opus-4-6 / claude-sonnet-4-6 / claude-haiku-4-5-20251001
  - **Google:** gemini-2.5-pro / gemini-2.5-flash / gemini-2.5-flash-lite (stable, no preview)
  - **GitHub Copilot:** claude-opus-4.6 / claude-sonnet-4.5 / gpt-5-mini
- Each model: id, name, reasoning, input, maxTokens, contextWindow, cost (input/output/cacheRead/cacheWrite)

### Modified

- `models-config.providers.js` — `buildOpenAIProvider()`, `buildAnthropicProvider()`, `buildGoogleProvider()` read from JSON via `catalogToModels()`. Removed 15+ duplicate constants (`*_KNOWN_COSTS`, `*_BASE_URL`, `*_DEFAULT_*`) and `resolveCostByPrefix()`
- `github-copilot-models.js` — `getDefaultCopilotModelIds()` and `buildCopilotModelDefinition()` read from catalog, with heuristic fallback for custom IDs
- `models-config.js` — force-override reads directly from JSON; builder imports removed

### Price Correction

- Google Gemini 2.5 Flash: $0.15/$0.60 → **$0.30/$2.50** (cache read $0.05) — per current Google pricing

### Verification

- 744 test files / 6339 tests passed — 0 failures

### What Does NOT Change

- `resolveImplicitProviders()` — still resolves API keys from env/profiles
- Bedrock, vLLM, Venice, Huggingface — dynamic discovery unchanged
- `loadModelCatalog()` — still reads generated models.json
- `model-routing.js` — still reads tiers from `genosos.json` config
- All merge logic with user-explicit providers

---

## Phase 37 — Subagent Delegation Blueprints + Auto-Wire (2 Mar 2026)

**Inter-agent delegation: from manual to automatic and conversational.**

### Problem Solved

GenosOS has a complete inter-agent delegation system (spawn, send, steer, ping-pong), but its configuration required editing `genosos.json` manually. If a user said "create an SEO agent that can delegate to the researcher", the agent could create the agent but could NOT configure delegation permissions, spawn depth, or agent-to-agent messaging — that required manual JSON editing.

**Now:** when creating an agent, communication is configured automatically. Zero friction.

### Auto-wire on agents.create

`wireAgentCommunication(cfg, agentId)` — runs automatically when creating any agent:

- Enables `tools.agentToAgent.enabled: true` if not already set
- Adds the agentId to the `tools.agentToAgent.allow` list
- **Result:** the agent can delegate work to the new agent immediately, no additional config

**User flow:**

> "Create an agent specialized in SEO"
> → agent creates the agent + auto-configures bidirectional communication → ready to delegate

### Auto-cleanup on agents.delete

Enhanced `pruneAgentConfig()` — when deleting an agent, cleans ALL delegation traces:

1. Removes the agent from `agents.list`
2. Removes its bindings
3. Removes the agentId from `tools.agentToAgent.allow`
4. **NEW:** Removes the agentId from `subagents.allowAgents` of ALL other agents
5. **NEW:** If `tools.agentToAgent.allow` becomes empty, auto-disables `agentToAgent.enabled: false`

### 11 new blueprints (145 → 156 total)

All delegation config is now conversational via `config_manage set/describe`:

**Subagent defaults (5):**
| Path | Type | Description |
|------|------|-------------|
| `agents.defaults.subagents.maxSpawnDepth` | number | Nesting depth (1=flat, 2=orchestrator, max 5) |
| `agents.defaults.subagents.maxChildrenPerAgent` | number | Active children per session (1-20, default 5) |
| `agents.defaults.subagents.maxConcurrent` | number | Global cap of concurrent subagents (default 8) |
| `agents.defaults.subagents.archiveAfterMinutes` | number | Minutes to archive completed session (default 60) |
| `agents.defaults.subagents.thinking` | enum | Thinking level for subagents (off/minimal/low/medium/high/xhigh) |

**Per-agent overrides (3):**
| Path | Type | Description |
|------|------|-------------|
| `agents.list.*.subagents.allowAgents` | array/string | Agent IDs it can spawn. `"*"` = any |
| `agents.list.*.subagents.model` | scalar | Model override for this agent's subagents |
| `agents.list.*.subagents.thinking` | enum | Thinking level for this agent's subagents |

**Agent-to-agent messaging (2):**
| Path | Type | Description |
|------|------|-------------|
| `tools.agentToAgent.enabled` | smart | Master switch for inter-agent messaging (default false) |
| `tools.agentToAgent.allow` | array/string | Agent IDs allowed for cross-agent messaging. Supports globs |

**Session ping-pong (1):**
| Path | Type | Description |
|------|------|-------------|
| `session.agentToAgent.maxPingPongTurns` | number | Max turns in agent-to-agent conversation (0=fire-and-forget, default 5) |

### Blueprint routing

- `tools.agentToAgent.*` → resolves to `agents` section via `BLUEPRINT_ROOT_MAP` (tools → agents)
- `agents.defaults.subagents.model` → resolves to `models` section via `BLUEPRINT_PREFIX_MAP`
- `session.agentToAgent.*` → resolves to `session` section (native)

### Files modified (7)

1. `src/agents/tools/blueprints/agents.js` — +10 blueprints
2. `src/agents/tools/blueprints/sessions.js` — +1 blueprint
3. `src/agents/tools/blueprints/index.js` — +1 prefix map entry
4. `src/agents/tools/blueprints/blueprints.test.js` — +15 tests
5. `src/commands/agents.config.js` — `wireAgentCommunication()` + enhanced `pruneAgentConfig()`
6. `src/gateway/server-methods/agents.js` — auto-wire in create handler
7. `src/gateway/server-methods/agents-mutate.test.js` — mock updated

### Verification

- 59/59 blueprint tests passed
- 20/20 agents-mutate tests passed
- 907/907 test files passed (7944 tests) — 0 regressions

### What This Means

**BEFORE:** The agent could create agents but could not configure them to communicate with each other. Delegation was invisible to the conversational system — required manual JSON editing.

**NOW:** The agent creates an agent and it is automatically ready to delegate work. If the user wants to adjust limits (depth, concurrency, thinking), they can do so conversationally. If they delete the agent, all delegation config is cleaned up automatically.

**Impact:** GenosOS's multi-agent system is now 100% conversational and zero-friction. A user without technical knowledge can orchestrate specialized agents simply by chatting.

---

## Phase 39 — Subagent Waiting Indicator + Auto-Delete (2 Mar 2026)

### Visual indicator in main chat

When the agent delegates to a subagent, the main chat now shows `✢ Waiting for {label}…` with an animated spinner while the subagent works. Hides automatically when:

- The subagent finishes (`running` = false via `sessions.changed` broadcast)
- There is an active stream (the thinking spinner already covers that case)

**Files:**

- `ui/src/ui/chat/grouped-render.js` — `renderSubagentWaitingGroup()` reuses `.cli-thinking-spinner` CSS
- `ui/src/ui/views/chat.js` — injects `subagent-waiting` item in `buildChatItems()` + render case in `repeat()`

### Subagent session auto-delete

Cleanup default changed from `"keep"` to `"delete"` — subagent sessions are automatically deleted on completion.

**Files:**

- `src/agents/tools/sessions-spawn-tool.js` — default `"keep"` → `"delete"`
- `src/agents/subagent-spawn.js` — same fix

### Impact

- The user sees in real time that a subagent is working without needing to check the sidebar
- Subagent sessions no longer accumulate clutter in the sidebar — they self-clean

---

## Phase 40 — Transparent Write/Edit Encryption + Console Log + Test Fix (2 Mar 2026)

### Transparent encryption in write/edit

**Problem:** Agents could READ NYXENC1 encrypted files (transparent decrypt in `read` tool), but when WRITING they used plain `fs.writeFile` — saving in plaintext inside the encrypted workspace.

**Solution:** `createSecureWriteOperations(workspaceRoot)` and `createSecureEditOperations(workspaceRoot)` in `pi-tools.read.js`:

- **Write ops:** detects if path is inside the workspace → uses `secureWriteFile` (auto-encrypts) instead of `fs.writeFile`
- **Edit ops:** in addition to encrypting on write, detects `NYXENC1\n` prefix when reading for diff → decrypts before patch, re-encrypts on save
- Passed to SDK via `createWriteTool(root, { operations })` / `createEditTool(root, { operations })`

**Applies to ALL agents** — each uses its own `workspaceRoot` from `resolveAgentWorkspaceDir()`.

**Files:**

- `src/agents/pi-tools.read.js` — +2 exported functions
- `src/agents/pi-tools.js` — passes operations to SDK constructors

### Console log truncation

**Problem:** When a subagent announced results, the full text (long markdown) was dumped to the gateway console via `formatOutboundPayloadLog()`.

**Solution:** Truncate to first line (max 160 chars) + suffix `(+N lines)`.

**File:** `src/infra/outbound/payloads.js`

### Fix agent.test.js vi.mock

**Problem:** Pre-existing — `vi.mock("../../config/config.js")` did not preserve `STATE_DIR` and other re-exports from `paths.js`.

**Solution:** Use `vi.importActual()` + spread + override only `loadConfig`.

**File:** `src/gateway/server-methods/agent.test.js`

---

## Phase 41 — Disconnect Toast CLI Style (2 Mar 2026)

### Problem

The disconnect toast was a `<div class="callout danger">` red block that broke the flat CLI aesthetic of the chat.

### Solution

Replaced with a `chat-group system` group using `● [SYSTEM]` with the `.cli-prompt--error` class (red semaphore dot), consistent with the Claude Code CLI style of the rest of the chat.

**File:** `ui/src/ui/views/chat.js` — section `props.disabledReason || props.error`

---

## Phase 42 — `vault write` CLI Command (2 Mar 2026)

### Problem

GenosOS had `vault cat` to read NYXENC1 files, but had no symmetric way to WRITE encrypted files from the CLI. The only method was invoking `secureWriteFile` programmatically with `bun -e "..."` — a fragile workaround that required knowing project internals and was lost between sessions.

### Solution

New `vault write <dest> [source]` subcommand in `src/cli/vault-cli.js`:

```
genosos vault write <dest> [source]
```

- **With source:** reads the plaintext file, encrypts with NYXENC1, writes to `<dest>`
- **Without source:** reads from stdin (pipe-friendly)
- Resolves passphrase with the same chain as `vault cat`: env → Keychain → interactive prompt
- Creates intermediate directories automatically (`mkdir -p`)
- Uses `encryptContent()` from `memory-encryption.js` — the same engine as `vault lock`

### Usage examples

```bash
# Read encrypted
bun genosos.mjs vault cat ~/.genosv1/workspace/memory/file.md

# Write from file
bun genosos.mjs vault write ~/.genosv1/workspace/memory/file.md /tmp/plaintext.md

# Write from stdin (pipe)
echo "content" | bun genosos.mjs vault write ~/.genosv1/workspace/memory/file.md

# Typical workflow for editing encrypted files
vault cat file.md > /tmp/file.md   # decrypt
# ... edit /tmp/file.md ...
vault write file.md /tmp/file.md   # re-encrypt
rm /tmp/file.md                    # cleanup
```

### File modified

- `src/cli/vault-cli.js` — +42 lines: command registration + action handler + help example

### Verification

- Tested with stdin pipe: `echo "test" | vault write /tmp/test.md` → NYXENC1 header ✓
- Tested with source file: `vault write /tmp/dest.md /tmp/src.md` → roundtrip ok ✓
- `vault cat` correctly reads what was written by `vault write` ✓
- Help updated with new example ✓

### Impact

`vault cat` + `vault write` = complete symmetric pair for reading/writing NYXENC1 files from CLI. Eliminates the need for workarounds with `bun -e` or programmatic `secureWriteFile`. Documented in MEMORY.md as standard method.

---

## Phase 43 — Subagent Session Continuation (2 Mar 2026)

Spawn once, continue via `sessions_send`. The announce now includes `childSessionKey` + continuation hint, tool descriptions guide spawn-vs-send, and the visibility guard allows spawned cross-agent sessions.

---

## Phase 44 — Seamless A2A (2 Mar 2026)

Cross-agent decoupled from visibility. Ping-pong default 2 turns (max 5). Display names via `resolveAgentDisplayName()`. `resolveAgentIdByNameOrId()` for case-insensitive name→ID resolution. Announce skip for webchat. `crossVisibilityMessage()` removed. Sidebar real-time for inter-session runs.

---

## Phase 45 — Agent Rename (2 Mar 2026)

`agents.rename` RPC migrates agent technical ID atomically: `agents.list[].id`, bindings, A2A allow, `subagents.allowAgents`, session keys (`store-migrate.js`), config. Zero filesystem operations (dirs use opaque UUID). `config_manage agents rename {old} {new}` from chat. `PROTECTED_SET_PATHS` blocks direct `set` on `agents.list[*].id` — forces rename RPC.

---

## Phase 46 — Config Editor + Config Map Hub (2 Mar 2026)

`/config show` opens JSON editor overlay (syntax highlighting, Touch ID gate). `/config` opens Config Map. Bidirectional navigation: Config Map has "Edit JSON" → editor; Config Editor has "Config Map" → returns to map. Both modals share canvas `height: min(90vh, 960px)`.

---

## Phase 47 — Canvas Host (2 Mar 2026)

Inherited from OpenClaw, fully implemented. `canvasHost.enabled: true` in config. Server on port 18793, serves HTML/CSS/JS from configurable root. 5 actions: present, hide, navigate, eval, snapshot. Live reload via WebSocket. Agent tool `canvas-tool.js`, CLI `genosos nodes canvas`.

---

## Phase 48 — Opaque UUID Agent Directories (3 Mar 2026)

### Problem

When renaming an agent (`agents rename old new`), the handler moved `agents/{oldId}/` → `agents/{newId}/` and `workspace-{oldId}/` → `workspace-{newId}/`. This crashed with ENOENT because the running session was still writing transcripts to the old path. Config corruption from concurrent reads during write.

### Solution

Directories now use an opaque 8-character hex token (e.g. `a7f3e1b2`) generated by `generateAgentDirId()` in `src/agents/agent-dir-id.js`. The agent ID is purely a config concept. Rename = config + session key rewrite only. Zero filesystem operations.

**`resolveAgentSessionsDir`** now checks config `agentDir` first, fallback to ID derivation (backwards compat for main and legacy agents).

### Files

- `src/agents/agent-dir-id.js` — NEW (3 lines)
- `src/config/sessions/paths.js` — check config before deriving path
- `src/gateway/server-methods/agents.js` — create with opaque UUID, rename without fs ops
- `src/logging/diagnostic-session-state.js` — `hasActiveSessionsForAgent()` removed

---

## Phase 49 — Agent Session Bootstrap (3 Mar 2026)

### Problem

When creating an agent, the `agent:{id}:main` session did not exist until the user clicked it. There was no welcome greeting with the configured persona.

### Solution

`agents.create` now:

1. Pre-creates the session in `sessions.json` via `updateSessionStore` with `initializing: true` flag
2. Fires `callGateway({ method: "agent", message: "/new" })` fire-and-forget to generate the greeting
3. On completion, clears `initializing` and broadcasts `sessions.changed`

Sidebar shows pulsing gold working dot while the greeting generates.

---

## Phase 50 — Sidebar Real-Time Agents (3 Mar 2026)

`sessions.changed` handler in `app-gateway.js` now calls `loadSessions()` + `loadAgents()`. Previously only refreshed sessions — deleted agents remained visible until browser refresh.

---

## Phase 51 — Config Cache Invalidation (3 Mar 2026)

`writeConfigFile()` now clears `configCache` (200ms TTL) immediately after writing. Previously, post-write broadcasts (e.g. `sessions.changed` on delete) caused the UI to fetch stale cached config.

---

## Phase 52 — Residual Directory Cleanup (3 Mar 2026)

Removed legacy directories `agents/amigo-nyx/`, `workspace-amigo-nyx/`, `agents/greeter/`. `amigo-nyx` was Lumina's old ID (pre-rename); its residual sessions caused A2A messages to route there instead of `agent:lumina:main`.

---

## Phase 53 — A2A Agent Existence Guard (3 Mar 2026)

### Problem

`sessions_send` allowed sending to agents that did not exist in config. `resolveAgentIdByNameOrId()` returned the normalized input as fallback even for non-existent agents. `resolveAgentSessionsDir` fallback created phantom directories.

### Solution

Post-resolution validation in `sessions-send-tool.js`: if `requestedAgentId` does not exist in `agents.list` via `resolveAgentConfig()`, returns error with guidance: "Check available agents with: config_manage agents list".

**Production result:** The agent tried `amigo-nyx` → received error → queried `agents list` → re-sent to `lumina` → successful 4-turn A2A conversation.

---

## Phase 54 — Contextual Activity Hints + A2A UI Polish (3 Mar 2026)

### Activity Hints

The generic "Nyx is thinking..." spinner now shows contextual state based on the last active tool call:

| Tool             | State                 |
| ---------------- | --------------------- |
| `sessions_send`  | Talking to LUMINA...  |
| `sessions_spawn` | Spawning {label}...   |
| `memory_search`  | Searching memory...   |
| `read`           | Reading {filename}... |
| `write`          | Writing {filename}... |
| `edit`           | Editing {filename}... |
| `bash` / `exec`  | Running command...    |
| `browser`        | Browsing...           |
| `config_manage`  | Updating config...    |
| `web_search`     | Searching the web...  |
| `message`        | Sending message...    |
| `tts`            | Generating speech...  |
| no active tool   | {name} is thinking... |

**Files:** `grouped-render.js` (`resolveActivityHint`), `app-render.js` (`resolveActiveTool`), `views/chat.js` (prop propagation).

### A2A Stop Token Cleanup

`REPLY_SKIP` and `ANNOUNCE_SKIP` — internal tokens that agents use to cut the ping-pong — are no longer visible in the chat. Stripped in `message-extract.js` via `stripA2AStopTokens()` for both roles (assistant and user/inter-session). When a stop token is detected, a `● [SYSTEM] Agent-to-agent conversation ended.` message is injected — clear feedback for the user about why the dialogue stopped.

---

## Roadmap — Where GenosOS is Headed

### Vision

GenosOS evolves from "dashboard with chat" to **pure conversational gateway**. The browser UI shrinks to the minimum (overlays) while the agent handles everything via chat.

### Completed

- **UI -> Conversational:** 100% tabs eliminated. Management via `config_manage` (25 actions) + 10 overlays.
- **Config Map + Config Editor:** discovery grid with 13 sections × 3 clickable phrases + JSON editor with Touch ID gate. Bidirectional navigation.
- **157 blueprints:** complete declarative validation of all config (includes routing + delegation + agents).
- **Unified providers:** single source of truth for credentials, endpoints, models and failover + interactive overlay.
- **Static Model Catalog:** `static-model-catalog.json` — single file to update curated models without touching JS code.
- **Smart Model Routing:** automatic simple/normal/complex classification per prompt, model selection by tier.
- **Security hardened:** vault NYXENC1, WebAuthn/Touch ID, Fortress Mode, audit log, rate limiting, transparent write/edit encryption.
- **Memory system:** vector search + TOON encoding + structured templates + smart prefetch.
- **Local-first AI:** Ollama with dynamic discovery, local Kokoro TTS.
- **Multi-agent A2A:** Seamless agent-to-agent with ping-pong turns, opaque UUID dirs, atomic rename without filesystem ops, agent existence guard, auto-greeting on create.
- **Canvas Host:** server on port 18793, 5 actions, live reload via WebSocket.
- **Activity Hints:** 20 contextual spinner states (Talking to..., Reading..., Searching memory...).
- **A2A UI Polish:** REPLY_SKIP/ANNOUNCE_SKIP stripped from chat, [SYSTEM] notice on conversation end.

### Open Areas

- **`MODELS.md`** — document routing, fallbacks, discovery, Ollama for the agent workspace
- **Mobile apps** — `apps/ios/` and `apps/android/` exist but not updated

### Ideas in Development

- **Agent Hippocampus** — fine-tune local model as MEMORY (not personality). Mistral 7B v0 completed.
- **GenosDB AI Module** — ultralight model (~30-50 MB) for natural language -> JSON query, 100% client-side
- **Pulsar Channel** — direct Opus <-> local model routing without filters
- **Twilio PBX** — intelligent IVR with agent voice
- **HomePod Channel** — Mac as brain, HomePod as ears/mouth

---

## Phase 55 — Operational Guides System (4 Mar 2026)

### Problem

The blueprints (164 entries) provide validation/coercion per path, but are loose pieces — one guidance phrase per field. For complex configurations (TLS, subagents, channel policies) the agent had to infer the order and dependencies between paths. Result: unnecessary tool calls (read SKILL.md, docs/, etc.), questions to the user it could resolve itself, and sequence errors.

### Solution — Layered Instruction Architecture

4 layers, each with a distinct purpose:

| Layer            | Where                              | When loaded                    | Purpose                                     |
| ---------------- | ---------------------------------- | ------------------------------ | ------------------------------------------- |
| AGENTS.md        | Boot-time system prompt            | Every session                  | Global behavior ("use config_manage FIRST") |
| Tool description | config-manage-tool.js              | Every session                  | Tool mechanics (params, sub-actions)        |
| Guides           | `src/agents/tools/guides/*.md`     | On-demand via loadGuide()      | Complex flows, diagnostics, decision trees  |
| Blueprints       | `src/agents/tools/blueprints/*.js` | On-demand via matchBlueprint() | Validation, coercion, crossField rules      |

### 12 Operational Guides (1867 lines total, zero footprint until requested)

| Guide                | Lines | Path                      | Covers                                       |
| -------------------- | ----- | ------------------------- | -------------------------------------------- |
| discord.md           | 202   | `channels discord.setup`  | Bot token, guild, presence, error 4014       |
| imessage.md          | 121   | `channels imessage.setup` | Full Disk Access, cliPath, dbPath, probe     |
| slack.md             | 164   | `channels slack.setup`    | Socket/Events mode, tokens, signing secret   |
| signal.md            | 144   | `channels signal.setup`   | signal-cli, phone linking, groups            |
| nostr.md             | 107   | `channels nostr.setup`    | Relays, private key, profile, NIP-05         |
| matrix.md            | 154   | `channels matrix.setup`   | Homeserver, E2EE, room allowlist             |
| providers.md         | 137   | `providers setup`         | API keys, interactive auth, Ollama, failover |
| agents.md            | 226   | `agents setup`            | Tool profiles, subagent orchestration, A2A   |
| channels-overview.md | 201   | `channels overview`       | Policy hierarchy, DM scopes, common patterns |
| sessions.md          | 144   | `sessions setup`          | Reset modes, maintenance, pruning            |
| gateway.md           | 122   | `gateway`                 | Bind modes, TLS, auth, reload                |
| advanced.md          | 145   | `advanced`                | Canvas, plugins, shell env, diagnostics      |

### Diagnostic Directive

All guides use the same pattern:

> "STOP. Do NOT guess. Follow this checklist strictly in order — resolve what you can, inform what you know, ask only what you cannot determine."

The agent investigates (probe, get, list), interprets errors, and TELLS the user what to do. Only asks what it cannot determine on its own.

### Technical Fixes Included

- **Probe propagation:** `formatChannelStatus` now includes `ch.probe` → the agent sees specific errors
- **iMessage connected status:** `connected = probe?.ok ?? (running && !lastError)` — SQLite-based channels have no persistent connection
- **Generalized loadGuide():** was `loadChannelGuide(channel)`, now `loadGuide(name)` for any topic
- **Updated AGENTS.md template:** 10 routing points in "config_manage First" section
- **Product-ready:** all instructions use "the user" instead of personal names

### Measurable Result

| Metric                            | Before                              | After                           |
| --------------------------------- | ----------------------------------- | ------------------------------- |
| Tool calls for typical setup      | 4-5 (SKILL.md + docs + probe + set) | 1-2 (guide + set)               |
| Tokens per session without config | ~164 guidance strings always loaded | 0 (on-demand)                   |
| Autonomous diagnostics            | Asked the user                      | Investigates, informs, resolves |
| Adding new channel/topic          | Blueprints + system prompt + hope   | 1 .md file in guides/           |

---

## Interactive Chat Components — nyx-ui System (4 Mar 2026)

New system of interactive components rendered inline in chat. Replaces modals/overlays with visual components that the agent generates as `nyx-ui` code blocks with structured JSON.

### Architecture

````
Agent generates response with ```nyx-ui { JSON } block
  → markdown.js intercepts lang="nyx-ui"
  → JSON.parse → renderInteractiveComponent(data)
  → renderers.js produces HTML with ix-* classes + data-action attrs
  → DOMPurify sanitizes (div, button, data-* allowed)
  → unsafeHTML() in .chat-text
  → User clicks button [data-action]
  → chat.js :: handleInteractiveClick()
    action=chat → prefill textarea (user confirms with Enter)
    action=rpc  → client.request() direct
````

### 4 Component Types

| Component     | Use                                   | Real Example                          |
| ------------- | ------------------------------------- | ------------------------------------- |
| `status-grid` | Cards with semaphores (●) and buttons | Channels status, Providers status     |
| `stat-bars`   | Horizontal bars with percentage       | Usage per provider, token consumption |
| `data-table`  | Table with per-row actions            | Skills list, logs snapshot            |
| `key-value`   | Key-value pairs with optional dot     | Provider/channel detail               |

### New Files

- `ui/src/ui/interactive/renderers.js` — 4 pure renderers (JSON → HTML string) + escapeHtml + dispatcher
- `ui/src/styles/chat/interactive.css` — ix-\* classes with existing CSS vars, 21 width classes for bars (0-100 in steps of 5)
- `src/agents/tools/blueprints/guides/interactive-ui.md` — agent guide with JSON schemas, dot color mapping, action rules

### Overlays Removed

| Overlay removed              | Replaced by          | Lines removed |
| ---------------------------- | -------------------- | ------------- |
| `channels-status-overlay.js` | `status-grid` inline | 170           |
| `providers-overlay.js`       | `status-grid` inline | 63            |
| `skills-overlay.js`          | `data-table` inline  | 73            |

Infrastructure removed per overlay: pending Map + create/resolve functions in web.js, 2 RPCs (initiate/complete), state props + decorators + dismiss method in app.js, 2 event handlers in app-gateway.js, import + render in app-render.js.

**Total:** -417 lines of overlay infrastructure, +614 lines of nyx-ui system.

### Overlays Kept as Modals

Usage Chart (Canvas stacked bars, too complex for pure CSS), Tools Status, Config Editor, Files Browser, Cron Board, Config Map, WhatsApp QR, Telegram Setup, Exec/File Approval, WebAuthn.

### Fix: Chat Streaming Flicker

Two causes identified and fixed:

1. **`fade-in` animation during streaming** — `grouped-render.js`: the `fade-in` class (200ms opacity 0→1) was applied to ALL bubbles including streaming. Each delta recreated the DOM and restarted the animation. Fix: `opts.isStreaming ? "streaming" : "fade-in"`.

2. **Unstable `streamStartedAt`** — `controllers/chat.js`: `chatStreamStartedAt = Date.now()` executed on EVERY delta, changing the group key in `repeat()`. Lit destroyed and recreated the DOM on each chunk. Fix: `chatStreamStartedAt ??= Date.now()` — only assigned once at stream start.

### Fix: Vault read rule in AGENTS.md

Added permanent rule in AGENTS.md (workspace + template):

- `memory_get` → required method for files in `memory/` (changelog, authentication, etc.)
- `memory_search` → alternative for semantic search
- **NEVER use `read` for files in `memory/`** — can fail with large workspace files

### Commit

`cea792f82` — `feat: nyx-ui interactive chat components — inline status-grid, stat-bars, data-table, key-value`

---

## Fix: Smart Model Routing respects session override (4 Mar 2026)

### Problem

When the agent (or the user) explicitly changed a session's model via `session_status` (e.g. "switch to opus"), Smart Model Routing overwrote the change on the next request. Logs showed:

```
tool ✓ session_status → opus
[model-routing] tier=normal → anthropic/claude-sonnet-4-6
```

The model reverted to Sonnet despite the session having an explicit override to Opus.

### Root Cause

`runEmbeddedPiAgent` in `run.js` line 214 only checked hook overrides (`modelResolveOverride?.modelOverride`) before executing automatic routing. The `hasSessionModelOverride` flag existed in `agent.js` (line 461) but was NOT propagated to the runner.

### Fix (3 lines)

1. **`run.js:214`** — condition expanded: `&& !params.hasSessionModelOverride`
2. **`agent.js:77`** — propagates `hasSessionModelOverride` to `runEmbeddedPiAgent`
3. **`agent.js:497`** — passes `hasSessionModelOverride: Boolean(storedModelOverride)` to `runAgentAttempt`

### Resulting Behavior

- **Routing works normally** when there is no session override (subagents, default sessions)
- **Routing is skipped** when there is an explicit `modelOverride` in the session
- Priority hierarchy: hook override > session override > automatic routing > default model

### Commit

`1a5217238` — `fix: respect session model override in smart routing — skip automatic tier routing when user/agent explicitly changed model`

### Additional Fix: Agent Primary Model Guard

The first fix (`hasSessionModelOverride`) did not cover the main case: the agent has `agents.list[].model: "opus"` as PRIMARY model. It is not a session override — it is the agent's configuration. Routing ignored it and degraded to Sonnet.

**Root cause:** `resolveRoutedModel()` always executed when there was no hook or session override. But the agent's primary model is not an "override" — it is the base configuration. Routing was overwriting it.

**Fix:** New `hasAgentModelPrimary` flag (based on `resolveAgentModelPrimary(cfg, agentId)`) propagated alongside `hasSessionModelOverride`. Final condition in `run.js`:

```javascript
if (!hookOverride && !sessionOverride && !agentModelPrimary) { routing... }
```

**Resulting hierarchy:**

- Hook override > Session override > Agent primary model > Smart Routing > Global default
- Routing ONLY applies to agents without explicit model (temporary subagents)
- Main agent (explicit Opus) never degrades
- Subagents without model → routing classifies and assigns tier

**Commits:**

- `1a5217238` — fix: session override guard
- `e43296844` — fix: agent primary model guard (definitive fix)

### Definitive Fix: Routing scoped to subagents

The second fix (`hasAgentModelPrimary`) also did not work because the main agent's model comes from `agents.defaults.model.primary` (global), NOT from `agents.list[].model`. `resolveAgentModelPrimary("main")` always returned `undefined`.

**Final fix:** `isRoutingExcluded()` in `model-routing.js` — routing is COMPLETELY skipped for the default/main agent. Only applies to non-default subagents.

```javascript
const isRoutingExcluded = (config, agentId) => {
  if (!agentId || agentId === "main") return true;
  const entry = agents.find((a) => a.id === agentId);
  return entry?.default === true;
};
```

**Commit:** `9bdf3e359` — `fix: scope smart routing to subagents only`

---

## Provider + Tier Architecture (4 Mar 2026)

### Problem

Smart Model Routing had multiple bugs that prevented changing models conversationally:

1. Allowlist blocked models: `agents.defaults.models` only had Opus → Sonnet/Haiku blocked
2. Race condition in session-store: `updateSessionStoreAfterAgentRun()` overwrote fresh overrides with stale values from in-memory entry
3. Config hardcoded model names instead of expressing provider + tier
4. UI dropdown did not sync when changing model via chat

### Solution — 6 coordinated changes

**1. `model.defaultTier` replaces `model.primary`:**
Config expresses intent (tier) not concrete model. `defaultTier: "normal"` → `routing.tiers.normal` → `anthropic/claude-sonnet-4-6`.

```json
{
  "agents": {
    "defaults": {
      "model": {
        "defaultTier": "normal",
        "routing": {
          "enabled": true,
          "tiers": {
            "simple": "anthropic/claude-haiku-4-5",
            "normal": "anthropic/claude-sonnet-4-6",
            "complex": "anthropic/claude-opus-4-6"
          }
        }
      }
    }
  }
}
```

**2. Bare model aliases:** "opus", "sonnet", "haiku" as shorthand in ANTHROPIC_MODEL_ALIASES. Allows "switch to sonnet" directly.

**3. Auto-allow routing tiers:** `buildAllowedModelSet()` automatically adds all 3 routing tier models to the allowlist. No need to declare them in `agents.defaults.models`.

**4. Session-store race fix:** `updateSessionStoreAfterAgentRun()` strips `modelOverride`/`providerOverride` from merge payload. These fields are exclusively managed by `session_status` and `sessions.patch`.

**5. Tier name resolution:** `resolveModelOverride()` in session-status-tool accepts tier names ("switch to complex" → routing.tiers.complex → opus).

**6. UI dropdown sync:** 3 parts:

- `session_status` broadcasts `sessions.changed` after writing modelOverride
- `resolveSessionModelRef` prioritizes `modelOverride` over `entry.model` (last-run)
- UI `syncModelFromSessionData()` updates dropdown from server data

### Routing exclusion — spawned subagents only

`isRoutingExcluded(sessionKey)` uses `isSubagentSessionKey()` — only sessions with "subagent:" in the key receive dynamic routing. All configured agents (main + specialists in agents.list) keep their fixed tier.

### Final Hierarchy

Hook override > Session override > Agent primary model > Smart Routing (subagents only) > defaultTier > Global default

### Files Modified

| File                                      | Change                                             |
| ----------------------------------------- | -------------------------------------------------- |
| `src/agents/defaults.js`                  | DEFAULT_TIER = "normal"                            |
| `src/agents/model-selection.js`           | Bare aliases + defaultTier resolution + auto-allow |
| `src/agents/tools/session-status-tool.js` | Tier names + broadcast                             |
| `src/commands/agent/session-store.js`     | Strip override fields from merge                   |
| `src/agents/model-routing.js`             | isRoutingExcluded via isSubagentSessionKey         |
| `src/agents/auto-config.js`               | Auto-set defaultTier                               |
| `src/gateway/session-utils.js`            | resolveSessionModelRef override-first              |
| `ui/src/ui/app.js`                        | syncModelFromSessionData()                         |
| `ui/src/ui/app-gateway.js`                | sessions.changed → syncModel                       |

### Commits

- `af3f7e87c` — `fix: normalize stale workspace paths in read/write/edit tools`
- `d597d4fd6` — `fix: preserve model override across agent runs`
- `5fd3b0179` — `fix: routing applies to all agents, explicit model changes always bypass it`
- `9bdf3e359` — `fix: scope smart routing to subagents only`
- `e43296844` — `fix: skip smart routing when agent has explicit primary model`
- `b0f61bf96` — latest

---

## TOON Operational Guides (4 Mar 2026)

### Problem

The 12 operational guides (markdown, 87KB total) had:

1. Redundancy — DM Policy, diagnostic intro, common patterns repeated in each channel guide
2. Markdown format — `#`, `**bold**`, ` ``` `, `|---|` consumed tokens without adding information
3. Organization by technical entity instead of by user intent

### Solution — TOON + Intent-first restructure

**Conversion to TOON:** Guides remain `.md` files but written in TOON format (the one already used by memory_search). No fences, no markdown formatting, labels with `:`, bullets with `·`. The agent interprets them identically — tested with the agent requesting "configure iMessage".

**Intent-first restructure:**

- `channels-overview.md` = common knowledge hub (policies, patterns, generic diagnostics, common paths)
- Each channel guide = only the delta (what is unique to that channel). References overview for the common parts.
- Domain guides (providers, agents, sessions, gateway, advanced) = optimized, no redundancy

**Backups:** `.md.bak` alongside each file for comparison.

### Result

| File                 | Before     | After      | Savings |
| -------------------- | ---------- | ---------- | ------- |
| agents.md            | 11,635     | 6,478      | 44%     |
| discord.md           | 9,690      | 5,398      | 44%     |
| channels-overview.md | 9,036      | 5,213      | 42%     |
| slack.md             | 7,650      | 4,463      | 41%     |
| sessions.md          | 6,809      | 3,696      | 45%     |
| providers.md         | 6,219      | 3,958      | 36%     |
| matrix.md            | 6,172      | 3,798      | 38%     |
| signal.md            | 5,922      | 3,099      | 47%     |
| gateway.md           | 5,301      | 2,869      | 45%     |
| advanced.md          | 5,380      | 3,299      | 38%     |
| imessage.md          | 5,081      | 2,507      | 50%     |
| nostr.md             | 4,180      | 2,315      | 44%     |
| interactive-ui.md    | 3,966      | 2,845      | 28%     |
| **TOTAL**            | **87,041** | **49,938** | **43%** |

37KB less. Each `loadGuide()` delivers ~43% fewer tokens to the agent. Zero code changes — `loadGuide()` remains direct `readFile`.

### TOON Format Principles in Guides

- `Title:` instead of `## Title`
- `Summary:` = contextual narrative (what is unique to the channel, what the agent needs to know first)
- `·` instead of `-` for bullets
- `Key: Value` instead of `**Key:** Value`
- Commands without fences — the agent knows that `config_manage set X Y` is a command
- Compact paths: `path: type, default — description` instead of markdown tables
- JSON schemas in interactive-ui.md keep fences (the agent needs the exact format)

### loadGuide() — no changes

```javascript
const loadGuide = async (name) => {
  const guidePath = join(toolsDir, "guides", `${name}.md`);
  return await readFile(guidePath, "utf8");
};
```

---

## Unified Capabilities Catalog (4 Mar 2026)

### Problem

The system prompt sent two competing instruction sets on every request:

1. Skills catalog (~9KB TOON) — 51 skills, instruction: "scan skills, if one matches → read SKILL.md"
2. config_manage description (~18.5KB) — 27 actions, instruction: "for ANY config → ALWAYS use config_manage, Do NOT read skill files"

Three contradictory IMPORTANT directives. Result: the agent spent tokens resolving ambiguity. Example: "configure discord" — the catalog has a `discord` skill, but config_manage says "always me first for config".

### Solution — Unified Capabilities Catalog

A single `## Capabilities (mandatory)` with two clear domains:

- **Skills** (→ path): external actions via CLIs/APIs → read SKILL.md
- **Config** (→ config_manage): GenosOS configuration → use config_manage tool

Disambiguation rule: "'send a message' = Skill, 'configure/setup the channel' = Config"

**config_manage description reduced 84%** — from ~18.5KB (176 lines with routing keywords in Spanish/English, detailed descriptions per subAction, 3 IMPORTANT directives) to ~3KB (54 lines: compact params schema, subActions `sub1|sub2|sub3`, overlay notes).

**In-memory skills entry cache** — `skillEntriesCache` (Map per workspaceDir+version) avoids disk re-scans. `clearSkillEntriesCache()` invalidates in `bumpSkillsSnapshotVersion`.

### Result

| Metric                    | Before          | After           | Savings |
| ------------------------- | --------------- | --------------- | ------- |
| config_manage description | ~18.5KB         | ~3KB            | 84%     |
| Total prompt per request  | ~27.5KB         | ~14KB           | ~49%    |
| Instruction conflicts     | 3 IMPORTANT     | 0               | 100%    |
| Disk I/O repeat requests  | scan every time | in-memory cache | ~0ms    |

### Files Modified

| File                                     | Change                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/skills/workspace.js`         | `CONFIG_CATALOG_ENTRIES` (19 entries) + unified `formatSkillsForPrompt` + `skillEntriesCache` + `clearSkillEntriesCache()` |
| `src/agents/system-prompt.js`            | `buildSkillsSection` → "## Capabilities (mandatory)" + disambiguation rules + `config_manage` summary                      |
| `src/agents/tools/config-manage-tool.js` | Description 18.5KB → 3KB                                                                                                   |
| `src/agents/skills/refresh.js`           | Import + call `clearSkillEntriesCache` in `bumpSkillsSnapshotVersion`                                                      |
| `src/agents/skills.js`                   | Re-export `clearSkillEntriesCache`                                                                                         |

### Production Validation

Tested live — 6 routing tests:

- "configure discord" → config_manage channels discord.setup ✓
- "send a message via discord" → reads discord SKILL.md ✓
- "show me the providers" → config_manage providers status ✓
- "what's the weather in Madrid" → web_fetch (skill) ✓
- "configure WhatsApp" → config_manage channels whatsapp ✓
- "create an SEO agent" → config_manage agents create ✓

---

## Prompt Efficiency — Preparation for Business Profiles (5 Mar 2026)

### Problem

System prompt pipeline sent ~27K tokens per request. Before building business profile flows, maximum efficiency is needed to avoid blowing context windows during multi-turn setup conversations.

### Changes

1. **coreToolSummaries eliminated** — 24-entry object + toolOrder array in system-prompt.js fully removed. Tool listing now uses canonicalToolNames directly. Cron reminder guidance migrated to cron-tool.js description. Savings: ~400 tokens/request.

2. **TOOLS.md lazy-load** — removed from `MINIMAL_BOOTSTRAP_ALLOWLIST`. Subagent and cron sessions no longer receive TOOLS.md (reference material, not boot-critical). Main sessions unaffected. Savings: ~1,000 tokens for subagent/cron sessions.

3. **AGENTS.md template reduction** — deleted "Configuration & Setup — config_manage First" section (lines 27-42). Fully redundant with Unified Capabilities Catalog (Phase 59). Savings: ~200 tokens/request.

4. **Skill description compaction** — 22 bundled skills trimmed from >100 chars to ≤100 chars in frontmatter `description`. Detailed "Use when" / "NOT for" guidance moved to SKILL.md body (read on-demand). Aligns with existing `SKILL_COMMAND_DESCRIPTION_MAX_LENGTH = 100`. Savings: ~300 tokens/request.

5. **Common prefix extraction** — `findCommonPrefix()` + updated `formatSkillsForPrompt` in skills/workspace.js. When >2 skills share a path prefix, catalog shows `Base: ~/path/` with relative paths below. Savings: ~625 tokens/request.

6. **Sectional guide loading + cache** — `loadGuide(name, section)` extracts individual TOON sections from guides. Module-level `guideCache` (Map) eliminates repeated filesystem reads. Backward-compatible: `loadGuide(name)` without section returns full guide.

7. **Skill description hygiene guideline** — added to AGENTS.md template Tools section: review third-party skill descriptions on install, keep ≤100 chars.

### Result

| Metric                             | Savings                   |
| ---------------------------------- | ------------------------- |
| coreToolSummaries removal          | ~400 tokens/req           |
| TOOLS.md lazy-load (subagent/cron) | ~1,000 tokens/session     |
| AGENTS.md template reduction       | ~200 tokens/req           |
| Skill description compaction       | ~300 tokens/req           |
| Common prefix extraction           | ~625 tokens/req           |
| Guide section + cache              | Variable (I/O + per-load) |
| **Total static savings**           | **~2,525 tokens/req**     |

### Files Modified

| File                                     | Change                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/agents/tools/cron-tool.js`          | Added reminder guidance to tool description (3 lines)                                        |
| `src/agents/system-prompt.js`            | Removed `coreToolSummaries` (24 entries) + `toolOrder` (24 entries), simplified tool listing |
| `src/agents/workspace.js`                | Removed `DEFAULT_TOOLS_FILENAME` from `MINIMAL_BOOTSTRAP_ALLOWLIST`                          |
| `docs/reference/templates/AGENTS.md`     | Deleted redundant config_manage section + added skill hygiene guideline                      |
| `src/agents/skills/workspace.js`         | `findCommonPrefix()` + updated `formatSkillsForPrompt` with prefix extraction                |
| `src/agents/tools/config-manage-tool.js` | `loadGuide` with optional `section` param + `guideCache` (Map)                               |
| 22 × `skills/*/SKILL.md`                 | Frontmatter descriptions compacted to ≤100 chars                                             |

---

## Agent Personality Injection — Foundation for Business Templates (5 Mar 2026)

### Problem

When a user says "create an SEO agent that's direct and concise", the personality instructions were lost. `agents.create` only passed `name` + `emoji` to the gateway. SOUL.md was always the generic template. The greeting agent _might_ customize SOUL.md, but it was inconsistent — dependent on model behavior, token budget, and whether the agent decided to edit the file during its greeting turn.

### Solution

Pass a `description` parameter through the full chain. The gateway injects a `## Purpose` section into SOUL.md **before encryption** and **before the greeting turn**. The agent is born knowing who it is from the first interaction.

### Changes

1. **Schema** — added `description: Type.Optional(Type.String())` to `AgentsCreateParamsSchema`.

2. **config_manage tool** — reads `path` param as personality/purpose description, passes it to the gateway `agents.create` call. Updated tool documentation to reflect the new parameter mapping.

3. **Gateway handler** — after appending identity to IDENTITY.md and before encrypting bootstrap files, injects `## Purpose\n\n{description}` into SOUL.md if `description` is provided.

4. **Agents guide** — documented the `path` param for description with usage example.

### Result

- **Deterministic:** personality is guaranteed in SOUL.md from the first turn, not dependent on model behavior
- **Backward compatible:** no description = generic SOUL.md template (unchanged behavior)
- **Nyx enriches intent:** user says "direct and concise" → Nyx expands to a full brief (style, format, language, monitored domains) and passes it as `description`
- **Greeting coherent with Purpose:** agent SEO greeted with "Qué hay. Soy SEO, tu agente de posicionamiento" — direct, no filler, exactly matching the injected Purpose

### Files Modified

| File                                                  | Change                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `src/gateway/protocol/schema/agents-models-skills.js` | Added `description` to `AgentsCreateParamsSchema`          |
| `src/agents/tools/config-manage-tool.js`              | Read `path` as description, pass to gateway, updated docs  |
| `src/gateway/server-methods/agents.js`                | Inject `## Purpose` section into SOUL.md before encryption |
| `src/agents/tools/guides/agents.md`                   | Documented description param with example                  |

### Strategic Significance — First Step Toward Business Templates

This is the **foundational mechanism** for specialized business templates. The same pattern — injecting structured content into workspace files during `agents.create` — will power the business profile system:

**Vision:** Each business type (dental clinic, law firm, online store, hair salon, restaurant, real estate agency, gym, etc.) will have a **specialized template** that:

1. **Injects business-specific Purpose** — not just personality, but domain knowledge, industry terminology, and operational context
2. **Guides connected services setup** — CRM integration (HubSpot, Salesforce, custom), appointment scheduling (Google Calendar, Cal.com), payment processing (Stripe, Square), inventory management
3. **Configures communication channels** — recommends channels by business type (WhatsApp for local businesses, Discord for tech communities, Slack for B2B), sets appropriate DM policies, configures auto-greetings
4. **Seeds operational knowledge** — business hours, services catalog, FAQ templates, pricing structures — injected into agent memory at creation time
5. **Applies security-by-default** — tool profiles, exec restrictions, and data handling policies tailored to the business's regulatory environment (GDPR for EU, HIPAA for healthcare, PCI for payments)

**Template structure (future):**

```
skills/business-setup/
├── templates/
│   ├── dental-clinic.json    → channels: WhatsApp+voice, connectors: calendar+CRM
│   ├── law-firm.json         → channels: email+voice, connectors: calendar+billing
│   ├── online-store.json     → channels: WhatsApp+Instagram, connectors: Stripe+inventory
│   ├── hair-salon.json       → channels: WhatsApp+Instagram, connectors: calendar+CRM
│   ├── restaurant.json       → channels: WhatsApp+voice, connectors: reservations+delivery
│   ├── real-estate.json      → channels: WhatsApp+email, connectors: CRM+calendar+listings
│   ├── gym-fitness.json      → channels: WhatsApp+app, connectors: membership+calendar
│   └── generic-business.json → baseline for any unlisted type
├── connectors/
│   ├── google-calendar.json
│   ├── hubspot.json
│   ├── stripe.json
│   └── ...
└── BUSINESS_FLOWS.md         → agent instructions for guided setup conversation
```

Each template defines: recommended channels, required connectors, Purpose text template, identity seed, tool profile, security posture, and a conversational flow that guides the business owner from "I want an assistant for my X" to a fully configured, connected, operational agent — all through natural conversation.

**Roadmap to business templates:**

```
B2 (channel guides) → B3 (provider guides) → B4 (services guides) → C (business templates)
                                                    ↑
                                              Phase 61 ✅
                                          (injection mechanism)
```

Phase B4 (Connected Services Guides) must come **before** business templates. Without TOON guides for voice/telephony (Twilio, Telnyx, Plivo), CRM connectors (HubSpot, Salesforce, Notion), payments (Stripe, Square), and calendar/scheduling (Google Calendar, Cal.com), the agent reaches "now let's connect your CRM" and improvises. B4 provides the step-by-step knowledge; Phase C templates orchestrate it per business type.

**Today's `description` param is the injection point. Tomorrow, templates will generate that description automatically based on business type, and reference B2/B3/B4 guides for each setup step.**

---

## Guided Business Setup Skill — Phase C (5 Mar 2026)

### Problem

A business owner must manually figure out which channels, services, and configuration to set up. There's no guided flow that asks "what kind of business?" and orchestrates agent creation + channel setup + service connections conversationally.

### Solution

Pure knowledge skill at `skills/business-setup/` with per-industry templates. No new JavaScript code. Nyx already has all the tools: `config_manage agents create` (with Phase 61 description injection), `config_manage services` (loads B4 service guides), `config_manage channels` (channel setup), and file reading (reads templates).

### Files Created

| File                                                            | Purpose                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `skills/business-setup/SKILL.md`                                | Skill definition — triggers, 10-step guided flow with tier escalation, safety rules, custom fallback   |
| `skills/business-setup/references/templates/dental-clinic.md`   | Dental clinic — WhatsApp + Voice, Calendar, CRM, Stripe                                                |
| `skills/business-setup/references/templates/law-firm.md`        | Law firm — WhatsApp + Email, Calendar, CRM, Stripe                                                     |
| `skills/business-setup/references/templates/online-store.md`    | Online store — WhatsApp + Discord/Telegram, Stripe, CRM                                                |
| `skills/business-setup/references/templates/restaurant.md`      | Restaurant — WhatsApp + Voice, Calendar, Stripe                                                        |
| `skills/business-setup/references/templates/real-estate.md`     | Real estate — WhatsApp + Email, Calendar, CRM, Stripe                                                  |
| `skills/business-setup/references/templates/hair-salon.md`      | Hair salon — WhatsApp, Calendar, CRM, Stripe                                                           |
| `skills/business-setup/references/templates/gym-fitness.md`     | Gym/fitness — WhatsApp, Calendar, CRM, Stripe recurring                                                |
| `skills/business-setup/references/templates/hotel.md`           | Hotel/accommodation — WhatsApp + Voice, Calendar, Stripe                                               |
| `skills/business-setup/references/templates/accounting-firm.md` | Accounting/tax firm — WhatsApp + Email, Calendar, CRM                                                  |
| `skills/business-setup/references/templates/content-creator.md` | AI YouTuber — full production pipeline (research, script, thumbnail, voice, avatar, upload, analytics) |

### How It Works

1. User: "Quiero un asistente para mi clínica dental"
2. Nyx reads `skills/business-setup/SKILL.md` → detects "dental" → reads `references/templates/dental-clinic.md`
3. Escalates to complex tier: `session_status model=complex` (Opus for high-quality setup)
4. Checks existing connections: `config_manage channels status` + `config_manage view agents`
5. Shows preview of recommended config → user confirms or modifies
6. Creates agent (now on Opus): `config_manage agents create "Dental Assistant" path="{description}"`
7. Walks through channel setup (WhatsApp, Voice) → loads channel guides
8. Walks through service setup (Calendar, CRM, Payments) → loads B4 service guides
9. Configures cron tasks if user wants them
10. Shows summary + resets tier: `session_status model=default` (back to Sonnet)

### Architecture

- **Zero new JS code** — entire feature is skill content + markdown templates
- **Auto-discovered** by `loadSkillEntries()` scanning `skills/*/SKILL.md`
- **Progressive disclosure** — SKILL.md body loaded on trigger; templates loaded on-demand per industry
- **Each template contains:** Name, Description (→ injected as `## Purpose` via Phase 61), ToolProfile, Channels (with rationale), Services (with rationale), BusinessHours, Cron tasks
- **Custom fallback** — if no template matches, skill asks 3 questions and builds custom config

### Result

- 11 files created, 0 files modified, 0 new JS code
- 10 industry templates covering the most common business types + content creation
- Skill appears automatically in the Capabilities catalog
- Backward compatible — existing skills and config unaffected
- Foundation for adding more industry templates (just add a `.md` file to `references/templates/`)

### Service Guides — YouTube API + HeyGen Avatar (5 Mar 2026)

Two new service guides added to the connected services system (extending Phase B4):

| File                                       | Purpose                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/agents/tools/guides/youtube-api.md`   | YouTube Data API v3 — video upload, metadata, thumbnails, playlists, comments, analytics |
| `src/agents/tools/guides/avatar-heygen.md` | HeyGen API — AI avatar video generation, digital presenters, multi-scene, webhooks       |

**YouTube API guide** (107 lines): Assumes existing YouTube channel. Setup via google-antigravity OAuth provider. Covers resumable video upload (2-step), metadata optimization, thumbnail set, playlist management, comment replies, and YouTube Analytics API. Quota tracking (10K units/day). 8-step diagnostic tree.

**HeyGen avatar guide** (183 lines): Full integration for AI avatar video generation. Two video creation modes: text-to-speech (HeyGen handles TTS) and pre-recorded audio (recommended for content creators — generate narration with Kokoro/ElevenLabs first). Character options (avatar types, styles, expressions), voice options (TTS, audio, silence, ElevenLabs integration), background options (color, image, video), multi-scene support (up to 50 scenes). Credits system documented. Content creator flow pattern. Callback URL for webhook notifications.

**Registration:** Both guides accessible via `config_manage services {name}`:

- YouTube: aliases `youtube`, `youtube-api`, `video`
- HeyGen: aliases `avatar`, `heygen`, `avatar-heygen`

**Capabilities catalog updated** in `workspace.js` to include both services.

### Bug Fixes — Service Guide Loading (5 Mar 2026)

Two pre-existing bugs from Phase B4 prevented ALL service guides from loading via `config_manage services`:

1. **`params` → `args` in services case** (`config-manage-tool.js:2117`): The `execute()` function receives `args`, but the services case used `readStringParam(params, "subAction")` — `params` doesn't exist in that scope. Fixed to `args`.

2. **Missing actions in `CONFIG_MANAGE_ACTIONS` array** (`config-manage-tool.js:87-113`): The schema enum validator (`stringEnum(CONFIG_MANAGE_ACTIONS)`) did not include `services`, `gateway`, or `advanced`. All three actions were rejected before reaching the switch statement. Added the missing entries.

**Impact:** Both voice (Twilio), crm (HubSpot), payments (Stripe), and calendar (Google) guides from Phase B4 were also broken. These fixes restore all service guides.

### Tier Escalation for Complex Skills (5 Mar 2026)

Business setup (and future complex skills) now automatically escalate to the most capable model (Opus/complex tier) during agent creation, then reset to the default tier (Sonnet/normal) after completion.

**How it works:**

1. Nyx calls `session_status model=complex` during the preview step (step 3)
2. The model change applies on the **next message turn** (not the current response)
3. When the user confirms, the agent creation runs on Opus — highest quality for personality injection and configuration
4. After setup completes, `session_status model=default` resets to the configured `defaultTier`

**Flow verified in production:**

```
Sonnet (preview + escalation call) → user confirms → Opus (agent creation) → reset → Sonnet (normal operation)
```

**Design decision:** Tier escalation is **skill-specific**, not a general architectural pattern. Only orchestrated multi-step skills (like business-setup) include escalation/reset instructions in their SKILL.md. Simple operations (e.g., `config_manage agents create "test"`) use the default tier — no escalation needed.

**Supporting changes:**

- `defaultTier: "normal"` added to `agents.defaults.model` in config — uses `routing.tiers.normal` (Sonnet) instead of hardcoding `model.primary`
- `defaultTier` added to Zod schema (`zod-schema.agent-defaults.js`) — previously rejected by doctor as "Unknown config key"
- `defaultTier` label added to `schema.labels.js` for `config_manage describe`
- `workspace.js` capabilities catalog updated with `defaultTier` documentation
- `session_status` tool description clarified: "THIS is the correct tool for switching models — not config_manage"
- `agents.md` guide updated: agent deletion always removes workspace (never ask to preserve files)

---

## Intelligent Tier Profiles + UI Cleanup — Phase 63 (5 Mar 2026)

Full capability profiles per tier with auto-escalation for config/destructive operations.

### Tier Profiles

Each tier now defines a full capability set instead of just a model name:

| Tier    | Model     | Thinking | Verbose | Reasoning |
| ------- | --------- | -------- | ------- | --------- |
| simple  | (speed)   | —        | —       | —         |
| normal  | (default) | low      | —       | —         |
| complex | (capable) | high     | on      | on        |

Profiles support both string (backward compat) and object `{ model, thinking?, verbose?, reasoning? }` — Zod union schema in `zod-schema.agent-defaults.js`.

### Auto-Escalation

`classifyTierEscalation()` in `model-routing.js` — detects config/destructive tasks by action verb (create, delete, configure, install, secure, deploy) + system target (agent, channel, service, etc.) → escalates to complex tier. Auto de-escalation on next non-config message.

### UI Changes

- Session Overrides popover deleted → minimal tier bars (■ ■ □) with tooltip showing full config (tier + thinking + reasoning + verbose)
- A2A activity indicator fix (TOOL_EVENTS cap prevents UI freeze)
- Sidebar no longer blocks during delegation
- Activity dots for configured agents via `activeRunSessionKeys`
- `routingTier` added to `SessionsPatchParamsSchema`

### Files Modified

| File                                          | Change                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/agents/tier-profiles.js`                 | New: `TIER_CAPABILITY_DEFAULTS`, `normalizeTierProfile()`, `extractTierModel()`         |
| `src/agents/model-routing.js`                 | Added `classifyTierEscalation()`                                                        |
| `src/agents/run.js`                           | Unified adaptive routing: `routingTier` + capability patches in single `sessions.patch` |
| `ui/src/components/chat-session-overrides.js` | Deleted (popover removed)                                                               |
| `ui/src/components/chat-header.js`            | Tier bars (■ ■ □) + tooltip                                                             |

889 test files pass.

---

## Agent Templates + Security Guard — Phase 64 (5 Mar 2026)

### Problem

`skills/business-setup/` was hardcoded for business agent creation. The real mechanic is **creating specialized agents from templates** — business, operations, or custom. A security guard, an SEO specialist, a dental assistant all follow the same flow.

### Solution

Renamed `skills/business-setup/` → `skills/agent-templates/` with a flat `templates/` directory. Generalized SKILL.md to support optional template sections. Added security guard and SEO specialist templates. Exposed `runSecurityAudit()` as `config_manage security audit`.

### Structural Changes

```
skills/agent-templates/
├── SKILL.md                    ← 11-step guided flow, optional section model
└── templates/
    ├── dental-clinic.md        (existing, moved from references/templates/)
    ├── restaurant.md           (existing, moved)
    ├── online-store.md         (existing, moved)
    ├── law-firm.md             (existing, moved)
    ├── real-estate.md          (existing, moved)
    ├── hair-salon.md           (existing, moved)
    ├── gym-fitness.md          (existing, moved)
    ├── hotel.md                (existing, moved)
    ├── accounting-firm.md      (existing, moved)
    ├── content-creator.md      (existing, moved)
    ├── security-guard.md       (NEW — gateway security monitoring + audit automation)
    └── seo-specialist.md       (NEW — site audits, keyword tracking, ranking monitoring)
```

### Template Section Model

Templates include any combination of sections. SKILL.md processes each if present, skips if absent:

| Section          | Used by    | Description                                |
| ---------------- | ---------- | ------------------------------------------ |
| `Name:`          | all        | Agent display name                         |
| `ToolProfile:`   | all        | Base tool profile                          |
| `Description:`   | all        | Purpose injection for SOUL.md              |
| `Channels:`      | business   | Channel setup (WhatsApp, Voice, etc.)      |
| `Services:`      | business   | Connected services (Calendar, CRM, Stripe) |
| `BusinessHours:` | business   | Operating schedule                         |
| `Hardening:`     | operations | Security hardening steps                   |
| `Approvals:`     | operations | Approval policy configuration              |
| `AlsoAllow:`     | operations | Extra tools to allow                       |
| `Deny:`          | operations | Tools to deny                              |
| `A2A:`           | all        | Agent-to-agent communication rules         |
| `Cron:`          | all        | Scheduled tasks                            |

### Security Audit Exposed

Added `audit` case to `handleSecurity()` in `config-manage-tool.js`:

- `config_manage security audit` — standard scan (config + filesystem + channels)
- `config_manage security audit value=deep` — deep scan (adds gateway probe + plugin/skill code safety)
- Returns `{ summary: { critical, warn, info }, findings: [{ checkId, severity, title, detail, remediation? }] }`
- `security` added to CONFIG_CATALOG_ENTRIES in `workspace.js`
- `security` added to SubActions in tool description

### New Operational Guide

`src/agents/tools/guides/security-ops.md` — TOON format reference for security operations:

- Audit categories mapped to checkId patterns (gateway, browser, logging, tools, fs, channels, plugins)
- Remediation playbooks — specific `config_manage` commands per finding type
- Report formats with nyx-ui status-grid
- Escalation rules (3+ CRITICAL → immediate alert, vault lock → notify)
- Scheduling patterns (daily 6:00, weekly Monday 9:00)

### Files

| File                                                 | Action                                     | Description                                                         |
| ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `skills/business-setup/`                             | RENAME → `skills/agent-templates/`         | Directory rename                                                    |
| `skills/agent-templates/references/templates/`       | MOVE → `skills/agent-templates/templates/` | Flatten: remove references/ layer                                   |
| `skills/agent-templates/SKILL.md`                    | EDIT                                       | Generalized flow, optional section model, 12 templates              |
| `skills/agent-templates/templates/security-guard.md` | CREATE                                     | Security guard template                                             |
| `skills/agent-templates/templates/seo-specialist.md` | CREATE                                     | SEO specialist template                                             |
| `src/agents/tools/config-manage-tool.js`             | EDIT                                       | `audit` case in `handleSecurity()` + `security` in tool description |
| `src/agents/skills/workspace.js`                     | EDIT                                       | `security` added to CONFIG_CATALOG_ENTRIES                          |
| `src/agents/tools/guides/security-ops.md`            | CREATE                                     | TOON operational guide for security operations                      |
| `ARCHITECTURE.md`                                    | EDIT                                       | Updated skill structure, phase count, references                    |
| `VISION.md`                                          | EDIT                                       | Updated to agent-templates references                               |

889 test files pass, 0 failures.

---

## Phase 65 — Dynamic Specialist Delegation + SOUL.md Protection (6 Mar 2026)

### Problem

After `/reset`, the default agent (Nyx) lost awareness of configured specialist agents and performed tasks herself instead of delegating. Previous approaches (memory files, system prompt sections) were fragile or ineffective. Root cause discovered: Nyx's SOUL.md had been corrupted — she overwrote it with SEO Specialist content using her own `write` tool.

### Solution

Dynamic agent list injection into AGENTS.md contextFile at runtime. No memory files, no new contextFiles — append to the existing AGENTS.md that's already in the recency zone (position 18).

### Changes

**Dynamic specialist injection** (`attempt.js`, `compact.js`):

- Import `listAgentEntries` from `agent-scope.js`
- For the default agent only, filter configured agents (excluding self)
- Append `### Active Specialist Agents` section to AGENTS.md contextFile with delegation rule and agent list
- Log injection count: `[specialist-agents] injected N agents into AGENTS.md context`

**SOUL.md/IDENTITY.md protection** (`docs/reference/templates/AGENTS.md`):

- Added safety rule: "NEVER overwrite SOUL.md or IDENTITY.md without explicit user approval"
- Updated delegation rule: "check Active Specialist Agents below" (references the injected section)

**Adaptive routing log** (`run.js`):

- Always shows `thinking`, `reasoning`, `verbose` levels regardless of whether they changed
- Removes conditional checks — full visibility on every routing decision

**Normal tier tuning** (`tier-profiles.js`, `tier-profiles.test.js`):

- Reverted normal tier from `thinking: "medium"` to `thinking: "low"`
- Root cause was SOUL.md corruption, not thinking level

**SKILL.md simplification** (`skills/agent-templates/SKILL.md`):

- Removed step 3 "Register in memory" — no longer needed with dynamic injection
- Flow reduced to 3 steps: identify template → create agent → summary

### Files

| File                                           | Action | Description                                         |
| ---------------------------------------------- | ------ | --------------------------------------------------- |
| `src/agents/pi-embedded-runner/run/attempt.js` | EDIT   | Dynamic agent list injection into AGENTS.md context |
| `src/agents/pi-embedded-runner/compact.js`     | EDIT   | Same injection for compaction path                  |
| `src/agents/pi-embedded-runner/run.js`         | EDIT   | Always log thinking/reasoning/verbose levels        |
| `src/agents/tier-profiles.js`                  | EDIT   | Normal tier: medium → low                           |
| `src/agents/tier-profiles.test.js`             | EDIT   | Updated test expectations for low                   |
| `docs/reference/templates/AGENTS.md`           | EDIT   | SOUL.md protection rule + delegation rule update    |
| `skills/agent-templates/SKILL.md`              | EDIT   | Simplified to 3 steps                               |

---

## Phase 66 — Reliable Delegation: Prompt Positioning + Thinking Tuning (6 Mar 2026)

### Problem

Specialist agent delegation was inconsistent (~50/50). After `/reset`, Nyx sometimes delegated to the SEO specialist and sometimes performed the task herself using `web_fetch`/`web_search`. Root cause analysis of all 14 prompt layers revealed three compounding issues:

1. **Thinking level too low**: Normal tier used `thinking: "low"`, insufficient reasoning to evaluate delegation vs. direct action
2. **Delegation instruction buried**: Specialist agents list was appended to AGENTS.md (position 12/14 in system prompt) — model committed to a plan before reaching it
3. **Analysis queries misclassified**: "analiza el SEO de genosdb.com" scored 1 point (simple tier, thinking: off) because single analysis keywords only added +1

### Solution

Three surgical changes, each addressing one layer of the problem:

**A) Normal tier thinking: medium** (`tier-profiles.js`):

- `TIER_CAPABILITY_DEFAULTS.normal` changed from `{ thinking: "low" }` to `{ thinking: "medium" }`
- Main agent always runs at normal tier (guaranteed by `defaultTier` config) — never falls to simple
- Medium provides sufficient reasoning for delegation decisions without the token cost of high

**B) Analysis keyword scoring boost** (`model-routing.js`):

- Single analysis keyword (analiza, compare, revisa, etc.) now scores +3 (was +1)
- Ensures analysis queries classify as normal tier (score 3-7) instead of simple (score 0-2)
- Only affects dynamically routed subagents; main agent uses defaultTier regardless

**C) Early prompt injection** (`attempt.js`, `compact.js`, `system-prompt.js`):

- Specialist agents list moved from AGENTS.md tail (position 12/14) to right after Capabilities section (position ~5/14)
- New `specialistAgentsHint` parameter flows through the system prompt builder
- Explicit anti-greedy instruction: "BEFORE using web_fetch, web_search, or any analysis tool: check this list"
- Marked `(mandatory)` to match Capabilities section priority

### Result

3/3 delegation tests successful after changes (was ~50/50). Delegation now consistent across `/reset` cycles.

### Files

| File                                             | Action | Description                                         |
| ------------------------------------------------ | ------ | --------------------------------------------------- |
| `src/agents/tier-profiles.js`                    | EDIT   | Normal tier: thinking low -> medium                 |
| `src/agents/tier-profiles.test.js`               | EDIT   | Updated test expectations for medium                |
| `src/agents/model-routing.js`                    | EDIT   | Single analysis keyword score +1 -> +3              |
| `src/agents/pi-embedded-runner/run/attempt.js`   | EDIT   | Specialist agents as early system prompt hint       |
| `src/agents/pi-embedded-runner/compact.js`       | EDIT   | Same injection for compaction path                  |
| `src/agents/pi-embedded-runner/system-prompt.js` | EDIT   | Pass specialistAgentsHint param through             |
| `src/agents/system-prompt.js`                    | EDIT   | Inject specialist hint after Capabilities section   |
| `ui/src/ui/chat/grouped-render.js`               | EDIT   | Suppress truncated text fragments before tool cards |

---

## Phase 67 — Skill-Equipped Templates + NYXENC1 Skill Loader (6 Mar 2026)

### Problem

1. **Specialist agents write ad-hoc code** for every task — the SEO specialist would write inline Node.js scripts to call GSC APIs, leading to errors (`inspectionResult` undefined), inconsistent auth flows, and wasted tokens re-inventing working code
2. **NYXENC1 skill loader broken**: Skills in encrypted workspaces couldn't be discovered because `loadSkillsFromDir` (upstream) reads SKILL.md with plain `readFileSync`, bypassing vault decryption
3. **Templates had no skill mechanism**: Business templates could suggest services (Twilio, Stripe) but couldn't ship executable tools with the agent

### Solution

**A) Skill-equipped templates** — templates declare skills via `Skills:` section, auto-installed to agent workspace on creation:

- `parseAgentTemplate()` now parses `Skills:` multi-line section (extracts skill names from bullet lines)
- `agents.create` handler copies declared skills from bundled `skills/` to agent workspace, encrypts SKILL.md if vault is active
- New `copyDirRecursive()` utility for skill directory installation
- Template sections flow: Description → Skills → A2A → Cron (non-blocking fall-through between sections)

**B) NYXENC1 skill loader fix** (`workspace.js`):

- `readSkillFile()` — transparently decrypts NYXENC1-encrypted SKILL.md files
- `loadSkillsFromDirWithDecrypt()` — wraps upstream `loadSkillsFromDir`, handles encrypted SKILL.md by decrypting → parsing frontmatter → creating skill entries manually
- Both discovery (initial scan) and metadata re-read (frontmatter extraction) now use `readSkillFile()`
- Imports `decryptContent` + `resolvePassphrase` at module level for synchronous use

**C) Bundled SEO skills** — two new skills with production-ready scripts:

- `skills/gsc-analytics/` — Google Search Console API via service account JWT auth:
  - `scripts/auth.mjs` — JWT-based OAuth2, outputs access_token
  - `scripts/query.mjs` — Search Analytics (keywords, pages, dates, CTR, position)
  - `scripts/inspect.mjs` — URL Inspection (indexation status, verdict, crawl info)
  - `scripts/sitemaps.mjs` — Sitemap listing (URLs, errors, lastmod)
- `skills/site-auditor/` — Technical SEO audit via fetch:
  - `scripts/audit.mjs` — Crawls pages, checks meta/h1/canonical/og/robots/sitemap
  - Outputs JSON with severity scoring (CRITICAL/WARN/INFO, 0-100 score)
  - Correctly handles JS-challenge 429s (reports WARN, not CRITICAL)

**D) Updated SEO specialist template** (`seo-specialist.md`):

- Description now references skills: "use your installed skills (gsc-analytics, site-auditor)"
- `Skills:` section declares `gsc-analytics` and `site-auditor` for auto-installation
- Operational rules simplified: point to skills instead of inline API docs

### Test results

- 704 agent tests pass (82 files)
- 30 gateway agent mutation tests pass
- Template parser correctly extracts Skills + A2A (fall-through fixed)
- Site auditor tested against live site (genosdb.com) — correctly reports 429 as WARN

### Files

| File                                                 | Action | Description                                                       |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `src/agents/skills/workspace.js`                     | EDIT   | NYXENC1 skill loader: readSkillFile, loadSkillsFromDirWithDecrypt |
| `src/agents/auto-config.js`                          | EDIT   | parseAgentTemplate: Skills section, fall-through fix              |
| `src/gateway/server-methods/agents.js`               | EDIT   | agents.create: copy template skills, copyDirRecursive             |
| `skills/gsc-analytics/SKILL.md`                      | NEW    | GSC Analytics skill definition                                    |
| `skills/gsc-analytics/scripts/auth.mjs`              | NEW    | JWT-based GSC authentication                                      |
| `skills/gsc-analytics/scripts/query.mjs`             | NEW    | Search Analytics query                                            |
| `skills/gsc-analytics/scripts/inspect.mjs`           | NEW    | URL Inspection                                                    |
| `skills/gsc-analytics/scripts/sitemaps.mjs`          | NEW    | Sitemap listing                                                   |
| `skills/site-auditor/SKILL.md`                       | NEW    | Site Auditor skill definition                                     |
| `skills/site-auditor/scripts/audit.mjs`              | NEW    | Technical SEO audit script                                        |
| `skills/agent-templates/templates/seo-specialist.md` | EDIT   | Skills section + simplified operational rules                     |
| `skills/agent-templates/SKILL.md`                    | EDIT   | Document skills.installed in autoConfig response                  |

### Bugfix: NYXENC1 skill loader destructuring (6 Mar 2026)

`loadSkillsFromDirWithDecrypt` used `const { frontmatter } = parseFrontmatter(plaintext)` but `parseFrontmatter()` returns a flat object `{ name, description, ... }`, not `{ frontmatter: { ... } }`. This produced `undefined`, causing `TypeError` on `.description` access — caught and logged as "Failed to decrypt SKILL.md" even though decryption succeeded. Fix: `const fm = parseFrontmatter(plaintext)` + use `fm.description` / `fm.name`.

---

## Phase 68 — Realtime Bidirectional Voice (OpenAI Realtime API) (7 Mar 2026)

### Problem

Voice calls used a 3-step pipeline: STT (OpenAI Whisper) → LLM (Claude) → TTS (Kokoro/OpenAI). This introduced latency, unnatural pauses, and required separate providers for each step. The user experience was not conversational — it felt like talking to a machine that transcribes, thinks, then speaks.

### Solution

**New `realtime-call` plugin** — independent extension that replaces the STT→LLM→TTS pipeline with true bidirectional audio streaming via OpenAI Realtime API + Twilio Media Streams.

**Architecture:** Twilio sends raw audio (g711_ulaw 8kHz) via WebSocket Media Stream → `RealtimeMediaStreamHandler` bridges directly to OpenAI Realtime API (`wss://api.openai.com/v1/realtime`) → AI audio response streams back to Twilio. One step: audio in, audio out. No intermediate transcription, no separate LLM, no local TTS.

**Key components:**

- `OpenAIRealtimeConversationProvider` — WebSocket client to OpenAI Realtime API. Configures session with `g711_ulaw` format (native to both Twilio and OpenAI — zero resampling), server VAD for natural turn-taking, input audio transcription for logging
- `RealtimeMediaStreamHandler` — bridges Twilio Media Streams ↔ OpenAI Realtime. Handles audio forwarding, interruptions (clears Twilio buffer when user speaks), stream token validation, per-call session management
- **Per-call context injection** — when Nyx initiates a call with a message (e.g. "sell GenosDB to the user"), that message is injected into the Realtime session instructions AND used as the initial greeting trigger. The AI has full context for the conversation
- **Automatic transcript capture** — both user and AI responses stored in call record. Tool `initiate_call` waits for call completion and returns full transcript, duration, and end reason to Nyx for analysis
- **Backward compatible** — `streaming.mode` config: `realtime-conversation` (new, default) or `stt-only` (original pipeline)
- **Voice selection** — 10 OpenAI voices (alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar). Default: `sage` (masculine deep)

**Fixes applied during development:**

- Stream token validation: Twilio sends token via `<Parameter>` (arrives in `message.start.customParameters.token`), not URL query params
- Voice compatibility: OpenAI Realtime voices differ from TTS API voices (no "nova")
- Plugin manifest: `genosos.plugin.json` required for GenosOS plugin discovery

### Files

| File                                                                     | Action | Description                                                         |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------- |
| `extensions/realtime-call/`                                              | NEW    | Independent plugin (full copy from voice-call + realtime additions) |
| `extensions/realtime-call/index.js`                                      | NEW    | Plugin registration, tool with wait-for-call-end                    |
| `extensions/realtime-call/genosos.plugin.json`                           | NEW    | Plugin manifest with configSchema                                   |
| `extensions/realtime-call/package.json`                                  | NEW    | @genosos/realtime-call package                                      |
| `extensions/realtime-call/src/providers/openai-realtime-conversation.js` | NEW    | OpenAI Realtime API client (bidirectional audio)                    |
| `extensions/realtime-call/src/media-stream-realtime.js`                  | NEW    | Twilio ↔ OpenAI bridge handler                                      |
| `extensions/realtime-call/src/webhook.js`                                | EDIT   | Dual mode router (realtime-conversation / stt-only)                 |
| `extensions/realtime-call/src/config.js`                                 | EDIT   | Streaming mode, realtimeModel, realtimeVoice, realtimeInstructions  |
| `extensions/realtime-call/src/runtime.js`                                | EDIT   | Skip TTS/STT setup in realtime mode                                 |
| `extensions/realtime-call/src/manager.js`                                | EDIT   | waitForCallEnd(), onCallEnded callback                              |
| `extensions/realtime-call/src/manager/events.js`                         | EDIT   | Store bot transcript, call onCallEnded                              |
| `extensions/voice-call/src/providers/twilio.js`                          | EDIT   | Default locale es-ES (was en-US)                                    |

## Phase 69 — Async Calls + Subagent Routing (7 Mar 2026)

### Problem

1. **Blocking calls** — `initiate_call` waited for the call to end (`waitForCallEnd`), blocking the agent for the entire call duration. Impossible to make multiple simultaneous calls or do anything while a call is in progress.
2. **No call history session** — call transcripts disappeared after the tool returned. No persistent record of calls, no way to review past conversations.
3. **Port conflict for subagents** — the voice-call runtime registered a new webhook server for each agent workspace (plugin loader caches by workspaceDir), causing port 3335 collisions.

### Solution

**A) Async `initiate_call`** — returns immediately with `callId` instead of blocking. When the call ends, `onCallEnded` delivers the transcript as a message to the originating session via `callGateway({ method: "chat.send" })`.

- Tool registered as factory function `(ctx) => tool` to capture `ctx.sessionKey` for transcript routing
- Module-level `callSessionMap` (Map<callId, sessionKey>) tracks which session initiated each call
- `onCallEnded` formats transcript + duration + end reason and sends via `chat.send` with `idempotencyKey`

**B) Subagent call routing** — tool description instructs the agent to always delegate calls via `sessions_spawn` (label per phone number, `keep=true`). The subagent executes `realtime_call` and receives the transcript. Follow-up calls use `sessions_send` to the same session. All call transcripts accumulate in one persistent subagent per number — mirroring the WhatsApp DM pattern where each contact has its own session.

**C) Module-level singleton** — moved `runtimePromise`/`runtime` outside the `register()` closure so all agent workspaces share the same webhook server. Eliminates port conflicts.

**D) Tool rename** — `voice_call` → `realtime_call` to distinguish from legacy voice-call plugin.

**E) Business templates** — all 10 business templates now include `AlsoAllow: realtime_call` for direct call access. Call Operator agent template removed (unnecessary intermediary).

**F) Cloudflare Tunnel** — documented as recommended tunnel provider. `maxConcurrentCalls` raised from 1 to 5.

### Files

| File                                                | Action | Description                                                                                    |
| --------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `extensions/realtime-call/index.js`                 | EDIT   | Async initiate_call, factory tool, callSessionMap, chat.send delivery, singleton, routing rule |
| `extensions/realtime-call/src/config.js`            | EDIT   | maxConcurrentCalls default 1 → 5                                                               |
| `extensions/realtime-call/src/manager/outbound.js`  | EDIT   | Call onCallEnded in endCall() success + error paths                                            |
| `extensions/realtime-call/src/manager/events.js`    | EDIT   | alreadyEnded guard to prevent duplicate onCallEnded                                            |
| `extensions/realtime-call/genosos.plugin.json`      | EDIT   | Cloudflare Tunnel config hints                                                                 |
| `skills/agent-templates/templates/*.md` (10 files)  | EDIT   | AlsoAllow: realtime_call                                                                       |
| `skills/agent-templates/SKILL.md`                   | EDIT   | Removed call-operator entry                                                                    |
| `skills/voice-call/SKILL.md`                        | EDIT   | Reference realtime_call                                                                        |
| `src/agents/tools/guides/voice-telephony-twilio.md` | EDIT   | realtime_call rename, Cloudflare Tunnel docs                                                   |
| `ARCHITECTURE.md`                                   | EDIT   | realtime_call rename, Cloudflare Tunnel                                                        |

---

## Phase 70 — TOON Compaction Pipeline (7 Mar 2026)

### Problem

1. **Dual template conflict** — SDK's hardcoded `SUMMARIZATION_PROMPT` (6 sections with "(none)" placeholders) competed with GenosOS's 11-section custom template. The LLM received contradictory format instructions, producing inconsistent summaries.
2. **Empty section bloat** — compaction output included all sections with "(none)" or "N/A" even when empty, wasting tokens.
3. **Markdown storage** — compaction summaries stored as Markdown in session JSONL, missing the ~40% token reduction TOON provides.
4. **No manual compaction** — SDK's `keepRecentTokens: 20000` default prevented compaction on short sessions, blocking manual `/compact` commands.

### Solution

**A) Template override** — `compaction-instructions.js` now starts with `"OVERRIDE: Ignore the format above"` to suppress the SDK's default template. Global omission rule: sections with no content are omitted entirely.

**B) TOON post-processing** — after `session.compact()` produces a Markdown summary, `convertBootstrapToToon()` converts it to TOON format. `rewriteLastCompactionSummary()` then rewrites the last compaction entry in the session JSONL with the TOON version. The stored summary is always TOON.

**C) Manual compact override** — when `params.trigger === "manual"`, `keepRecentTokens` is set to 0 via `settingsManager.applyOverrides()`, allowing compaction at any session size.

**D) Debug output** — both Markdown (before) and TOON (after) versions written to `~/.genosv1/debug/` for inspection.

### Validation

4 successive compactions on the same session (last 2 after browser refresh forcing full JSONL reload):

- All 4 entries in JSONL confirmed as TOON (`has ## : false`, `has · : true`)
- Zero information degradation — all 8 original facts preserved through all rounds
- New information correctly accumulated (e.g., "texto añadido" added in Round 4)
- Between Rounds 2–3, only the previous TOON summary existed as context (no original content) — proving the LLM reads and re-produces TOON natively

### Files

| File                                       | Action | Description                                                                                            |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------ |
| `src/agents/compaction-instructions.js`    | EDIT   | OVERRIDE prefix, empty section omission rule, trimmed descriptions                                     |
| `src/agents/pi-embedded-runner/compact.js` | EDIT   | `rewriteLastCompactionSummary()`, TOON post-processing, manual keepRecentTokens override, debug output |

## Phase 71 — UI Polish + Channel Status Dots + Real-Time Activity (9 Mar 2026)

### Summary

Comprehensive Control UI polish session covering visual improvements, system notification rendering, Tool Output formatting, and real-time channel/session activity indicators in the sidebar.

### Changes

**A) Visual fixes**

- Brand title "GATEWAY" color fixed (`color: var(--muted)`)
- Dark mode hover on topbar icons fixed (hardcoded `#373937` → `var(--text-strong)`)
- Thinking text and tip text unified to same font size (15px)
- Compaction indicator shows elapsed time and token count (`Compacting context… (1m 23s · ↑ 12.4K tokens)`)
- Activity tick extended to re-render during `_runningSessions` activity

**B) System notifications**

- WhatsApp connect/disconnect events removed from main chat session (were polluting via `enqueueSystemEvent` with no peer context)
- Compaction duplicate removed (divider + system event → divider only)
- System notification lines rendered as tool-card-style components with `⎿` connector and icons instead of blockquotes

**C) Tool Output sidebar**

- Raw HTML content auto-detected and wrapped in fenced code block with syntax highlighting
- Minified HTML pretty-printed (`><` → `>\n<`, long CSS rules split at `;`)

**D) Channel status dots**

- Sidebar session dots show real-time channel connection status: green (connected), red (disconnected)
- Gateway connection state used as fallback for non-channel sessions (main, agents)
- All sessions go red when gateway disconnects, green when reconnects
- `channels.changed` event added — backend emits when channel `connected` state changes via `setRuntime`
- UI listens to `channels.changed` → reloads `channelsSnapshot` in real-time (no polling)
- `loadChannels()` called on initial connect (`onHello`)

**E) Real-time activity animation**

- `lifecycle` stream events (`start`/`end`) tracked in `_runningSessions` Set
- Connected + working sessions show green↔orange pulsating dot (0.4s cycle)
- Disconnected + working sessions show yellow pulsating dot
- `session.running` removed from activity check (stale data) — only `_runningSessions` used
- Activity forced inactive when gateway disconnected

### Files

| File                                       | Action | Description                                                                              |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------- |
| `ui/src/styles/layout.css`                 | EDIT   | Channel dot classes (connected, disconnected, connected-working), green↔orange keyframes |
| `ui/src/styles/chat/tool-cards.css`        | EDIT   | `.cli-thinking-stats` styling, thinking text size 15px                                   |
| `ui/src/styles/chat/layout.css`            | EDIT   | Dark mode icon hover fix                                                                 |
| `ui/src/styles/components.css`             | EDIT   | Topbar icon hover fix                                                                    |
| `ui/src/styles/chat/text.css`              | EDIT   | Blockquote styling restored                                                              |
| `ui/src/ui/views/session-tree.js`          | EDIT   | Channel extraction, status resolution, activity dots logic                               |
| `ui/src/ui/views/markdown-sidebar.js`      | EDIT   | HTML detection, pretty-print, code fence wrapping                                        |
| `ui/src/ui/views/chat.js`                  | EDIT   | Compaction indicator with tokens, separate if blocks                                     |
| `ui/src/ui/chat/grouped-render.js`         | EDIT   | `formatElapsed()`, `formatTokensCompact()`, system notification rendering                |
| `ui/src/ui/chat/message-extract.js`        | EDIT   | `extractSystemNotifications()` function                                                  |
| `ui/src/ui/app-tool-stream.js`             | EDIT   | Lifecycle event tracking for `_runningSessions`                                          |
| `ui/src/ui/app-gateway.js`                 | EDIT   | `loadChannels` on connect, `channels.changed` handler, cleanup on disconnect             |
| `ui/src/ui/app-chat.js`                    | EDIT   | Activity tick includes `_runningSessions`                                                |
| `src/gateway/server-channels.js`           | EDIT   | `onChannelStatusChange` callback on `connected` change                                   |
| `src/gateway/server.impl.js`               | EDIT   | Wire `onChannelStatusChange` → broadcast `channels.changed`                              |
| `src/gateway/server-methods-list.js`       | EDIT   | Register `channels.changed` event                                                        |
| `src/auto-reply/reply/commands-compact.js` | EDIT   | Remove duplicate system event for compaction                                             |
| `src/web/auto-reply/monitor.js`            | EDIT   | Remove WhatsApp connect/disconnect system events                                         |

---

## Phase 72 — UI Simplification + Responsive Fix (9 Mar 2026)

### Summary

Major Control UI simplification: consolidate settings tabs (5→4), remove redundant fields and modals, unify modal structure, fix mobile responsive sidebar as overlay, clean responsive CSS of all unnecessary overrides. 27 files changed, ~700 lines removed.

### Changes

**A) Settings modal consolidation**

- 5 tabs → 4: Gateway (Access + Health merged), Tools, Config, Files
- Tools tab auto-initiates `tools.status.initiate` on render (no manual button)
- Files tab auto-selects first file on load
- Files layout: flat file list with vertical divider, no card bubbles, no file metadata
- Files header: `MAIN | /workspace/path/filename` with Save/Delete on right

**B) Removed UI fields and features**

- Password field removed from Access form + WebSocket auth + URL params + i18n (4 locale files)
- Default Session Key field removed (managed in config JSON)
- Language selector removed (English-only UI)
- Auth/Instances/Sessions/Channels stat cards removed from Health
- Refresh buttons removed from all modals (WebSocket real-time makes them redundant)

**C) Chat controls**

- Refresh chat button replaced with Reset session button (`/reset` silent command)
- Reset button shows "Resetting context…" indicator (same pattern as compact button)
- Focus mode no longer hides session title + controls bar (`.content-header` stays visible)
- Floating `.chat-focus-exit` X button removed from focus mode
- `border-bottom` removed from `.chat-compose` (extra line in mobile)
- Tool Output sidebar title shortened to "Output"

**D) Modal unification**

- Board overlay uses `settings-modal__card` class (same size/style as Settings)
- Both modals: X button in header, consistent close pattern

**E) Responsive fix**

- Mobile sidebar: `position: fixed` overlay with `translateX` slide animation
- `navCollapsed` scoped to mobile only — desktop always shows sidebar
- `.nav--collapsed` global styles removed (was hiding sidebar on desktop after mobile toggle)
- `layout.mobile.css` stripped to structural-only overrides (no font-size, padding, gap changes)
- Single `@media (max-width: 1100px)` block in `layout.css` (was duplicated)
- Sidebar width uses `var(--shell-nav-width)` consistently (220px)
- `border-right` on `.nav` moved to base (not duplicated in queries)
- `.content-header` hidden on mobile except for chat view (preserves session controls)

**F) Code cleanup**

- `chat-sidebar` gets `background: var(--bg)`
- `gateway.js` auth simplified: token-only (no password)
- Tests updated: removed password mock, password URL strip test
- i18n: removed `password`, `sessionKey`, `language` keys + `languages` section from all 4 locales

### Files

| File                                            | Action | Description                                                    |
| ----------------------------------------------- | ------ | -------------------------------------------------------------- |
| `ui/src/ui/views/settings-modal.js`             | NEW    | Unified settings modal (4 tabs: Gateway, Tools, Config, Files) |
| `ui/src/ui/views/overview.js`                   | EDIT   | Removed password, session key, language fields, refresh button |
| `ui/src/ui/views/connection-modal.js`           | EDIT   | Removed password/sessionKey/refresh props                      |
| `ui/src/ui/views/cron-board-overlay.js`         | EDIT   | Unified to `settings-modal__card`, X close button              |
| `ui/src/ui/views/chat.js`                       | EDIT   | Removed focus exit button, reset hint override                 |
| `ui/src/ui/views/markdown-sidebar.js`           | EDIT   | "Tool Output" → "Output"                                       |
| `ui/src/ui/views/agents-panels-status-files.js` | EDIT   | Flat file list, no card wrapper, no metadata                   |
| `ui/src/ui/app-render.helpers.js`               | EDIT   | Reset button replaces refresh, `_resetInFlight` flag           |
| `ui/src/ui/app-render.js`                       | EDIT   | Settings modal integration, removed connection modal           |
| `ui/src/ui/app.js`                              | EDIT   | Removed password state, default tab → "gateway"                |
| `ui/src/ui/app-settings.js`                     | EDIT   | Removed password URL param extraction                          |
| `ui/src/ui/app-gateway.js`                      | EDIT   | Removed password from client constructor                       |
| `ui/src/ui/app-chat.js`                         | EDIT   | Silent reset command support                                   |
| `ui/src/ui/app-tool-stream.js`                  | EDIT   | Tool stream lifecycle tracking                                 |
| `ui/src/ui/gateway.js`                          | EDIT   | Auth simplified to token-only                                  |
| `ui/src/ui/chat/grouped-render.js`              | EDIT   | Reset activity hint category                                   |
| `ui/src/ui/chat/tool-cards.js`                  | EDIT   | Tool card rendering cleanup                                    |
| `ui/src/styles/layout.css`                      | EDIT   | Responsive unified, nav border, nav-collapsed scoped           |
| `ui/src/styles/layout.mobile.css`               | EDIT   | Stripped to structural-only (334→32 lines)                     |
| `ui/src/styles/chat/layout.css`                 | EDIT   | Removed `border-bottom` from compose                           |
| `ui/src/styles/chat/sidebar.css`                | EDIT   | Added `background: var(--bg)`                                  |
| `ui/src/styles/components.css`                  | EDIT   | Settings modal styles, files flat layout                       |
| `ui/src/i18n/locales/en.js`                     | EDIT   | Removed password/sessionKey/language keys                      |
| `ui/src/i18n/locales/pt-BR.js`                  | EDIT   | Same i18n cleanup                                              |
| `ui/src/i18n/locales/zh-CN.js`                  | EDIT   | Same i18n cleanup                                              |
| `ui/src/i18n/locales/zh-TW.js`                  | EDIT   | Same i18n cleanup                                              |
| `ui/src/ui/app-gateway.node.test.js`            | EDIT   | Removed password from mock                                     |
| `ui/src/ui/navigation.browser.test.js`          | EDIT   | Removed password URL strip test                                |

---

## Phase 73 — Cron Reliability + Tool Card Dedup + Queue Redesign (10 Mar 2026)

### Summary

Three interconnected cron fixes (false error status, session auto-cleanup, tool ambiguity) plus a UI tool card deduplication fix and a minimal queue redesign. 12 files changed, net -36 lines.

### Changes

**A) Cron announce failure — soft warning instead of hard error**

- `run.js`: announce delivery failure no longer returns `status: "error"` — always logs a warning and continues with `status: "ok"`. Applies to both the success path and catch block.
- Root cause: `runSubagentAnnounceFlow` fails for UI-originated cron sessions because the announce direct delivery calls `callGateway({ method: "agent" })` which times out. This was propagating as a cron error even when the cron job itself succeeded.

**B) Cron result delivery via `chat.send`**

- `timer.js`: switched from `enqueueSystemEvent` + wake to direct `sendToSession` via `chat.send` — same pattern used by voice call transcript delivery. Delivers cron results directly to the originating session.
- `server-cron.js`: added `sendToSession` dep using `callGateway({ method: "chat.send" })` with idempotency key.
- Label always clean: `Cron: {summary}` — no `(error)` prefix.

**C) Cron session auto-cleanup**

- `run.js`: added `cronSessionKey` (the sidebar-visible `agent:main:cron:{id}` key) to `withRunSession` return.
- `timer.js`: after delivery, deletes both `cronSessionKey` and `runSessionKey` via `sessions.delete`.
- `server-cron.js`: added `deleteCronSession` dep that calls `sessions.delete` + broadcasts `sessions.changed`.
- Sidebar sessions broadcast on cron `started`/`finished` events.

**D) Cron tool disambiguation**

- `config-manage-tool.js`: `handleCron` reduced from full CRUD (list/status/add/update/remove/run/runs/board) to board-only. All other cron operations throw `ToolInputError` directing to the dedicated `cron` tool.
- `cron-tool.js`: added anti-duplication instruction: "This is the ONLY tool for cron operations — call it exactly once per operation."
- `workspace.js`: capabilities catalog updated: `cron: board overlay only — use the dedicated cron tool for all job operations`.

**E) Tool card deduplication across messages**

- `grouped-render.js`: pre-pass in `renderMessageGroup` collects all tool result names across the entire message group. This set (`groupResultNames`) is passed to each `renderGroupedMessage` call. Call cards (from `tool_use` blocks in assistant messages) are suppressed when a matching result card exists in any subsequent tool message.
- Root cause: the existing dedup logic only worked within a single message. Since `tool_use` (assistant) and `tool_result` (tool) are always in separate messages, both rendered as "Cron #1" and "Cron #2".

**F) Queue redesign — minimal single-line items**

- `chat.js`: removed `__list` wrapper, simplified items to inline `<span>` elements.
- `components.css`: compact queue — `6px 12px` padding, `2px` gap, single-line items with `text-overflow: ellipsis`, unstyled buttons (text-only interrupt, icon-only remove with hover danger color), `border-top` separators.

**G) Minor UI fixes**

- `layout.css`: `.session-item` padding updated to `6px 16px 8px`.
- `sidebar.css`: `background: var(--bg-content)`, removed `border-left`.
- `metadata.js`: `mergeOrigin` preserves existing `origin.label`.

### Files

| File                                     | Action | Description                                                         |
| ---------------------------------------- | ------ | ------------------------------------------------------------------- |
| `src/cron/isolated-agent/run.js`         | EDIT   | Soft warning on announce failure, added `cronSessionKey` to return  |
| `src/cron/service/timer.js`              | EDIT   | `sendToSession` delivery, clean label, session auto-delete          |
| `src/gateway/server-cron.js`             | EDIT   | Added `sendToSession`, `deleteCronSession` deps, sessions broadcast |
| `src/agents/tools/config-manage-tool.js` | EDIT   | `handleCron` reduced to board-only                                  |
| `src/agents/tools/cron-tool.js`          | EDIT   | Anti-duplication instruction in description                         |
| `src/agents/skills/workspace.js`         | EDIT   | Capabilities catalog cron entry updated                             |
| `src/config/sessions/metadata.js`        | EDIT   | `mergeOrigin` preserves existing label                              |
| `ui/src/ui/chat/grouped-render.js`       | EDIT   | Cross-message tool card deduplication                               |
| `ui/src/ui/views/chat.js`                | EDIT   | Minimal queue markup                                                |
| `ui/src/styles/components.css`           | EDIT   | Compact queue styles                                                |
| `ui/src/styles/layout.css`               | EDIT   | Session item padding                                                |
| `ui/src/styles/chat/sidebar.css`         | EDIT   | Background, border cleanup                                          |

---

## Phase 74 — Intent-Based Simplification + Security Audit (10 Mar 2026)

Security audit against Daniel Miessler's OpenClaw vulnerability report (10 critical points). GenosOS passes all 10. Introduced intent-based configuration philosophy: users speak in goals, Nyx translates to config. Tools tab removed from Settings modal — tool profiles, deny bins, and security posture are now fully managed by the agent. Config Map reduced from 13 sections to 5 essential cards (Providers, Agents, Channels, Skills, Cron). Quick commands simplified from 15 generated `/config X` entries to 7 direct commands (`/providers`, `/agents`, `/channels`, `/skills`, `/cron`, `/reset`, `/compact`).

### Security Audit — GenosOS vs OpenClaw (10/10)

| #   | Vulnerability (OpenClaw)          | GenosOS Status                                               |
| --- | --------------------------------- | ------------------------------------------------------------ |
| 1   | Plaintext config/secrets          | NYXENC1 AES-256-GCM vault, macOS Keychain                    |
| 2   | No auth on management interface   | Token auth + WebAuthn/Touch ID                               |
| 3   | Excessive LLM permissions         | 5-layer exec hardening, DENY_BINS, approval gates            |
| 4   | No input validation               | Zod schemas + blueprints + shell bleed detection             |
| 5   | Supply chain risk (37 extensions) | 29 active (9 archived), curated, no `npm install` at runtime |
| 6   | Default-open gateway              | 127.0.0.1 bind, refuses non-loopback without auth            |
| 7   | Sandbox without defense-in-depth  | Sandbox eradicated (Phase 70), host-level hardening          |
| 8   | No audit trail                    | HMAC-SHA256 tamper-evident audit log                         |
| 9   | Multi-tenant isolation gaps       | Single-user product, NYXENC1 per-file encryption             |
| 10  | No security update mechanism      | Weekly cron monitoring via `gh api`                          |

### Intent-Based Configuration Model

Three categories for every configurable parameter:

1. **User decides** — identity, channel selection, business hours
2. **Nyx recommends + user confirms** — tool profiles, model tier, channel policies
3. **Nyx decides** — encryption, exec hardening, routing weights, buffer policies

### Changes

**A) Security audit document**

- Created `SECURITY-AUDIT.md` — comprehensive comparison against 10 OpenClaw vulnerability points

**B) Tools tab removal**

- Removed Tools tab from Settings modal (4→3 tabs: Gateway, Config, Files)
- Removed ~175 lines of Tools tab renderer: `renderToolsTab`, `ensureToolsDraft`, `isToolEnabled`, `toggleTool`, `setProfile`, `toggleDenyBin`, `DEFAULT_DENY_BINS`
- Removed orphaned imports: `normalizeToolName`, `TOOL_SECTIONS`, `PROFILE_OPTIONS`, `resolveToolProfile`, `isAllowedByPolicy`, `matchesList`
- Default settings tab changed from "tools" to "gateway" in `app-render.js`
- Removed `tools.status.requested`/`completed` event handlers from `app-gateway.js`
- Removed 4 toolsStatus state properties and 2 methods from `app.js`

**C) Dead code cleanup (~1,160 lines)**

- Deleted `tools-status-overlay.js` (255 lines, never imported)
- Deleted `agents-panels-tools-skills.js` (531 lines, never imported)
- Removed dead exports from `agents-utils.js`: `TOOL_SECTIONS`, `PROFILE_OPTIONS`, `resolveToolProfile()`, `isAllowedByPolicy()`, `matchesList()`, `compilePattern()`, `compilePatterns()`, `matchesAny()`
- Removed 125 lines of `.tools-overlay__*` CSS from `components.css`

**D) Config Map surface reduction**

- Reduced from 13 sections to 5 essential cards: Providers, Agents, Channels, Skills, Cron
- Quick commands simplified: 15 generated `/config X` → 7 direct (`/providers`, `/agents`, `/channels`, `/skills`, `/cron`, `/reset`, `/compact`)
- Updated both `settings-modal.js` (Config tab) and `config-modal.js` (standalone overlay)
- Hint phrases updated to informative style (no technical parameters)

### Files

| File                                            | Action | Description                             |
| ----------------------------------------------- | ------ | --------------------------------------- |
| `SECURITY-AUDIT.md`                             | CREATE | Security audit document                 |
| `ui/src/ui/views/settings-modal.js`             | EDIT   | Tools tab removed, Config Map reduced   |
| `ui/src/ui/views/config-modal.js`               | EDIT   | Config Map reduced (standalone overlay) |
| `ui/src/ui/app-render.js`                       | EDIT   | Default tab "tools" → "gateway"         |
| `ui/src/ui/app-gateway.js`                      | EDIT   | Removed tools.status event handlers     |
| `ui/src/ui/app.js`                              | EDIT   | Removed toolsStatus state + methods     |
| `ui/src/ui/views/agents-utils.js`               | EDIT   | Removed dead tool-policy exports        |
| `ui/src/styles/components.css`                  | EDIT   | Removed .tools-overlay CSS (125 lines)  |
| `ui/src/ui/views/tools-status-overlay.js`       | DELETE | Orphaned file (255 lines)               |
| `ui/src/ui/views/agents-panels-tools-skills.js` | DELETE | Orphaned file (531 lines)               |

---

## Phase 75 — Channel Tool Restrictions (10 Mar 2026)

Closes the primary attack vector identified during the Phase 74 security audit: **the same `full` tool profile applied to all channels**, regardless of trust level. A WhatsApp DM had the same `exec`/`bash` access as the localhost WebUI with Touch ID.

### The Problem

GenosOS is multi-channel — WebUI, WhatsApp, Telegram, Discord, Signal, voice calls. Each channel has a fundamentally different trust level:

| Channel                 | Authentication            | Trust   | Risk                        |
| ----------------------- | ------------------------- | ------- | --------------------------- |
| WebUI (localhost)       | Token + WebAuthn/Touch ID | Maximum | Low — biometric on device   |
| WhatsApp DM (owner)     | Phone number verification | High    | Medium — no biometric       |
| Telegram/Discord/Signal | External platform auth    | Medium  | High — no GenosOS auth      |
| Voice call (Twilio)     | None                      | Low     | Very high — anyone can call |

Before Phase 75, `inferToolProfile()` only looked at the **agent name** at creation time. A message from WhatsApp had the same power as the WebUI — including `exec`, `bash`, `write`, `browser`.

### The Solution: Channel Deny Pipeline Step

Instead of creating new profiles (rigid packages that don't fit every use case), channel restrictions operate as a **deny-only pipeline step** — the system removes specific tools per channel after all allow/profile steps have run.

**Pipeline order (10 steps):**

```
1. Profile policy (allow)           — existing
2. Provider profile                 — existing
3. Global allow                     — existing
4. Global provider allow            — existing
5. Agent allow                      — existing
6. Agent provider allow             — existing
7. Group tools                      — existing (groups only)
8. Channel restrictions             — NEW (deny per channel, DMs + groups)
9. Subagent deny                    — existing
10. Gateway HTTP deny               — existing (HTTP invocation only)
```

Step 8 is a **hard deny** — regardless of what previous steps allowed, if the channel says "no exec", exec is removed. Same mechanism as subagent deny (step 9), using the existing `filterToolsByPolicy()` infrastructure.

### Built-in Defaults (zero config required)

| Channel            | Denied tools                                                     | Reason                           |
| ------------------ | ---------------------------------------------------------------- | -------------------------------- |
| `webchat`          | none                                                             | localhost + WebAuthn + DENY_BINS |
| `whatsapp`         | `exec, bash, process`                                            | owner verified but no biometric  |
| `telegram`         | `exec, bash, process`                                            | external platform                |
| `discord`          | `exec, bash, process`                                            | external platform                |
| `signal`           | `exec, bash, process`                                            | external platform                |
| `voice`            | `exec, bash, process, write, edit, read, browser, canvas, nodes` | anyone can call                  |
| all other external | `exec, bash, process`                                            | principle of least privilege     |

### Explicit Override

Global config:

```json
{
  "tools": {
    "channelRestrictions": { "whatsapp": { "deny": ["exec", "bash", "process", "write"] } }
  }
}
```

Per-agent override (e.g., DevOps agent needs full WhatsApp access):

```json
{
  "agents": {
    "list": [{ "id": "devops", "tools": { "channelRestrictions": { "whatsapp": { "deny": [] } } } }]
  }
}
```

Resolution order: per-agent override → global config → built-in defaults.

### Why Deny-Only (not profiles)

The existing 4 profiles (minimal/coding/messaging/full) are rigid packages:

- `messaging` has no `read` → can't read documents from WhatsApp
- `coding` has `exec` → too much for WhatsApp
- No profile fits "WhatsApp owner": needs `read` + `web_search` + `message` but not `exec`

Deny-only is:

- **Granular** — block `exec` but keep `browser`, or block `write` but keep `read`
- **Additive** — new tools are available by default, you decide what to block
- **Auditable** — the deny list is readable: "WhatsApp: no exec, bash, process"
- **Composable** — stacks with profiles, allow lists, group policies, subagent deny

### Orphaned tools.status Cleanup

Also removed the `tools.status` overlay infrastructure orphaned by Phase 74:

- `config_manage tools status` sub-action (opened overlay that no longer exists in UI)
- `tools.status.initiate` + `tools.status.complete` RPC handlers in `web.js`
- `createPendingToolsStatus` + `resolvePendingToolsStatus` helper functions (~130 lines)
- Updated capabilities catalog and security-ops guide references

### Files

| File                                      | Action | Description                                           |
| ----------------------------------------- | ------ | ----------------------------------------------------- |
| `src/agents/pi-tools.policy.js`           | EDIT   | `resolveChannelRestrictions()` + defaults + constants |
| `src/agents/pi-tools.js`                  | EDIT   | Channel restrictions pipeline step                    |
| `src/gateway/tools-invoke-http.js`        | EDIT   | Channel restrictions pipeline step (HTTP path)        |
| `src/config/zod-schema.agent-runtime.js`  | EDIT   | `ChannelRestrictionsSchema` in global + per-agent     |
| `src/agents/tools/blueprints/agents.js`   | EDIT   | 2 blueprints for `channelRestrictions.*.deny`         |
| `src/agents/tools/guides/agents.md`       | EDIT   | TOON section on channel restrictions                  |
| `src/agents/skills/workspace.js`          | EDIT   | Capabilities catalog updated                          |
| `src/agents/channel-restrictions.test.js` | CREATE | 9 tests covering defaults, overrides, webchat         |
| `src/agents/tools/config-manage-tool.js`  | EDIT   | Removed `tools status` sub-action                     |
| `src/gateway/server-methods/web.js`       | EDIT   | Removed tools.status handlers + helpers (~130 lines)  |
| `src/agents/tools/guides/security-ops.md` | EDIT   | Updated tools reference                               |

### Verification

- Build: `vite build` — 0 errors
- Tests: 739 passed (was 738), 1 preexisting failure (cron delivery-plan)
- 9 new tests: webchat unrestricted, voice heavy deny, WhatsApp default deny, Telegram default deny, global config override, per-agent override, per-agent custom deny, unknown channels default, no messageProvider

---

## Phase 78 — Immutable Security Layer + Autonomous Doctor (11 Mar 2026)

Two-layer security architecture and autonomous system health engine replacing OpenClaw's legacy 37-file interactive doctor.

### Two-Layer Security Architecture

Anti-injection rules, identity verification, and session integrity moved from editable `SECURITY.md` to hardcoded `## Safety` section in `system-prompt.js` (position 4 — primacy zone). No agent tool can modify `.js` source files, providing true architectural protection.

- **Immutable layer** (`system-prompt.js`): anti-injection patterns (9 documented attack vectors), identity verification, session integrity, compaction authority rules
- **Personalizable layer** (`SECURITY.md`): scope of trust, vault awareness, channel restrictions, custom red lines — editable per agent
- `SECURITY.md` template rewritten — removed anti-injection rules (now hardcoded), kept only agent-specific policies

### Autonomous Doctor Engine

New `src/doctor/engine.js` (~280 lines) — autonomous system health with 7 checks, auto-fixes, and structured reporting. Replaces OpenClaw's 37-file interactive CLI doctor.

- **7 checks:** state, config, gateway, security, memory, workspace, channels
- **Auto-fixes:** dir creation, permissions (chmod 700/600), stale lock cleanup
- **Reports:** gateway health, vault status, DM policies, security audit integration, memory search, workspace files, channels
- **All checks via `Promise.allSettled()`** for resilience
- **Structured output:** `{ ts, summary: { critical, warnings, info, ok, fixed }, checks: [{ name, label, findings }] }`
- **4 access points:** WebUI (`config_manage doctor`), CLI (`genosos doctor`), RPC (`doctor.run`), internal (post-update)
- **`doctor.md` TOON guide** — loaded on-demand, presentation rules, examples
- **9 unit tests** — all passing

### Legacy Doctor Removal

- **37 files deleted** from `src/commands/doctor*.js` (OpenClaw's interactive CLI doctor)
- **3 utility files moved** to proper locations: `completion-check.js` → `src/cli/`, `config-guard-flow.js` + `legacy-config.js` → `src/config/`
- All import paths updated (onboarding, config-guard, update-command, tests)

### Security Guard Template

- Updated `skills/agent-templates/templates/security-guard.md` to use `config_manage doctor` for daily system health
- Daily cron: `config_manage doctor` (full 7-area health check)
- Weekly cron: `config_manage security audit value=deep` (deep vulnerability scan)

**Files:** system-prompt.js, SECURITY.md template, doctor/engine.js (+test), server-methods/doctor.js, config-manage-tool.js, register.maintenance.js (+test), update-command.js, doctor.md guide, security-guard.md template, 37 files deleted, 3 files moved. 738 test suites, 6384 passing.

---

## Phase 77 — Security Audit Intelligence + UI Polish + TTS Fix (10 Mar 2026)

Smarter security audit output, queue UI integration, Kokoro TTS double-prefix fix, and compaction token refresh.

### Security Audit Intelligence

Three improvements to reduce false positives and surface real vault state:

1. **Known node commands** — `listKnownNodeCommands()` now includes `DEFAULT_DANGEROUS_NODE_COMMANDS` (camera.snap, screen.record, calendar.add, etc.) as valid system names. Previously, having these in `denyCommands` triggered "unknown command" warnings — now they're recognized as intentional deny entries.
2. **Trusted proxies severity** — `trusted_proxies_missing` downgraded from `warn` to `info` when gateway is loopback-only. No attack vector exists when binding to 127.0.0.1, so the warning was noise.
3. **Real vault status** — `config_manage security status` now reads live vault runtime state via `getVaultStatus()` instead of checking a static config flag. Reports actual lock/unlock state.

### Queue Styling

Removed card/bubble appearance from queue items. Now integrates with page background (`var(--bg-content)`), uses `border-top` separator between items, and shows visible `✕` remove buttons per item.

### Kokoro TTS Fix

Fixed double-prefix bug: UI was constructing `/v1/v1/audio/speech` because the default `kokoroBaseUrl` already included `/v1` but the fetch path prepended it again. UI default now aligned with backend format — fetch uses `/audio/speech` directly.

### Compaction Token Refresh

Added delayed `loadSessions` call (1.5s) after `compaction:end` event so the UI catches updated `totalTokens` from the backend. Previously, token count in sidebar could remain stale until next user action.

### Files

| File                                     | Action | Description                                              |
| ---------------------------------------- | ------ | -------------------------------------------------------- |
| `src/security/audit-extra.sync.js`       | EDIT   | Import DEFAULT_DANGEROUS_NODE_COMMANDS, add to known set |
| `src/security/audit.js`                  | EDIT   | trusted_proxies_missing severity warn→info               |
| `src/security/audit.test.js`             | EDIT   | Updated expected severity in test                        |
| `src/agents/tools/config-manage-tool.js` | EDIT   | security status reads getVaultStatus() for real state    |
| `ui/src/styles/components.css`           | EDIT   | Queue bg-content, no border-radius, visible remove       |
| `ui/src/ui/app-tool-stream.js`           | EDIT   | Delayed loadSessions after compaction end                |
| `ui/src/ui/app.js`                       | EDIT   | TTS URL fix (default includes /v1, fetch /audio/speech)  |

---

## Phase 82 — Smart Incremental Backup Engine (11 Mar 2026)

Complete rewrite of the backup engine from static scope-based to intelligent change-detection system. The engine now autonomously decides between full and incremental backups — zero LLM cognitive load.

### Smart Change Detection

Engine diffs current file SHA-256 hashes against the latest manifest. First backup or no previous → full. Files changed → incremental (only delta). Nothing changed → skip. After 7 consecutive incrementals → auto-promotes to full. Agent calls `backup create` with no parameters — engine decides everything.

### Cycle-Based Retention

Replaced count-based rotation (14 max) with cycle-aware retention: keeps current cycle (latest full + up to 7 incrementals) + previous full as safety net. Old incrementals are cleaned when a new full is created. Desktop mirror cleanup included — deleting a local backup also removes its Desktop copy.

### Automatic Desktop/iCloud Copy

All backups (full and incremental) auto-copy to `~/Desktop/Nyx-Backups/` for iCloud sync. Tilde expansion (`~/`) resolved via `os.homedir()`. No agent configuration needed.

### Incremental Restore Chain

`restoreBackup` walks the manifest chain: finds the last full, applies incrementals in order, handles file removals from delta metadata. Any backup in the chain can be the restore target.

### Prompt Simplification

Removed all scope references (`full|config|config+workspace`) from: Capabilities catalog (`workspace.js`), tool description (`config-manage-tool.js`), operational guide (`backup.md`). Agent only sees `backup: state backups — create, list, verify, restore`. Engine returns `type`, `delta`, `skipped` fields — agent reports what the engine decided.

### Build Fix

`scripts/write-cli-compat.js` gracefully exits when `dist/daemon-cli*` bundle is absent (legacy tsdown artifact from TS era). Build no longer fails.

### Performance

- Full backup: ~13s, ~523 MB (unchanged)
- Incremental: ~780ms, ~357 KB (new)
- Skip: instant (new)
- Max disk: ~1.05 GB (2 fulls + 7 incrementals) vs ~7.3 GB before (14 random backups)

### Files

| File                                     | Action  | Description                                                               |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `src/backup/engine.js`                   | REWRITE | Smart incremental engine with cycle retention                             |
| `src/backup/engine.test.js`              | REWRITE | 12 tests: full, incremental, skip, auto-promote, cycle retention, restore |
| `src/agents/tools/config-manage-tool.js` | EDIT    | Simplified handler — no scope/copyTo params                               |
| `src/agents/tools/guides/backup.md`      | REWRITE | Simplified guide — no scope decisions for agent                           |
| `src/agents/skills/workspace.js`         | EDIT    | Cleaned backup entry in capabilities catalog                              |
| `scripts/write-cli-compat.js`            | EDIT    | Graceful exit when daemon-cli bundle absent                               |

---

## Phase 81 — Backup Engine, Approval Snapshot Binding, Permissions-Policy (11 Mar 2026)

Three security and infrastructure improvements inspired by OpenClaw divergence analysis, adapted to GenosOS's local-first architecture.

### Backup Engine (agent-managed)

New `config_manage backup` action with 4 sub-actions: `create` (scope: full, config, config+workspace), `list`, `verify`, `restore`. Backup engine at `src/backup/engine.js` produces tar.gz archives with SHA-256 manifest for integrity verification. Follows doctor pattern — agent-managed, not CLI-driven. Stored in `~/.genosv1/backups/`. Files backed up as-is (encrypted if vault active). Added to CONFIG_CATALOG_ENTRIES so agent discovers it automatically.

### Approval Snapshot Binding

Exec approvals now capture `argvHash` (SHA-256 of JSON-serialized argv array) and `scriptContentHash` (SHA-256 of script file content for Python/Node scripts). At execution time, argv hash is recomputed and compared — if arguments changed between approval and execution, the request is rejected. Backward compatible: old approvals without hashes pass validation. 3 new tests.

### Permissions-Policy Header

Added `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` to Control UI security headers. Disables browser APIs not used by the gateway UI.

### Files

| File                                                | Action | Description                              |
| --------------------------------------------------- | ------ | ---------------------------------------- |
| `src/backup/engine.js`                              | CREATE | Backup create/verify/list/restore engine |
| `src/backup/engine.test.js`                         | CREATE | 6 tests for backup engine                |
| `src/gateway/node-invoke-approval-snapshot.test.js` | CREATE | 3 tests for snapshot binding             |
| `src/agents/bash-tools.exec.js`                     | EDIT   | Capture argvHash + scriptContentHash     |
| `src/gateway/node-invoke-system-run-approval.js`    | EDIT   | Validate argvHash at execution time      |
| `src/gateway/control-ui.js`                         | EDIT   | Added Permissions-Policy header          |
| `src/agents/tools/config-manage-tool.js`            | EDIT   | Added backup action + sub-actions        |
| `src/agents/skills/workspace.js`                    | EDIT   | Added backup to CONFIG_CATALOG_ENTRIES   |

## Phase 80 — Auth Hardening + Local-First Skills Documentation (11 Mar 2026)

Eliminated `auth: "none"` from schema and all code paths. Documented skills as local-first architecture. Enhanced security-guard agent template with skill-scanner awareness.

### Removed: `auth: "none"` mode

The `"none"` auth mode allowed unauthenticated gateway access — unnecessary since token auto-generates when missing. Removed from:

- **Zod schema** (`zod-schema.js`): `z.literal("none")` removed from auth mode union
- **Gateway auth** (`auth.js`): "none" bypass branch removed
- **Browser control auth** (`control-auth.js`): two `mode === "none"` early returns removed
- **Gateway CLI** (`run.js`): "none" warning log removed
- **Doctor engine** (`engine.js`): default fallback changed from `"none"` to `"token"`, `gateway_exposed` finding removed
- **All tests updated**: 6 test cases removed/replaced across 4 test files, 39 tests pass

### Skills: local-first by design

Documented in SECURITY.md that GenosOS skills are local-first Markdown files, not executable code. No marketplace dependency — ClawHub is optional. Skill scanner (8 rules) covers the threat model. No code signing needed because skills are knowledge, not binaries.

### Security-guard template

Added skill-scanner awareness to `skills/agent-templates/templates/security-guard.md` — audit description now mentions automatic code scanning of installed skills and plugins.

### Files

| File                                                 | Action | Description                                 |
| ---------------------------------------------------- | ------ | ------------------------------------------- |
| `src/config/zod-schema.js`                           | EDIT   | Removed `z.literal("none")` from auth union |
| `src/gateway/auth.js`                                | EDIT   | Removed "none" bypass                       |
| `src/browser/control-auth.js`                        | EDIT   | Removed 2 "none" mode checks                |
| `src/cli/gateway-cli/run.js`                         | EDIT   | Removed "none" warning log                  |
| `src/doctor/engine.js`                               | EDIT   | Default → "token", removed gateway_exposed  |
| `src/gateway/auth.test.js`                           | EDIT   | Removed 3 "none" mode test cases            |
| `src/doctor/engine.test.js`                          | EDIT   | Updated to token mode, removed exposed test |
| `src/browser/control-auth.test.js`                   | EDIT   | Removed "none mode" describe block          |
| `src/gateway/server-runtime-config.test.js`          | EDIT   | Removed 2 "none" tests                      |
| `SECURITY.md`                                        | EDIT   | Added "Skills — local-first by design"      |
| `skills/agent-templates/templates/security-guard.md` | EDIT   | Added skill-scanner to audit description    |

## Phase 79 — Persistent Audio Player, Tips Curation, Memory Template Cleanup (11 Mar 2026)

Custom audio player with HTTP Range seek, curated activity tips, depersonalized memory template, and Config Map cleanup.

### Persistent TTS Audio Player

Audio files persisted to `~/.genosv1/media/` before temp cleanup. New `/_media/` HTTP route serves files with Range request support for seeking. Custom minimal player in chat: SVG play/pause icons, thin progress bar with draggable thumb, time display, download and delete buttons. Lit `guard` directive prevents re-render destruction during `startActivityTick`.

### Activity Tips Curation

Tips reduced from 33 to 15 — removed obvious, redundant, and overly verbose entries. Focus on non-discoverable features: TTS, channels, providers, security, skills, usage, memory, agents. Empty categories fall back to `thinking` tips. Random start offset per session. Config Map hints reduced from 3 to 2 per card.

### Memory Document Template

`memory-document-template.js` fully depersonalized — all "Esteban" references replaced with "the user". Section headers and examples translated from Spanish to English. Template ready for clean installations.

### Removed: Chat Prompt Pulse

Attempted green↔orange pulse animation on chat `●` dot during agent activity. Removed due to architectural mismatch — tool cards arrive as completed history items, not streamable DOM. Sidebar dots continue to pulse via existing `dot-green-cyan` animation.

### Files

| File                                     | Action | Description                                         |
| ---------------------------------------- | ------ | --------------------------------------------------- |
| `src/tts/tts.js`                         | EDIT   | Persist audio to `~/.genosv1/media/` before cleanup |
| `src/gateway/control-ui.js`              | EDIT   | `/_media/` route with Range requests + DELETE       |
| `src/gateway/server-http.js`             | EDIT   | Register `handleControlUiMediaRequest`              |
| `src/agents/memory-document-template.js` | EDIT   | Depersonalized, all English                         |
| `ui/src/ui/chat/grouped-render.js`       | EDIT   | Custom audio player, tips 33→15, guard directive    |
| `ui/src/ui/views/chat.js`                | EDIT   | Removed prompt pulse logic                          |
| `ui/src/ui/views/settings-modal.js`      | EDIT   | Config Map hints 3→2 per card                       |
| `ui/src/styles/components.css`           | EDIT   | Audio player styles                                 |
| `ui/src/styles/chat/grouped.css`         | EDIT   | Removed prompt-pulse animation                      |

## Phase 80 — Auth Hardening, Skills Local-First (11 Mar 2026)

Removed `auth: "none"` mode entirely — token auto-generates if missing. Skills documented as local-first Markdown (not executable code). Security-guard template updated with skill-scanner awareness.

### Files

| File                                                 | Action | Description                                 |
| ---------------------------------------------------- | ------ | ------------------------------------------- |
| `src/config/zod-schema.js`                           | EDIT   | Removed `z.literal("none")` from auth union |
| `src/gateway/auth.js`                                | EDIT   | Removed "none" bypass                       |
| `src/browser/control-auth.js`                        | EDIT   | Removed 2 "none" mode checks                |
| `src/cli/gateway-cli/run.js`                         | EDIT   | Removed "none" warning log                  |
| `src/doctor/engine.js`                               | EDIT   | Default → "token", removed gateway_exposed  |
| `SECURITY.md`                                        | EDIT   | Added "Skills — local-first by design"      |
| `skills/agent-templates/templates/security-guard.md` | EDIT   | Added skill-scanner to audit description    |

## Phase 81 — Approval Snapshot Binding, Permissions-Policy (11 Mar 2026)

Approval system now binds `argvHash` + `scriptContentHash` to prevent post-approval script mutation. HTTP `Permissions-Policy` header added to control UI responses.

### Files

| File                                | Action | Description                          |
| ----------------------------------- | ------ | ------------------------------------ |
| `src/agents/tools/exec-approval.js` | EDIT   | argvHash + scriptContentHash binding |
| `src/gateway/server-http.js`        | EDIT   | Permissions-Policy header            |

## Phase 82 — Smart Incremental Backup Engine (11 Mar 2026)

Automatic backup system with full/incremental/skip logic. Cycle-based retention (configurable). Auto-copy to Desktop and iCloud. Backup operational guide added.

### Files

| File                                     | Action | Description                        |
| ---------------------------------------- | ------ | ---------------------------------- |
| `src/backup/engine.js`                   | CREATE | Smart incremental backup engine    |
| `src/agents/tools/guides/backup.md`      | CREATE | Operational guide for backup setup |
| `src/agents/tools/config-manage-tool.js` | EDIT   | backup sub-action                  |

## Phase 83 — Animated Charts, Usage Overlay Removal (12 Mar 2026)

Integrated Frappe Charts for `nyx-ui` chart components. Removed Usage Chart browser overlay — usage data now rendered inline via animated charts. Fixed code block styles for highlight.js.

### Files

| File                                  | Action | Description                            |
| ------------------------------------- | ------ | -------------------------------------- |
| `ui/src/ui/interactive/chart-init.js` | CREATE | Frappe Charts lazy loader + renderer   |
| `ui/src/ui/interactive/renderers.js`  | EDIT   | Chart component support                |
| `ui/src/styles/chat/interactive.css`  | EDIT   | Chart container styles                 |
| `ui/src/styles/chat/text.css`         | EDIT   | highlight.js theme (dark + light)      |
| `ui/src/ui/markdown.js`               | EDIT   | DOMPurify: allow id + data-chart attrs |

## Phase 84 — Pre-Built Chart Blocks, Enhanced Tables, Spacing (12 Mar 2026)

Server-side `_chartBlock` pattern for deterministic chart rendering — LLM copies verbatim instead of generating nyx-ui blocks. Unified usage sub-actions (summary/cost/chart → single handler). Enhanced data-table renderer with numeric alignment, max/min highlighting. Spacing fixes between tool cards and text.

### Key Changes

- `buildUsageChartBlock()` pre-builds complete nyx-ui fenced blocks server-side
- `buildUsageTotals()` replaces full daily array spread with compact 4-field summary
- `inferUsageMetric()` auto-detects cost vs tokens from user params
- Data tables: `isNumeric()` detection, `tabular-nums`, auto right-alignment, `.ix-val-max` / `.ix-val-min` highlighting

### Files

| File                                     | Action | Description                                           |
| ---------------------------------------- | ------ | ----------------------------------------------------- |
| `src/agents/tools/config-manage-tool.js` | EDIT   | Pre-built chart blocks, unified usage handler         |
| `ui/src/ui/interactive/renderers.js`     | EDIT   | Numeric detection, max/min highlights, empty col trim |
| `ui/src/styles/chat/interactive.css`     | EDIT   | Chart width 100%, table enhancements                  |
| `ui/src/styles/chat/text.css`            | EDIT   | Table + text spacing rules                            |
| `ui/src/styles/chat/tool-cards.css`      | EDIT   | Tool card bottom margin for spacing                   |

## Phase 85 — CSS Architecture Cleanup (12 Mar 2026)

Comprehensive CSS audit and refactoring in three priorities.

### P1: Dead CSS Removal (-605 lines)

Systematic grep of all CSS class names against JS source files. Removed 605 lines of dead selectors from `components.css` (2,813 → 2,208 lines). Consolidated duplicate `.chat-text` rules into `chat/text.css` as single source of truth.

Dead selectors removed: `account-card*`, `status-list`, `stat-card`, `note-title`, `agent-list/row/avatar/info/title/sub/header/tabs/model/tools`, `theme-toggle*`, `statusDot`, `chat-header/session/line/msg/stamp`, `btn-kbd`, `btn--xs`, `exec-approval-title__agent`, `agent-kv-sub`, `agent-file-row-meta/name/meta/title/sub/actions`.

### P2: Component Split (-957 lines from components.css)

Split `components.css` monolith into focused files:

- `modals.css` (650 lines) — Connection, Settings, Config, Config Editor, Config Map, Health, QR, Exec Approval, Channel Setup
- `agents.css` (297 lines) — Agent pills, selector, overview, files, directories, skills

Moved `@import chat.css` from `components.css` to `styles.css`. Consolidated duplicate `btn.danger` variants. Final `components.css`: 1,251 lines (was 2,813).

### P3: CSS Variable Audit

Audited all 17 CSS files for variable collisions. Found one undefined variable: `--bg-offset` referenced in `modals.css` but never defined. Added to `base.css` for both themes (dark: `#15171e`, light: `#f3f3f3`). Zero collisions between files.

### CSS Architecture (final)

```
styles.css → base → layout → layout.mobile → components → modals → agents → chat → config → board → security
```

### Files

| File                           | Action | Description                                 |
| ------------------------------ | ------ | ------------------------------------------- |
| `ui/src/styles/components.css` | EDIT   | -1,562 lines (dead removal + extraction)    |
| `ui/src/styles/modals.css`     | CREATE | Modal and overlay styles (650 lines)        |
| `ui/src/styles/agents.css`     | CREATE | Agent UI styles (297 lines)                 |
| `ui/src/styles/chat/text.css`  | EDIT   | Consolidated chat-text rules, table spacing |
| `ui/src/styles/base.css`       | EDIT   | Added --bg-offset variable (dark + light)   |
| `ui/src/styles.css`            | EDIT   | Updated import order with new files         |

---

## Phase 86 — TUI Simplification + Session Autocomplete (12 Mar 2026)

Replaced the failed split-pane sidebar experiment (terminal scroll limitation) with a streamlined session-switching UX. Added `@` prefix autocomplete for inline session switching and simplified the slash command surface.

### Sidebar Eradication

Removed all split-pane/sidebar code after confirming terminals cannot support independent vertical scroll regions:

- Deleted `src/tui/components/split-pane.js` and `src/tui/components/sidebar.js`
- Cleaned `tui.js` — removed sidebar/splitPane/sidebarFocused/runningSessions references, lifecycle callbacks, Tab/CtrlB handlers, refreshSidebar functions
- Cleaned `custom-editor.js` — removed onCtrlB, onTab, onInputIntercept
- Cleaned `theme.js` — removed sidebar palette (sidebarBg, sidebarHeader, sidebarAgent, sidebarSelected)
- Cleaned `tui-event-handlers.js` — removed onLifecycleStart/onLifecycleEnd lifecycle tracking
- Cleaned `commands.js` — removed `/sidebar` command

### `@` Session Autocomplete

New `src/tui/session-autocomplete.js` — wraps `CombinedAutocompleteProvider` to intercept `@` prefix:

- Type `@` to see all sessions across all agents in an inline popup (same UX as `/` for commands)
- Type `@main` or `@whatsapp` to filter by session name or key
- Select a session to instantly switch (clears input, triggers `setSession()`)
- Sessions cached on connect and refreshed on `sessions.changed` events
- Labels use `displayName` or session key (not `derivedTitle` which showed message previews)
- 8 unit tests covering suggestions, filtering, selection, delegation

### Session Selector Fix

Fixed `/sessions` overlay to show correct session names:

- Removed `agentId` filter — now shows all sessions across all agents
- Label uses `displayName ?? parsed.rest` (MAIN SESSION, WHATSAPP:+346...) instead of `derivedTitle` (which was "Memory Prefetch — 5 relevant")
- Description shows `agentId · time · preview` for context
- Increased visible items from 9 to 12

### Overlay Background

Added background color to all TUI overlays via `OverlayBackgroundWrapper` in `tui-overlays.js`:

- New `overlayBg` palette entry (`#363B44`) — lighter gray than terminal background
- Wrapper applies `theme.overlayBg` to each rendered line with full-width padding
- Proxies `render`, `handleInput`, `invalidate`, `onSelect`, `onCancel`, `id`

### Slash Command Simplification

Reduced slash commands from 30 to 11 (autocomplete only — handlers preserved for manual use):

```
/help /status /sessions /new /reset /compact /channels /providers /skills /config /quit
```

Removed from autocomplete: `/agent`, `/agents`, `/session`, `/model`, `/models`, `/think`, `/verbose`, `/reasoning`, `/usage`, `/elevated`, `/elev`, `/activation`, `/abort`, `/cron`, `/logs`, `/files`, `/settings`, `/exit`. Gateway text commands no longer injected into autocomplete.

### Files

| File                                   | Action | Description                                            |
| -------------------------------------- | ------ | ------------------------------------------------------ |
| `src/tui/session-autocomplete.js`      | CREATE | `@` prefix session autocomplete provider               |
| `src/tui/session-autocomplete.test.js` | CREATE | 8 tests for session autocomplete                       |
| `src/tui/tui.js`                       | EDIT   | Session cache, cleanup sidebar refs, wire `@` provider |
| `src/tui/tui-overlays.js`              | EDIT   | OverlayBackgroundWrapper with overlayBg                |
| `src/tui/tui-command-handlers.js`      | EDIT   | Fix session selector labels, remove agentId filter     |
| `src/tui/tui-event-handlers.js`        | EDIT   | Remove lifecycle callbacks                             |
| `src/tui/commands.js`                  | EDIT   | Reduce to 11 slash commands                            |
| `src/tui/theme/theme.js`               | EDIT   | Add overlayBg, remove sidebar palette                  |
| `src/tui/components/custom-editor.js`  | EDIT   | Remove sidebar key handlers                            |
| `src/tui/components/split-pane.js`     | DELETE | Unused sidebar layout                                  |
| `src/tui/components/sidebar.js`        | DELETE | Unused sidebar component                               |
| `src/tui/tui.test.js`                  | EDIT   | Updated command tests                                  |
| `src/tui/tui-overlays.test.js`         | EDIT   | Updated for wrapper                                    |
