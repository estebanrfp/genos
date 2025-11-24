---
summary: "CLI reference for `genosos logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `genosos logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
genosos logs
genosos logs --follow
genosos logs --json
genosos logs --limit 500
genosos logs --local-time
genosos logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
