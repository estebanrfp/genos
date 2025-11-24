---
summary: "Context window + compaction: how GenosOS keeps sessions under model limits"
read_when:
  - You want to understand auto-compaction and /compact
  - You are debugging long sessions hitting context limits
title: "Compaction"
---

# Context Window & Compaction

Every model has a **context window** (max tokens it can see). Long-running chats accumulate messages and tool results; once the window is tight, GenosOS **compacts** older history to stay within limits.

## What compaction is

Compaction **summarizes older conversation** into a compact summary entry and keeps recent messages intact. The summary is stored in the session history, so future requests use:

- The compaction summary
- Recent messages after the compaction point

Compaction **persists** in the session’s JSONL history.

## Configuration

Use the `agents.defaults.compaction` setting in your `genosos.json` to configure compaction behavior (mode, target tokens, etc.).

## Auto-compaction (default on)

When a session nears or exceeds the model’s context window, GenosOS triggers auto-compaction and may retry the original request using the compacted context.

You’ll see:

- `🧹 Auto-compaction complete` in verbose mode
- `/status` showing `🧹 Compactions: <count>`

Before compaction, GenosOS can run a **silent memory flush** turn to store
durable notes to disk. See [Memory](/concepts/memory) for details and config.

## Structured compaction instructions

By default, GenosOS passes a **deterministic 11-section template** to `session.compact()` so
the compaction summary is structured and predictable — preventing personality drift, lost
constraints, and cold re-entry after long sessions.

**11 sections:**

_Technical (always relevant):_

- `Facts & Decisions` — concrete decisions made, numbered
- `Current State` — what is deployed, last action, what is pending
- `Active Constraints` — rules that must survive the compaction
- `Actions Taken` — one-line log per operation (`verb: target`)

_Technical (optional — omitted if not applicable):_

- `Open Questions` — unresolved decisions or questions raised
- `User Preferences (this session)` — tastes and feedback expressed
- `Errors & Lessons` — what was tried and failed, with reason
- `Next Steps (agreed)` — actions explicitly committed to

_Emotional (optional — keeps Nyx from re-entering cold):_

- `Session Mood` — tone and energy level if noticeable
- `Connection Moments` — warmth, humor or rapport worth preserving
- `How to Re-enter` — how to pick up naturally; tone and what NOT to do

To opt out: `agents.defaults.compaction.structured: false`. When you supply custom
instructions with `/compact: <text>`, your text takes precedence over the template.

## Manual compaction

Use `/compact` (optionally with instructions) to force a compaction pass:

```
/compact Focus on decisions and open questions
```

## Context window source

Context window is model-specific. GenosOS uses the model definition from the configured provider catalog to determine limits.

## Compaction vs pruning

- **Compaction**: summarises and **persists** in JSONL.
- **Session pruning**: trims old **tool results** only, **in-memory**, per request.

See [/concepts/session-pruning](/concepts/session-pruning) for pruning details.

## Post-compaction context re-injection

After every compaction (auto or manual), GenosOS automatically injects a **critical-rules
system event** so the agent doesn't lose its grounding. The event contains:

- `## Session Startup` section from `AGENTS.md` — startup sequence reminder
- `## Red Lines` section from `AGENTS.md` — absolute prohibitions
- Full content of `SECURITY.md` (if present) — anti-prompt-injection rules and identity
  verification guidelines

This happens without any action from the agent or the user. The injected content is capped
at **4 000 characters** (truncated with `…[truncated]…` if over the limit).

To customise what is re-injected, edit the relevant sections in your workspace
`AGENTS.md` or `SECURITY.md`. See [Agent Workspace](/concepts/agent-workspace) for the
full workspace file map.

## Tips

- Use `/compact` when sessions feel stale or context is bloated.
- Large tool outputs are already truncated; pruning can further reduce tool-result buildup.
- If you need a fresh slate, `/new` or `/reset` starts a new session id.
