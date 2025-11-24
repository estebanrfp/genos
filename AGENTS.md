# Repository Guidelines

- Repo: https://github.com/estebanrfp/GenosOS
- GitHub issues/comments/PR comments: use literal multiline strings or `-F - <<'EOF'` (or $'...') for real newlines; never embed "\\n".

## GenosOS — Project Direction & Philosophy

### GenosOS is NOT OpenClaw

GenosOS originated as a fork of OpenClaw but has diverged into a **radically different project**. The codebases are no longer merge-compatible (TypeScript eradicated, providers unified, vault encryption, blueprint system, UI elimination strategy). This divergence is intentional and permanent.

**OpenClaw's direction:** conform to all sectors, maximize features, grow the dashboard. The result is a complex system that becomes a vulnerability surface — more tabs, more forms, more attack vectors, more things for users to misconfigure.

**GenosOS's direction:** the opposite. An intelligent orchestrator that solves problems for any human — no technical knowledge required. Constantly self-verifying security. Easily controllable by nature, not by complexity. Keep it simple.

### Core Principles

1. **Simplicity above all, powered by the best models.** GenosOS demands the most capable models available — inferior models will not be admitted. The system's intelligence depends on frontier reasoning to understand context, guide users, and make autonomous decisions. Blueprints keep the mechanical enforcement simple so the model can focus on what it does best: thinking, advising, and solving problems. Simplicity is in the architecture, not in dumbing down the AI.

2. **Security by design, not by dashboard.** OpenClaw exposes security settings as forms users must understand. GenosOS encrypts everything at rest (NYXENC1 vault), gates sensitive operations with WebAuthn/Touch ID, and runs continuous self-verification. Security is the default state, not a configuration choice.

3. **The agent IS the interface.** Users should never need documentation, tutorials, or dashboard expertise. The agent understands the system, guides the user, suggests improvements, and prevents mistakes — all through natural conversation.

4. **Accessible to any human.** A person with zero technical knowledge should be able to configure, secure, and operate GenosOS through conversation. The blueprints make this possible by giving the agent mechanical intelligence about every config path.

### Agent-Triggered Modals (Browser & Terminal)

GenosOS allows interactive modals — but the critical distinction is **who triggers them**. In a traditional dashboard, the user navigates to a panel and clicks a button. In GenosOS, the **agent** decides it needs a browser-native or terminal-native interaction and fires it on demand.

**Browser modals (already implemented):**

- WebAuthn/Touch ID registration — agent calls `webauthn.register.initiate`, overlay appears, user touches sensor, overlay closes, agent continues
- WhatsApp QR login — agent calls `whatsapp.qr.initiate`, QR appears, user scans, modal closes
- Nostr profile edit — agent calls `nostr.profile.edit.initiate`, form appears, user saves, modal closes

**Terminal modals (future — same pattern):**

- Interactive prompts, selectors, confirmation dialogs
- The CLI agent fires them when it needs user input that can't be expressed in plain text
- Same flow: agent triggers → user interacts → agent resumes

**The rule:** modals are permitted and encouraged for interactions that genuinely require browser-native or terminal-native capabilities (biometrics, camera/QR, file pickers, rich form input). They are NOT a replacement for the eliminated dashboard — they are surgical, agent-controlled moments of interaction. The agent opens them, the agent closes them, the agent decides when they're needed. The user never has to find them in a menu.

This creates a visual experience that feels like magic: the user is chatting, the agent says "I need your fingerprint to register Touch ID," a modal appears, the user touches the sensor, it disappears, and the agent confirms "Done." No navigation, no settings panel, no learning curve.

### Relationship with OpenClaw Upstream

- **No more forks or merges.** The codebases have diverged too far (no TypeScript, different config format, vault, blueprints). Attempting merges would be destructive.
- **Cherry-pick selectively.** Monitor OpenClaw and its community for valuable improvements — new channel integrations, protocol updates, bug fixes, performance optimizations. Evaluate each on its own merit and reimplement in GenosOS's architecture if it aligns with our principles.
- **Never import complexity.** If an upstream feature adds dashboard panels, config surface, or attack vectors without clear value, skip it. GenosOS grows by removing, not adding.
- **Respect the community.** OpenClaw's community may produce excellent ideas. Adopt the ideas, not the implementation — our architecture is fundamentally different.

