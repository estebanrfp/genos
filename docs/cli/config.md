---
summary: "CLI reference for `genosos config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `genosos config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `genosos configure`).

## Examples

```bash
genosos config get browser.executablePath
genosos config set browser.executablePath "/usr/bin/google-chrome"
genosos config set agents.defaults.heartbeat.every "2h"
genosos config set agents.list[0].tools.exec.node "node-id-or-name"
genosos config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
genosos config get agents.defaults.workspace
genosos config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
genosos config get agents.list
genosos config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
genosos config set agents.defaults.heartbeat.every "0m"
genosos config set gateway.port 19001 --json
genosos config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
