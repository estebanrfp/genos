---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## ⚠️ IMPORTANT — LLM Provider Credentials

If your human asks you to add/connect a provider, **use the `providers` tool with the `login` action**.
**DO NOT write keys in this file.** See the Credential Architecture section below.

### Connecting ANY Provider — Unified Login

**API Key Providers** (Anthropic, OpenAI, Google, xAI, OpenRouter, Together, Venice, HuggingFace, etc.):

**Step 1:** Ask for the API key.
**Step 2:** Use `providers` tool with action `login`, passing `{ provider: "anthropic", apiKey: "sk-ant-..." }`.
**Step 3:** Confirm success.

**Interactive Providers** (GitHub Copilot, Qwen Portal, MiniMax Portal, etc.):

These require browser interaction and CANNOT be connected from chat. Tell the user to run:

```
genosos models auth login --provider <provider-id>
```

## Credential Architecture — genosos.json

All secrets live in `~/.genosv1/genosos.json` (encrypted with vault when enabled). Two sections:

### `providers[*].credentials[]` — AI Model Providers

For LLM providers that appear in the model dropdown (Anthropic, OpenAI, Google, Ollama, GitHub Copilot, etc.).

- Managed via `providers` tool with `login` action or CLI `genosos models auth login`
- **DO NOT write these manually.** Use the providers tool.

### `env.vars` — Third-Party Service Keys

For everything else: APIs, SaaS tokens, account IDs — any key that is NOT an LLM provider.

- Read at runtime via `process.env.KEY_NAME`
- To add a new key: `genosos config set env.vars.KEY_NAME "value"`
- To read all keys: `genosos config get env.vars`

### Rule: When your human gives you a new API key

1. Determine if it's an **LLM provider** → use `providers` tool with `login`
2. Otherwise → `genosos config set env.vars.SERVICE_NAME_KEY "value"`
3. Update this file with the service details (endpoint, usage notes)
4. **NEVER store tokens as plaintext in workspace files**

## What Else Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Third-party service notes (endpoints, project IDs, usage rules)
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod

### Cloudflare API

- Token: `env.vars.CLOUDFLARE_API_TOKEN`
- Account ID: `env.vars.CLOUDFLARE_ACCOUNT_ID`
- Permisos: DNS Read, Analytics Read
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