## config_manage — Autonomous Configuration Intelligence

### Strategic Goal

GenosOS aims for **total autonomous configuration** — the agent understands every config path, guides users through changes in natural language, suggests improvements proactively, and prevents corruption mechanically. Users should never need to read documentation, memorize schema rules, or navigate a complex dashboard. The agent IS the interface.

### The Problem We're Solving

Traditional dashboards force users to understand structure, valid values, and dependencies between fields. When config operations happen via AI (chat or CLI), the agent can misinterpret advisory instructions (`.md` docs) and corrupt config — e.g., writing numeric Discord IDs when they must be strings, or setting `dmPolicy=open` without `allowFrom=["*"]`. Advisory docs are suggestions; **blueprints are mechanical enforcement**.

### Operation Blueprints (`src/agents/tools/blueprints/`)

Declarative JS metadata files that `config_manage` lazy-loads on demand. Each blueprint tells the tool exactly how to coerce types, validate cross-field dependencies, and guide the agent — all mechanically, not advisorily.

**Blueprint shape:**

- `pathPattern` — glob match (e.g. `channels.*.allowFrom`)
- `valueType` — scalar, array, or object
- `itemCoerce` — type enforcement: `"string"`, `"number"`, `"smart"` (per-channel rules)
- `channelRules` — channel-specific overrides (Discord=string-always, Telegram=smart)
- `crossField` — dependency validation (dmPolicy=open requires allowFrom=["*"])
- `guidance` — natural language instruction returned to the agent via `describe`
- `enumValues`, `examples` — valid options and usage patterns

**Architecture — one file per CONFIG_SECTION, lazy-loaded:**

```
blueprints/
  index.js       — registry, lazy loader, matchPath, applyCoercion, checkCrossField
  channels.js    — 25+ channel blueprints (Phase 1 — DONE)
  security.js    — vault, fortress, webauthn (Phase 1 — DONE)
  gateway.js     — port, bind, TLS, auth (Phase 1 — DONE)
  agents.js      — agent list, defaults, tools, subagent delegation, agent-to-agent (DONE — 31 blueprints)
  messages.js    — TTS, streaming (DONE)
  providers.js   — credentials, endpoints (DONE)
  models.js      — defaults, fallbacks, routing (DONE)
  sessions.js    — retention, send policy, agent-to-agent ping-pong (DONE — 13 blueprints)
  advanced.js    — env, logging, plugins (DONE)
```

**When blueprints load (precision matters — there are many):**

1. **On `describe`** — agent asks about a path or section → lazy-load that section's blueprints → return guidance, type info, cross-field rules, and examples
2. **On `set`** — before writing → load blueprint → apply coercion → validate cross-field → reject or write
3. **On `remove`** — before comparison → load blueprint → coerce target to match array element type
4. **On section-level `describe`** — agent asks about a section key → list all blueprints with guidance summaries
5. **Never speculatively** — blueprints only load when the agent operates on a path in that section

### UI Elimination Strategy

Each UI section gets eliminated ONLY when its `config_manage` blueprint coverage is complete:

| Section   | Blueprint Status            | UI Status                               |
| --------- | --------------------------- | --------------------------------------- |
| Debug     | N/A (no config)             | ELIMINATED                              |
| Security  | Done (security.js)          | ELIMINATED                              |
| Instances | N/A (read-only)             | ELIMINATED                              |
| Overview  | N/A                         | ELIMINATED → Connection                 |
| Channels  | Done (channels.js)          | Coexists (browser-native: QR, overlays) |
| Gateway   | Done (gateway.js)           | ELIMINATED (hidden from Config sidebar) |
| Usage     | N/A (read-only analytics)   | ELIMINATED (chart overlay remains)      |
| Agents    | Done (agents.js — 31 bps)   | ELIMINATED                              |
| Config    | Done (full coverage)        | ELIMINATED → Config Map                 |
| Messages  | Done (messages.js)          | ELIMINATED                              |
| Providers | Done (providers.js)         | ELIMINATED → Overlay                    |
| Models    | Done (models.js)            | ELIMINATED                              |
| Session   | Done (sessions.js — 13 bps) | ELIMINATED                              |
| Advanced  | Pending (advanced.js)       | Active                                  |

