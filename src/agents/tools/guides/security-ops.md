Security Operations:
Summary: Run audits, interpret findings, apply remediations, schedule reports. The security sentinel uses config_manage security audit to scan the gateway configuration and filesystem for vulnerabilities.

Running an Audit:
config_manage security audit — standard scan (config + filesystem + channels)
config_manage security audit value=deep — deep scan (adds gateway probe + plugin code safety + installed skills check)
Returns: { summary: { critical, warn, info }, findings: [{ checkId, severity, title, detail, remediation? }], deep? }

Audit Categories:
· Gateway (gateway._) — bind, auth, rate limiting, token strength, trusted proxies, Control UI, Tailscale
· Browser (browser._) — CDP control, remote connections, auth
· Logging (logging._) — redaction settings
· Tools (tools.elevated._) — elevated tool allowFrom wildcards, oversized allowlists
· Filesystem (fs._) — state dir/config symlinks, permissions (world/group writable/readable)
· Channels (channels._) — DM isolation, Discord native commands, Slack slash commands, Telegram allowFrom
· Plugins (plugins._) — extension allowlists, reachable permissive policies
· Credentials (fs.credentials_dir._, fs.auth_profiles.\*) — credential file permissions

Remediation Playbooks:
· gateway.bind*no_auth → config_manage set gateway.auth.enabled true
· gateway.token_too_short → config_manage set gateway.auth.token "{new-token}" (min 32 chars)
· gateway.auth_no_rate_limit → config_manage security harden (enables rate limiting)
· gateway.control_ui.insecure_auth → config_manage set controlUI.auth.method "webauthn"
· gateway.control_ui.device_auth_disabled → config_manage set controlUI.auth.deviceAuthEnabled true
· gateway.trusted_proxies_missing → config_manage set gateway.trustedProxies '["127.0.0.1"]'
· gateway.loopback_no_auth → config_manage set gateway.auth.enabled true
· browser.control_no_auth → config_manage set browser.control.auth.enabled true
· browser.remote_cdp_http → config_manage set browser.control.remoteEndpoint "wss://..." (use WSS)
· logging.redact_off → config_manage set logging.redactSensitive "tools"
· tools.elevated.allowFrom.*.wildcard → config*manage set tools.elevated.allowFrom.{provider} '["specific-agent-id"]'
· fs.state_dir.perms_world_writable → fix: chmod 700 ~/.genos (manual)
· fs.config.perms_writable → fix: chmod 600 ~/.genosv1/genosos.json (manual)
· channels.*.dm.open → config_manage set channels.{id}.dm.enabled false (or scope to specific users)
· channels.discord.commands.native.unrestricted → config_manage set channels.discord.commands.native.allowRoles '["admin"]'
· channels.telegram.groups.allowFrom.wildcard → config_manage set channels.telegram.groups.allowFrom '["specific-user-id"]'
· plugins.extensions_no_allowlist → config_manage set extensions.allowlist '["ext1","ext2"]'

Hardening Sequence:

1. config_manage security harden — apply Fortress Mode defaults (rate limiting, audit log, redaction)
2. config_manage security audit — verify findings reduced
3. Address remaining CRITICAL findings manually (filesystem permissions, token rotation)
4. config_manage security audit value=deep — deep probe for plugin/skill code safety
5. config_manage set security.vault.autoLockMinutes 30

Report Formats:
Daily digest — nyx-ui status-grid with columns: severity, count, top finding. Focus on CRITICAL + WARN only.
Weekly digest — full summary with trends (compare to last week), compliance checklist, remediation progress.
Example status-grid:
<nyx-ui type="status-grid" cols="Severity,Count,Action" rows="CRITICAL,0,✓ Clear;WARN,2,Review;INFO,5,Digest" />

Escalation Rules:
· 3+ CRITICAL findings → immediate alert to main session, suggest auto-fix
· Vault lock event → notify, check if intentional or attack
· New CRITICAL since last audit → highlight as regression
· Permission change on state dir → immediate alert
· All clear (0 critical, 0 warn) → brief confirmation, no action needed

Scheduling:
Daily 6:00 — config_manage security audit, filter critical+warn, report via status-grid
Weekly Monday 9:00 — config_manage security audit value=deep, full digest with trends
On-demand — user requests "run security check" or "audit gateway"

Related Actions:
· config_manage security status — vault/fortress/webauthn state
· config_manage security harden — apply fortress defaults
· config_manage tools profile/allow/deny — manage tool policies via chat
· config_manage approvals get — current approval policies
· config_manage webauthn list — registered WebAuthn credentials
