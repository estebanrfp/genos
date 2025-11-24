---
summary: "CLI reference for `genosos agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `genosos agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
genosos agents list
genosos agents add work --workspace ~/.genosv1/workspace-work
genosos agents set-identity --workspace ~/.genosv1/workspace --from-identity
genosos agents set-identity --agent main --avatar avatars/genosos.png
genosos agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.genosv1/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
genosos agents set-identity --workspace ~/.genosv1/workspace --from-identity
```

Override fields explicitly:

```bash
genosos agents set-identity --agent main --name "GenosOS" --emoji "🦞" --avatar avatars/genosos.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "GenosOS",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/genosos.png",
        },
      },
    ],
  },
}
```
