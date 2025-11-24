---
summary: "Control UI security: tab lock, biometric gates, and why sensitive sections are protected"
read_when:
  - You need to explain why Config, Security, or Agents tabs require Touch ID
  - You want to understand the layered defense model of the Control UI
  - You are auditing the UI access control model
title: "Control UI Security"
---

# Control UI Security

GenosOS's Control UI exposes powerful capabilities: agent configuration,
workspace file editing, API credentials, vault settings, and biometric
credentials. A compromised UI session — through an unattended browser tab,
a shared screen, or a social-engineering attack targeting the agent itself —
could lead to silent exfiltration of credentials, modification of agent
behavior, or privilege escalation.

This document describes the layered defenses in place.

---

## Why protect sensitive UI sections?

### Threat 1 — Unattended browser tab

If the browser is left open on an unattended machine, anyone with physical
access can read API keys from the Config section, inspect security rules in
the Security section, or edit agent instructions in the Agents section.

**Mitigation:** Tab lock. Each sensitive section requires a fresh Touch ID /
Face ID ceremony every time the user navigates to it. The browser tab shows
only a lock screen until authenticated.

### Threat 2 — Shoulder surfing / screen observation

An attacker with visual access to the screen (in-person or via screenshare)
can read agent configuration, credentials, or workspace file contents without
touching the keyboard.

**Mitigation:** Tab lock. The lock screen contains no sensitive data — only
the section name and an "Unlock (Touch ID)" button. The content is hidden
until the owner authenticates.

### Threat 3 — Agent-driven UI manipulation

A prompt injection or jailbreak attempt could instruct the agent to:

- Read and exfiltrate agent configuration via the gateway RPC (`agents.files.get`).
- Overwrite `AGENTS.md` or `SECURITY.md` to weaken security rules.
- Use the SDK Write/Edit tools to bypass the gateway layer entirely.

**Mitigations (layered):**

1. `AGENTS.md` and `SECURITY.md` contain explicit behavioral rules forbidding
   the agent from modifying its own instruction files.
2. The `agents.files.set` and `agents.files.edit` RPCs require a real-time
   Touch ID approval from the workspace owner before proceeding.
3. The SDK `WriteTool` and `EditTool` are wrapped at creation time
   (`createGenosOSWriteTool` / `createGenosOSEditTool`) to intercept writes to
   protected files and route them through the same biometric approval flow —
   so bypassing the RPC layer does not bypass the gate.
4. The Control UI Agent and Config tabs require Touch ID to access, preventing
   the agent from triggering UI navigation to read sensitive configuration.

### Threat 4 — Stolen / shared gateway token

If the gateway token leaks, an attacker can connect to the gateway and interact
with the agent. They cannot, however, access workspace files that require
biometric approval, because that approval requires a Touch ID ceremony on the
physical device registered as a WebAuthn authenticator.

**Mitigation:** WebAuthn credentials are bound to the device. Even with the
token, an attacker cannot approve file writes or unlock sensitive tabs remotely.

---

## Protected tabs

| Tab          | Why protected                                            | What's at risk without protection                               |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| **Agents**   | Agent configuration, workspace files, memory, persona    | Instruction modification, memory injection, behavioral override |
| **Config**   | Gateway configuration, API credentials, model settings   | Credential exposure, gateway reconfiguration                    |
| **Security** | WebAuthn credentials, audit log, binary allow/deny lists | Credential removal, security rule weakening                     |

Tabs not in this list (Chat, Overview, Sessions, Logs, etc.) do not contain
configuration data that could be used to escalate access or modify behavior.

---

## How the tab lock works

When WebAuthn credentials are registered, any navigation to a protected tab
renders a lock screen instead of the tab content:

```
┌─────────────────────────────────┐
│            🔒                   │
│    Config — Protected           │
│  Authenticate to access gateway │
│        configuration.           │
│                                 │
│    [ Unlock (Touch ID) ]        │
└─────────────────────────────────┘
```

