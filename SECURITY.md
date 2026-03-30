# Security Policy

GenosOS is a local-first AI gateway that connects to real messaging platforms. Security is a core concern.

## Reporting vulnerabilities

If you find a security issue, report it privately via [GitHub Security Advisories](https://github.com/estebanrfp/GenosOS/security/advisories/new) or email the maintainer directly.

### What to include

1. Description of the vulnerability
2. Steps to reproduce
3. Severity assessment and impact
4. Affected component
5. Suggested fix (if any)

## Security model

### Gateway binding

- The Gateway binds to **loopback only** (`127.0.0.1` / `::1`) by default.
- Do **not** expose it to the public internet directly.
- For remote access, use SSH tunnels or Tailscale Serve/Funnel while keeping the Gateway on loopback.
- The Gateway HTTP surface includes the Control UI and Canvas host. Treat canvas content as untrusted.

### DM access control

- Default DM policy is **pairing**: unknown senders receive a short pairing code and their message is not processed until approved.
- Public DM access requires explicit opt-in: `dmPolicy="open"` plus `"*"` in the channel allowlist.
- Run `genosos doctor` to surface risky or misconfigured DM policies.

### Tool execution

- Tools run on the host for the **main** session (full access for the operator).
- Non-main sessions (groups/channels) can run inside per-session Docker sandboxes via `agents.defaults.sandbox.mode: "non-main"`.

### Secret Vault

- Secrets (API keys, channel tokens) can be stored in an **AES-256-GCM encrypted vault** (`~/.genosv1/vault.enc`) instead of plaintext config.
- Key derivation: PBKDF2 (100,000 iterations, SHA-512, 32-byte salt).
- Vault file is `chmod 600` (owner-only); a fresh 12-byte IV is generated per write.
- Manage secrets via CLI: `genosos vault set|get|list|delete`.
- Passphrase sourced from: `VAULT_PASSPHRASE` env → `~/.genosv1/.env` → interactive prompt.

### Filesystem hardening

- `tools.exec.applyPatch.workspaceOnly: true` (recommended): restricts `apply_patch` writes to the workspace directory.
- `tools.fs.workspaceOnly: true` (optional): restricts all file operations to the workspace directory.

### Skills — local-first by design

GenosOS skills are **local-first**: they live on the user's machine as plain Markdown files (`SKILL.md` + frontmatter), not executable code. Skills are knowledge — they teach the agent how to use existing tools; they don't ship binaries, native modules, or runtime plugins.

- **No marketplace dependency.** Skills are installed from local directories (`~/.genosv1/skills`, `<workspace>/skills`, or `skills.load.extraDirs`). ClawHub is an optional public registry; GenosOS is fully functional without it.
- **Skill scanner.** `config_manage security audit` runs an 8-rule static scanner on all installed skills: detects `exec`/`spawn`, `eval`, crypto-mining patterns, data exfiltration, environment harvesting, and obfuscated code (4 critical + 4 warning rules).
- **No code signing required.** Because skills are Markdown instructions (not executable code), the attack surface is limited to prompt injection — mitigated by the immutable Safety layer and channel tool restrictions (Phase 75).
- **Precedence is explicit.** Workspace skills override managed skills, which override bundled skills. No hidden loading paths.

### Safe binaries

- `tools.exec.safeBins` binaries must resolve from trusted bin directories (system defaults plus gateway startup `PATH`).
- PATH-hijacked binaries cannot bypass allowlist checks.

## Runtime requirements

GenosOS runs on **Bun >= 1.2.0**. Keep Bun updated for security patches.

## Security scanning

This project uses `detect-secrets` for automated secret detection:

```bash
pip install detect-secrets==1.5.0
detect-secrets scan --baseline .secrets.baseline
```

## Out of scope

- Public internet exposure (the Gateway is designed for local/trusted network use)
- Prompt injection attacks (inherent to LLM-based systems)
- Using GenosOS in ways the documentation recommends against

## Author

Esteban Fuster Pozzi (@estebanrfp) — Full Stack JavaScript Developer