**Rule:** a section is eligible for elimination when:

1. Every configurable path has a blueprint with coercion + cross-field rules
2. `config_manage describe <section>` returns complete operation list
3. Integration tests verify coercion and cross-field for critical paths
4. Browser-native interactions (WebAuthn, QR codes) have chat-triggered overlays
5. **Conversational examples added to `docs/blueprints/CONVERSATIONAL_GUIDE.md`** — for each eliminated section, document the natural language requests that replace the old UI interactions. This file is the user-facing reference for how to talk to the agent instead of navigating a dashboard. Every new blueprint section must have its corresponding conversational examples before the UI tab can be removed.
6. **Contrast with documentation** — before eliminating any section, review the relevant docs (`docs/concepts/`, `docs/reference/`) for understanding. Docs are reference only, not blocking.

### Future: CLI Integration

The blueprint system is designed to power a future `genosos config` CLI that developers will love:

- `genosos config describe channels.telegram.allowFrom` → same blueprint guidance
- `genosos config set channels.discord.allowFrom 123456` → same coercion (keeps as string)
- `genosos config check` → cross-field validation across entire config
- Tab completion powered by blueprint `pathPattern` + `enumValues`

Both the chat agent and the CLI consume the same blueprints — one source of truth for config intelligence.

### Agent Awareness

The agent must be conscious of what it's doing with config. The blueprint system enables this:

- Before any `set`: the agent can `describe` first to understand the field
- Cross-field errors explain WHY a change was rejected and WHAT to do
- Guidance text tells the agent the semantic meaning, not just the type
- Channel-specific rules prevent the Discord-as-number or Telegram-as-string class of bugs
- The agent can proactively suggest improvements: "Your dmPolicy is 'open' but allowFrom doesn't include '\*' — want me to fix that?"

**This refactor only works if the agent is aware of what it does through intelligent blueprint organization.** Blueprints are not passive documentation — they are active enforcement that makes the agent competent.

## Project Structure & Module Organization

- Source code: `src/` (CLI wiring in `src/cli`, commands in `src/commands`, web provider in `src/provider-web.ts`, infra in `src/infra`, media pipeline in `src/media`).
- Tests: colocated `*.test.ts`.
- Docs: `docs/` (images, queue, Pi config). Built output lives in `dist/`.
- Plugins/extensions: live under `extensions/*` (workspace packages). Keep plugin-only deps in the extension `package.json`; do not add them to the root `package.json` unless core uses them.
- Plugins: install runs `npm install --omit=dev` in plugin dir; runtime deps must live in `dependencies`. Avoid `workspace:*` in `dependencies` (npm install breaks); put `genosos` in `devDependencies` or `peerDependencies` instead (runtime resolves `genosos/plugin-sdk` via jiti alias).
- Installers served from `https://genosos.ai/*`: live in the sibling repo `../genosos.ai` (`public/install.sh`, `public/install-cli.sh`, `public/install.ps1`).
- Messaging channels: always consider **all** built-in + extension channels when refactoring shared logic (routing, allowlists, pairing, command gating, onboarding, docs).
  - Core channel docs: `docs/channels/`
  - Core channel code: `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web` (WhatsApp web), `src/channels`, `src/routing`
  - Extensions (channel plugins): `extensions/*` (e.g. `extensions/msteams`, `extensions/matrix`, `extensions/zalo`, `extensions/zalouser`, `extensions/voice-call`)
