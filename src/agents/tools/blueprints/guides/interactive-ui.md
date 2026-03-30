Interactive UI Components — nyx-ui:
Summary: Present structured data in chat via nyx-ui fenced code blocks containing valid JSON. Control UI renders as interactive inline components. CLI users see JSON (text summary provides readable fallback).

Rules:

1. Always include a text summary BEFORE the nyx-ui block — the block is enhancement, not replacement
2. One component per response, max ~20 items per component
3. Invalid JSON falls back to normal code block — always validate output
4. Dot colors: connected/ok → green, warning/degraded → yellow, error → red, disabled/inactive/unconfigured → gray
5. Action types:
   · chat — prefills compose textarea with command (user confirms by Enter). Use for config_manage commands.
   · rpc — calls server method directly. Use only for modals (channel setup) or stateless operations.

status-grid — Cards with semaphore dots:
Use for: channels status, providers status.

```json
{
  "component": "status-grid",
  "title": "Channels",
  "items": [
    {
      "label": "WhatsApp",
      "dot": "green",
      "status": "Connected",
      "actions": [
        { "label": "Disable", "chat": "config_manage channels whatsapp disable" },
        { "label": "Setup", "rpc": "channel.setup.initiate", "value": { "channel": "whatsapp" } }
      ]
    }
  ]
}
```

Fields: component (required), title (optional), items[].label (required), items[].dot (green|yellow|red|gray), items[].status, items[].actions[]

stat-bars — Horizontal bar chart:
Use for: usage summary, token consumption.

```json
{
  "component": "stat-bars",
  "title": "Usage (30d)",
  "items": [{ "label": "Anthropic", "value": 82, "max": 100, "detail": "$12.40" }]
}
```

Fields: component (required), items[].label (required), items[].value (required), items[].max (default 100), items[].detail

data-table — Table with optional row actions:
Use for: skills list, logs snapshot.

```json
{
  "component": "data-table",
  "title": "Skills",
  "columns": ["Name", "Status"],
  "rows": [
    {
      "cells": ["memory_search", "Enabled"],
      "dot": "green",
      "actions": [
        { "label": "Disable", "chat": "config_manage skills disable value='memory_search'" }
      ]
    }
  ]
}
```

Fields: component (required), columns (optional), rows[].cells (required), rows[].dot, rows[].actions[]

key-value — Detail pairs:
Use for: single item detail, quick info.

```json
{
  "component": "key-value",
  "title": "WhatsApp",
  "pairs": [
    { "key": "Status", "value": "Connected", "dot": "green" },
    { "key": "Last message", "value": "2 min ago" }
  ]
}
```

Fields: component (required), pairs[].key (required), pairs[].value (required), pairs[].dot

chart — Animated charts (Frappe Charts):
Use for: trends, distribution, comparison. Types: bar, line, pie, donut, percentage, heatmap.
Structure: { component: "chart", chartType: "bar|line|pie|donut|percentage|heatmap", title?, data: { labels: [], datasets: [{ name?, values: [] }] } }
Optional: height (default 220), colors [], valuesOverPoints, lineOptions.regionFill (0|1), barOptions.spaceRatio (0-1)
Multiple datasets supported (e.g. two lines comparing providers). Pie/donut/percentage use single dataset.

Action Button Schema:
· Chat action: {"label":"Button Text","chat":"config_manage ..."}
· RPC action: {"label":"Setup","rpc":"channel.setup.initiate","value":{"channel":"whatsapp"}}

Channel Status Dot Logic:
· connected && running → green
· running && !connected → yellow
· lastError → red
· enabled === false → gray
· !configured → gray
· configured && !running → gray
