---
summary: "CLI reference for `genosos reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `genosos reset`

Reset local config/state (keeps the CLI installed).

```bash
genosos reset
genosos reset --dry-run
genosos reset --scope config+creds+sessions --yes --non-interactive
```