- When adding channels/extensions/apps/docs, update `.github/labeler.yml` and create matching GitHub labels (use existing channel/extension label colors).

## Docs Linking (Mintlify)

- Docs are hosted on Mintlify (docs.genos.ai).
- Internal doc links in `docs/**/*.md`: root-relative, no `.md`/`.mdx` (example: `[Config](/configuration)`).
- When working with documentation, read the mintlify skill.
- Section cross-references: use anchors on root-relative paths (example: `[Hooks](/configuration#hooks)`).
- Doc headings and anchors: avoid em dashes and apostrophes in headings because they break Mintlify anchor links.
- When Peter asks for links, reply with full `https://docs.genos.ai/...` URLs (not root-relative).
- When you touch docs, end the reply with the `https://docs.genos.ai/...` URLs you referenced.
- README (GitHub): keep absolute docs URLs (`https://docs.genos.ai/...`) so links work on GitHub.
- Docs content must be generic: no personal device names/hostnames/paths; use placeholders like `user@gateway-host` and “gateway host”.

## Docs i18n (zh-CN)

- `docs/zh-CN/**` is generated; do not edit unless the user explicitly asks.
- Pipeline: update English docs → adjust glossary (`docs/.i18n/glossary.zh-CN.json`) → run `scripts/docs-i18n` → apply targeted fixes only if instructed.
- Translation memory: `docs/.i18n/zh-CN.tm.jsonl` (generated).
- See `docs/.i18n/README.md`.
- The pipeline can be slow/inefficient; if it’s dragging, ping @jospalmbier on Discord instead of hacking around it.

## exe.dev VM ops (general)

- Access: stable path is `ssh exe.dev` then `ssh vm-name` (assume SSH key already set).
- SSH flaky: use exe.dev web terminal or Shelley (web agent); keep a tmux session for long ops.
- Update: `sudo npm i -g genosos@latest` (global install needs root on `/usr/lib/node_modules`).
- Config: use `genosos config set ...`; ensure `gateway.mode=local` is set.
- Discord: store raw token only (no `DISCORD_BOT_TOKEN=` prefix).
- Restart: stop old gateway and run:
  `pkill -9 -f genosos-gateway || true; nohup genosos gateway run --bind loopback --port 18789 --force > /tmp/genosos-gateway.log 2>&1 &`
- Verify: `genosos channels status --probe`, `ss -ltnp | rg 18789`, `tail -n 120 /tmp/genosos-gateway.log`.

## Build, Test, and Development Commands

- Runtime baseline: Node **22+** (keep Node + Bun paths working).
- Install deps: `pnpm install`
- If deps are missing (for example `node_modules` missing, `vitest not found`, or `command not found`), run the repo’s package-manager install command (prefer lockfile/README-defined PM), then rerun the exact requested command once. Apply this to test/build/lint/typecheck/dev commands; if retry still fails, report the command and first actionable error.
- Pre-commit hooks: `prek install` (runs same checks as CI)
- Also supported: `bun install` (keep `pnpm-lock.yaml` + Bun patching in sync when touching deps/patches).
- Prefer Bun for TypeScript execution (scripts, dev, tests): `bun <file.ts>` / `bunx <tool>`.
- Run CLI in dev: `pnpm genosos ...` (bun) or `pnpm dev`.
- Node remains supported for running built output (`dist/*`) and production installs.
- Mac packaging (dev): `scripts/package-mac-app.sh` defaults to current arch. Release checklist: `docs/platforms/mac/release.md`.
- Type-check/build: `pnpm build`
- TypeScript checks: `pnpm tsgo`
- Lint/format: `pnpm check`
- Format check: `pnpm format` (oxfmt --check)
- Format fix: `pnpm format:fix` (oxfmt --write)
- Tests: `pnpm test` (vitest); coverage: `pnpm test:coverage`

## Coding Style & Naming Conventions

