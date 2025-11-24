---
name: boot-md
description: "Run BOOT.md on gateway startup"
homepage: https://docs.genos.ai/automation/hooks#boot-md
metadata:
  {
    "genosos":
      {
        "emoji": "🚀",
        "events": ["gateway:startup"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with GenosOS" }],
      },
  }
---

# Boot Checklist Hook

Runs `BOOT.md` at gateway startup for each configured agent scope, if the file exists in that
agent's resolved workspace.
