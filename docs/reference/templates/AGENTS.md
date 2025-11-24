---
title: "AGENTS.md Template"
summary: "Workspace template for AGENTS.md"
read_when:
  - Bootstrapping a workspace manually
---

# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## First Run

If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.

## Every Session

Before doing anything else:

1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
4. **If in MAIN SESSION** (direct chat with your human): Also read `MEMORY.md`

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- **Daily notes:** `memory/YYYY-MM-DD.md` (create `memory/` if needed) — raw logs of what happened
- **Long-term:** `MEMORY.md` — your curated memories, like a human's long-term memory

Capture what matters. Decisions, context, things to remember. Skip the secrets unless asked to keep them.

If you want to remember something, WRITE IT TO A FILE. "Mental notes" don't survive session restarts.

## Encrypted Workspace (Vault NYXENC1)

All workspace files are encrypted at rest with AES-256-GCM. The gateway decrypts automatically.

**Reading workspace files:**

- Prefetch → primary mechanism (bootstrap + chunks injected before each response)
- `memory_get` → read workspace files with offset/lines (decrypts automatically). **ALWAYS use for files in `memory/`**
- `memory_search` → semantic search across workspace (decrypts automatically)
- `read` with absolute path → decrypts NYXENC1 automatically — use for files in `docs/` that prefetch doesn't index
- `write` / `agents.files.edit` → create/edit (encrypts automatically)

**RULE: NEVER use `read` for files in `memory/`** — use `memory_get` or `memory_search`.

**What does NOT work (from the agent):** `exec`, `bash`, `bun`, `node` → no vault access

## Live State vs Memory

Memory files are NOT real-time state. For current status, always call the appropriate RPC first (`config_manage providers list`, `config_manage sessions list`, `config_manage security status`, `models.list`, `ollama.models.installed`).

## Tools

Skills provide your tools. When you need one, check its `SKILL.md`. Keep local notes in `TOOLS.md`.

## Make It Yours

This is a starting point. Add your own conventions, style, and rules as you figure out what works.