- Language: TypeScript (ESM). Prefer strict typing; avoid `any`.
- Formatting/linting via Oxlint and Oxfmt; run `pnpm check` before commits.
- Never add `@ts-nocheck` and do not disable `no-explicit-any`; fix root causes and update Oxlint/Oxfmt config only when required.
- Never share class behavior via prototype mutation (`applyPrototypeMixins`, `Object.defineProperty` on `.prototype`, or exporting `Class.prototype` for merges). Use explicit inheritance/composition (`A extends B extends C`) or helper composition so TypeScript can typecheck.
- If this pattern is needed, stop and get explicit approval before shipping; default behavior is to split/refactor into an explicit class hierarchy and keep members strongly typed.
- In tests, prefer per-instance stubs over prototype mutation (`SomeClass.prototype.method = ...`) unless a test explicitly documents why prototype-level patching is required.
- Add brief code comments for tricky or non-obvious logic.
- Keep files concise; extract helpers instead of “V2” copies. Use existing patterns for CLI options and dependency injection via `createDefaultDeps`.
- Aim to keep files under ~700 LOC; guideline only (not a hard guardrail). Split/refactor when it improves clarity or testability.
- Naming: use **GenosOS** for product/app/docs headings; use `genosos` for CLI command, package/binary, paths, and config keys.

## Release Channels (Naming)

- stable: tagged releases only (e.g. `vYYYY.M.D`), npm dist-tag `latest`.
- beta: prerelease tags `vYYYY.M.D-beta.N`, npm dist-tag `beta` (may ship without macOS app).
- dev: moving head on `main` (no tag; git checkout main).

## Testing Guidelines

- Framework: Vitest with V8 coverage thresholds (70% lines/branches/functions/statements).
- Naming: match source names with `*.test.ts`; e2e in `*.e2e.test.ts`.
- Run `pnpm test` (or `pnpm test:coverage`) before pushing when you touch logic.
- Do not set test workers above 16; tried already.
- Live tests (real keys): `GENOS_LIVE_TEST=1 pnpm test:live` (GenosOS-only) or `LIVE=1 pnpm test:live` (includes provider live tests). Docker: `pnpm test:docker:live-models`, `pnpm test:docker:live-gateway`. Onboarding Docker E2E: `pnpm test:docker:onboard`.
- Full kit + what’s covered: `docs/testing.md`.
- Changelog: user-facing changes only; no internal/meta notes (version alignment, appcast reminders, release process).
- Pure test additions/fixes generally do **not** need a changelog entry unless they alter user-facing behavior or the user asks for one.
- Mobile: before using a simulator, check for connected real devices (iOS + Android) and prefer them when available.

## Commit & Pull Request Guidelines

**Full maintainer PR workflow (optional):** If you want the repo's end-to-end maintainer workflow (triage order, quality bar, rebase rules, commit/changelog conventions, co-contributor policy, and the `review-pr` > `prepare-pr` > `merge-pr` pipeline), see `.agents/skills/PR_WORKFLOW.md`. Maintainers may use other workflows; when a maintainer specifies a workflow, follow that. If no workflow is specified, default to PR_WORKFLOW.

- Create commits with `scripts/committer "<msg>" <file...>`; avoid manual `git add`/`git commit` so staging stays scoped.
- Follow concise, action-oriented commit messages (e.g., `CLI: add verbose flag to send`).
- Group related changes; avoid bundling unrelated refactors.
- PR submission template (canonical): `.github/pull_request_template.md`
- Issue submission templates (canonical): `.github/ISSUE_TEMPLATE/`

## Shorthand Commands

- `sync`: if working tree is dirty, commit all changes (pick a sensible Conventional Commit message), then `git pull --rebase`; if rebase conflicts and cannot resolve, stop; otherwise `git push`.

## Git Notes

- If `git branch -d/-D <branch>` is policy-blocked, delete the local ref directly: `git update-ref -d refs/heads/<branch>`.
- Bulk PR close/reopen safety: if a close action would affect more than 5 PRs, first ask for explicit user confirmation with the exact PR count and target scope/query.

## Security & Configuration Tips

