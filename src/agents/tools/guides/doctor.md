---
title: Doctor — System Health
action: doctor
loadWhen:
  - config_manage doctor
  - system health
  - diagnose
  - health check
---

# Doctor — Autonomous System Health

## What It Does

Runs a comprehensive health check across 7 areas, auto-fixes what it can, and reports what needs attention.

## Areas Checked

| Area      | Auto-fixes                                                    | Reports                                                   |
| --------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| State     | Dir creation, permissions (chmod 700/600), stale lock cleanup | —                                                         |
| Config    | —                                                             | Missing gateway.mode, auth, exposed binding               |
| Gateway   | —                                                             | Health HTTP check, unreachable diagnosis                  |
| Security  | —                                                             | Vault status, fortress, WebAuthn, DM policies, full audit |
| Memory    | —                                                             | Search provider, embedder availability                    |
| Workspace | —                                                             | Core files (AGENTS.md, SOUL.md, etc.), skills count       |
| Channels  | —                                                             | Configured channels count, connectivity                   |

## Usage

```
config_manage doctor
```

No sub-actions. Runs everything, returns structured report.

## When to Run

**On demand:** User asks about system health, security status, or "is everything OK?"
**Proactively:** Once daily during heartbeats — run silently, only report if critical/warning findings exist. Track last run in `memory/heartbeat-state.json` under `lastChecks.doctor`.
**After changes:** After connecting a new channel, creating an agent, or modifying security config.
**Post-restart:** After gateway restart to verify everything came back healthy.

## Reading Results

The report contains:

- `summary` — counts: critical, warnings, info, ok, fixed
- `checks[]` — array of check results, each with `name`, `label`, `findings[]`
- Each finding: `id`, `severity`, `title`, `detail`, `fixed`, optional `remediation`

## Presentation Rules

1. Start with summary line: "N critical, N warnings, N auto-fixed"
2. If all OK: brief confirmation, no details needed
3. If findings with `remediation`: guide the user through each fix
4. Never dump raw JSON — interpret and present conversationally
5. For critical findings: address immediately with clear instructions
6. For warnings: explain and offer to fix if possible
7. For info: mention briefly, don't alarm

## Examples

**All healthy:**

> System health check: 0 critical, 0 warnings, 7 checks passed. Everything looks good.

**With issues:**

> System health: 1 critical, 2 warnings, 3 auto-fixed.
>
> **Critical:** Gateway not responding — start it with `bun genosos.mjs gateway`
>
> **Warnings:**
>
> - Gateway auth not configured — I can set up a token for you
> - WhatsApp DM open with wildcard — consider restricting to known contacts
>
> **Auto-fixed:** State permissions tightened, 2 stale locks cleaned.