Pressing **Unlock (Touch ID)** triggers a WebAuthn ceremony
(`PublicKeyCredential.get()`). On success the tab is added to `unlockedTabs`
and the real content renders. On cancel or failure the lock remains.

**On tab leave:** when the user navigates away from a protected tab, it is
immediately removed from `unlockedTabs`. Re-visiting any protected tab always
requires a fresh Touch ID.

**If no credentials registered:** the lock screen is never shown. All tabs
are accessible as before — the system degrades gracefully.

### Key components

| File                          | Role                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `ui/src/ui/views/tab-lock.js` | `renderTabLock(tabName, state)` — generic lock card           |
| `ui/src/ui/app.js`            | `unlockedTabs: Set<string>`, `tabLockBusy`, `unlockTab(name)` |
| `ui/src/ui/app-settings.js`   | `setTab()` removes departing tab from `unlockedTabs`          |
| `ui/src/ui/app-render.js`     | Guard on agents, config, security rendering                   |
| `ui/src/styles/security.css`  | `.tab-lock*` classes                                          |

---

## Biometric gate for workspace file writes

The tab lock protects screen visibility. A separate gate protects the files
themselves from being modified by the agent.

### Gateway RPC gate

`agents.files.set` and `agents.files.edit` check if the target file is in
`PROTECTED_WORKSPACE_NAMES` (`AGENTS.md`, `SECURITY.md`). If it is:

1. No WebAuthn credentials → hard block with hint to register credentials.
2. Credentials present → create a pending approval entry, broadcast
   `files.approval.required` to all connected Control UI clients, and block
   for up to 120 s awaiting a decision.

The Control UI shows a modal overlay. The owner presses **Approve (Touch ID)**
(triggers a WebAuthn ceremony) or **Deny**. The decision resolves the pending
promise on the gateway side.

### SDK tool gate (bypass prevention)

The agent's SDK `WriteTool` and `EditTool` write directly to disk and do not
go through the gateway RPC. They are wrapped at agent creation time:

```
createGenosOSWriteTool(sdkWriteTool, { workspaceRoot, agentId })
createGenosOSEditTool(sdkEditTool,  { workspaceRoot, agentId })
```

When a write targets a protected file, the wrapper calls
`callGatewayTool("files.approval.request", ...)`, which blocks until the
same biometric approval flow completes. The agent cannot write to these files
through any available tool without the workspace owner's physical approval.

### Approval flow summary

```
Agent write to AGENTS.md
         │
         ▼
Is file in PROTECTED_WORKSPACE_NAMES?
         │ yes
         ▼
Are WebAuthn credentials registered?
         │ yes
         ▼
Broadcast files.approval.required ──► Control UI shows modal
         │
         ▼
Owner authenticates with Touch ID
         │ approved
         ▼
Write proceeds
         │
         ▼
files.approval.resolved broadcast ──► UI invalidates content cache
```

---

## Registering WebAuthn credentials

Go to **Security** tab → **Touch ID / WebAuthn** → **Register Touch ID**.

Without registered credentials, all of the above gates are inactive and the
system behaves as a standard (no biometric) gateway.

See [WebAuthn setup](/security/webauthn) for full setup instructions.

---

## Defense in depth summary

| Layer             | What it protects                          | Mechanism                                                   |
| ----------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Vault encryption  | Data at rest in `~/.genosv1/`             | AES-256-GCM (NYXENC1), passphrase in macOS Keychain         |
| WebAuthn tab lock | Screen visibility of sensitive tabs       | Touch ID / Face ID per-visit                                |
| Gateway RPC gate  | `AGENTS.md` / `SECURITY.md` via RPC       | Touch ID + biometric approval modal                         |
| SDK tool gate     | `AGENTS.md` / `SECURITY.md` via SDK tools | Same modal routed through `files.approval.request`          |
| Behavioral rules  | Agent self-modification                   | AGENTS.md Red Lines + SECURITY.md injected after compaction |
| Rate limiting     | Brute-force on auth endpoints             | Per-IP rate limiter (loopback not exempt)                   |
| Audit log         | Accountability trail                      | HMAC-SHA256 chained JSONL, key in Keychain                  |