- Web provider stores creds at `~/.genosv1/credentials/`; rerun `genosos login` if logged out.
- Pi sessions live under `~/.genosv1/sessions/` by default; the base directory is not configurable.
- Environment variables: see `~/.profile`.
- Never commit or publish real phone numbers, videos, or live configuration values. Use obviously fake placeholders in docs, tests, and examples.
- Release flow: always read `docs/reference/RELEASING.md` and `docs/platforms/mac/release.md` before any release work; do not ask routine questions once those docs answer them.

## GHSA (Repo Advisory) Patch/Publish

- Fetch: `gh api /repos/genosos/genosos/security-advisories/<GHSA>`
- Latest npm: `npm view genosos version --userconfig "$(mktemp)"`
- Private fork PRs must be closed:
  `fork=$(gh api /repos/genosos/genosos/security-advisories/<GHSA> | jq -r .private_fork.full_name)`
  `gh pr list -R "$fork" --state open` (must be empty)
- Description newline footgun: write Markdown via heredoc to `/tmp/ghsa.desc.md` (no `"\\n"` strings)
- Build patch JSON via jq: `jq -n --rawfile desc /tmp/ghsa.desc.md '{summary,severity,description:$desc,vulnerabilities:[...]}' > /tmp/ghsa.patch.json`
- Patch + publish: `gh api -X PATCH /repos/genosos/genosos/security-advisories/<GHSA> --input /tmp/ghsa.patch.json` (publish = include `"state":"published"`; no `/publish` endpoint)
- If publish fails (HTTP 422): missing `severity`/`description`/`vulnerabilities[]`, or private fork has open PRs
- Verify: re-fetch; ensure `state=published`, `published_at` set; `jq -r .description | rg '\\\\n'` returns nothing

## Troubleshooting

- Rebrand/migration issues or legacy config/service warnings: run `genosos doctor` (see `docs/gateway/doctor.md`).

## Agent-Specific Notes

