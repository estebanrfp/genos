# GenosOS Codebase Patterns

**Always reuse existing code - no redundancy!**

## Tech Stack

- **Runtime**: Bun >= 1.2 (NOT Node.js)
- **Language**: Pure JavaScript (ES2024, ESM) — TypeScript fully eradicated
- **Package Manager**: pnpm (keep `pnpm-lock.yaml` in sync) — Bun only for runtime/bundling
- **Lint/Format**: Oxlint, Oxfmt (`pnpm check`)
- **Tests**: Vitest with V8 coverage
- **UI Build**: Vite (ui/) — Lit 3 components → dist/control-ui/
- **Entry Point**: `genosos.mjs` → `src/entry.js`

## Anti-Redundancy Rules

- Avoid files that just re-export from another file. Import directly from the original source.
- If a function already exists, import it - do NOT create a duplicate in another file.
- Before creating any formatter, utility, or helper, search for existing implementations first.

## Key Architecture

### Core Server (`src/`)

- Entry: `src/entry.js` → gateway, CLI, doctor
- Agents: `src/agents/` — system prompt, model routing, tier profiles, auto-config
- Tools: `src/agents/tools/` — config_manage (164 blueprints, 15 TOON guides)
- Security: NYXENC1 vault (AES-256-GCM), WebAuthn, Fortress Mode

### Control UI (`ui/`)

- Vite + Lit 3 web components
- CSS architecture: base → layout → components → modals → agents → chat → config → security
- Design tokens in `ui/src/styles/base.css`
- All styling in CSS classes — no inline styles

### Extensions (`extensions/`)

- 28 active channel/infrastructure extensions
- Each extension is a self-contained package

## Import Conventions

- Use `.js` extension for all imports (ESM)
- Direct imports only - no re-export wrapper files
- No TypeScript, no `import type` — pure JavaScript

## Code Quality

- Pure ES2024 JavaScript, async/await, optional chaining, nullish coalescing
- Prefer composition and factory functions over classes
- Keep files under ~700 LOC - extract helpers when larger
- Colocated tests: `*.test.js` next to source files
- Run `pnpm check` before commits (oxlint + oxfmt)

## Stack & Commands

- **Package manager**: pnpm (`pnpm install`)
- **Run gateway**: `bun genosos.mjs gateway`
- **UI build**: `cd ui && npx vite build`
- **Lint/format**: `pnpm check`
- **Tests**: `pnpm test`
- **Doctor**: `bun genosos.mjs doctor`
