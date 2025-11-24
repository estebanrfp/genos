---
summary: "CLI reference for `genosos voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `genosos voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
genosos voicecall status --call-id <id>
genosos voicecall call --to "+15555550123" --message "Hello" --mode notify
genosos voicecall continue --call-id <id> --message "Any questions?"
genosos voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
genosos voicecall expose --mode serve
genosos voicecall expose --mode funnel
genosos voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