- **Encrypted files:** never `cat`/`Read` files under `~/.genosv1/` directly; use `genosos vault cat <path>` to decrypt and read vault-protected files (pipe-safe, no disk write, passes through plaintext unchanged).
- Vocabulary: "makeup" = "mac app".
- Never edit `node_modules` (global/Homebrew/npm/git installs too). Updates overwrite. Skill notes go in `tools.md` or `AGENTS.md`.
- When adding a new `AGENTS.md` anywhere in the repo, also add a `CLAUDE.md` symlink pointing to it (example: `ln -s AGENTS.md CLAUDE.md`).
- Signal: "update fly" => `fly ssh console -a flawd-bot -C "bash -lc 'cd /data/clawd/genosos && git pull --rebase origin main'"` then `fly machines restart e825232f34d058 -a flawd-bot`.
- When working on a GitHub Issue or PR, print the full URL at the end of the task.
- When answering questions, respond with high-confidence answers only: verify in code; do not guess.
- Never update the Carbon dependency.
- Any dependency with `pnpm.patchedDependencies` must use an exact version (no `^`/`~`).
- Patching dependencies (pnpm patches, overrides, or vendored changes) requires explicit approval; do not do this by default.
- CLI progress: use `src/cli/progress.ts` (`osc-progress` + `@clack/prompts` spinner); don’t hand-roll spinners/bars.
- Status output: keep tables + ANSI-safe wrapping (`src/terminal/table.ts`); `status --all` = read-only/pasteable, `status --deep` = probes.
- Gateway currently runs only as the menubar app; there is no separate LaunchAgent/helper label installed. Restart via the GenosOS Mac app or `scripts/restart-mac.sh`; to verify/kill use `launchctl print gui/$UID | grep genosos` rather than assuming a fixed label. **When debugging on macOS, start/stop the gateway via the app, not ad-hoc tmux sessions; kill any temporary tunnels before handoff.**
- macOS logs: use `./scripts/clawlog.sh` to query unified logs for the GenosOS subsystem; it supports follow/tail/category filters and expects passwordless sudo for `/usr/bin/log`.
- If shared guardrails are available locally, review them; otherwise follow this repo's guidance.
- SwiftUI state management (iOS/macOS): prefer the `Observation` framework (`@Observable`, `@Bindable`) over `ObservableObject`/`@StateObject`; don’t introduce new `ObservableObject` unless required for compatibility, and migrate existing usages when touching related code.
- Connection providers: when adding a new connection, update every UI surface and docs (macOS app, web UI, mobile if applicable, onboarding/overview docs) and add matching status + configuration forms so provider lists and settings stay in sync.
- Version locations: `package.json` (CLI), `apps/android/app/build.gradle.kts` (versionName/versionCode), `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist` (CFBundleShortVersionString/CFBundleVersion), `apps/macos/Sources/GenosOS/Resources/Info.plist` (CFBundleShortVersionString/CFBundleVersion), `docs/install/updating.md` (pinned npm version), `docs/platforms/mac/release.md` (APP_VERSION/APP_BUILD examples), Peekaboo Xcode projects/Info.plists (MARKETING_VERSION/CURRENT_PROJECT_VERSION).
- "Bump version everywhere" means all version locations above **except** `appcast.xml` (only touch appcast when cutting a new macOS Sparkle release).
- **Restart apps:** “restart iOS/Android apps” means rebuild (recompile/install) and relaunch, not just kill/launch.
- **Device checks:** before testing, verify connected real devices (iOS/Android) before reaching for simulators/emulators.
- iOS Team ID lookup: `security find-identity -p codesigning -v` → use Apple Development (…) TEAMID. Fallback: `defaults read com.apple.dt.Xcode IDEProvisioningTeamIdentifiers`.
- Release signing/notary keys are managed outside the repo; follow internal release docs.
- Notary auth env vars (`APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_API_KEY_P8`) are expected in your environment (per internal release docs).
- **Multi-agent safety:** do **not** create/apply/drop `git stash` entries unless explicitly requested (this includes `git pull --rebase --autostash`). Assume other agents may be working; keep unrelated WIP untouched and avoid cross-cutting state changes.
- **Multi-agent safety:** when the user says "push", you may `git pull --rebase` to integrate latest changes (never discard other agents' work). When the user says "commit", scope to your changes only. When the user says "commit all", commit everything in grouped chunks.
- **Multi-agent safety:** do **not** create/remove/modify `git worktree` checkouts (or edit `.worktrees/*`) unless explicitly requested.
- **Multi-agent safety:** do **not** switch branches / check out a different branch unless explicitly requested.
- **Multi-agent safety:** running multiple agents is OK as long as each agent has its own session.
- **Multi-agent safety:** when you see unrecognized files, keep going; focus on your changes and commit only those.
- Lint/format churn:
  - If staged+unstaged diffs are formatting-only, auto-resolve without asking.
  - If commit/push already requested, auto-stage and include formatting-only follow-ups in the same commit (or a tiny follow-up commit if needed), no extra confirmation.
  - Only ask when changes are semantic (logic/data/behavior).
- Lobster seam: use the shared CLI palette in `src/terminal/palette.ts` (no hardcoded colors); apply palette to onboarding/config prompts and other TTY UI output as needed.
- **Multi-agent safety:** focus reports on your edits; avoid guard-rail disclaimers unless truly blocked; when multiple agents touch the same file, continue if safe; end with a brief “other files present” note only if relevant.
- Bug investigations: read source code of relevant npm dependencies and all related local code before concluding; aim for high-confidence root cause.
- Code style: add brief comments for tricky logic; keep files under ~500 LOC when feasible (split/refactor as needed).
- Tool schema guardrails (google-antigravity): avoid `Type.Union` in tool input schemas; no `anyOf`/`oneOf`/`allOf`. Use `stringEnum`/`optionalStringEnum` (Type.Unsafe enum) for string lists, and `Type.Optional(...)` instead of `... | null`. Keep top-level tool schema as `type: "object"` with `properties`.
- Tool schema guardrails: avoid raw `format` property names in tool schemas; some validators treat `format` as a reserved keyword and reject the schema.
- When asked to open a “session” file, open the Pi session logs under `~/.genosv1/agents/<agentId>/sessions/*.jsonl` (use the `agent=<id>` value in the Runtime line of the system prompt; newest unless a specific ID is given), not the default `sessions.json`. If logs are needed from another machine, SSH via Tailscale and read the same path there.
- Do not rebuild the macOS app over SSH; rebuilds must be run directly on the Mac.
- Never send streaming/partial replies to external messaging surfaces (WhatsApp, Telegram); only final replies should be delivered there. Streaming/tool events may still go to internal UIs/control channel.
- Voice wake forwarding tips:
  - Command template should stay `genosos-mac agent --message "${text}" --thinking low`; `VoiceWakeForwarder` already shell-escapes `${text}`. Don’t add extra quotes.
  - launchd PATH is minimal; ensure the app’s launch agent PATH includes standard system paths plus your pnpm bin (typically `$HOME/Library/pnpm`) so `pnpm`/`genosos` binaries resolve when invoked via `genosos-mac`.
- For manual `genosos message send` messages that include `!`, use the heredoc pattern noted below to avoid the Bash tool’s escaping.
- Release guardrails: do not change version numbers without operator’s explicit consent; always ask permission before running any npm publish/release step.

## NPM + 1Password (publish/verify)

- Use the 1password skill; all `op` commands must run inside a fresh tmux session.
- Sign in: `eval "$(op signin --account my.1password.com)"` (app unlocked + integration on).
- OTP: `op read 'op://Private/Npmjs/one-time password?attribute=otp'`.
- Publish: `npm publish --access public --otp="<otp>"` (run from the package dir).
- Verify without local npmrc side effects: `npm view <pkg> version --userconfig "$(mktemp)"`.
- Kill the tmux session after publish.

## Plugin Release Fast Path (no core `genosos` publish)

- Release only already-on-npm plugins. Source list is in `docs/reference/RELEASING.md` under "Current npm plugin list".
- Run all CLI `op` calls and `npm publish` inside tmux to avoid hangs/interruption:
  - `tmux new -d -s release-plugins-$(date +%Y%m%d-%H%M%S)`
  - `eval "$(op signin --account my.1password.com)"`
- 1Password helpers:
  - password used by `npm login`:
    `op item get Npmjs --format=json | jq -r '.fields[] | select(.id=="password").value'`
  - OTP:
    `op read 'op://Private/Npmjs/one-time password?attribute=otp'`
- Fast publish loop (local helper script in `/tmp` is fine; keep repo clean):
  - compare local plugin `version` to `npm view <name> version`
  - only run `npm publish --access public --otp="<otp>"` when versions differ
  - skip if package is missing on npm or version already matches.
- Keep `genosos` untouched: never run publish from repo root unless explicitly requested.
- Post-check for each release:
  - per-plugin: `npm view @genosos/<name> version --userconfig "$(mktemp)"` should be `2026.2.17`
  - core guard: `npm view genosos version --userconfig "$(mktemp)"` should stay at previous version unless explicitly requested.

## Changelog Release Notes

- When cutting a mac release with beta GitHub prerelease:
  - Tag `vYYYY.M.D-beta.N` from the release commit (example: `v2026.2.15-beta.1`).
  - Create prerelease with title `genosos YYYY.M.D-beta.N`.
  - Use release notes from `CHANGELOG.md` version section (`Changes` + `Fixes`, no title duplicate).
  - Attach at least `GenosOS-YYYY.M.D.zip` and `GenosOS-YYYY.M.D.dSYM.zip`; include `.dmg` if available.

- Keep top version entries in `CHANGELOG.md` sorted by impact:
  - `### Changes` first.
  - `### Fixes` deduped and ranked with user-facing fixes first.
- Before tagging/publishing, run:
  - `node --import tsx scripts/release-check.ts`
  - `pnpm release:check`
  - `pnpm test:install:smoke` or `GENOS_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke` for non-root smoke path.
