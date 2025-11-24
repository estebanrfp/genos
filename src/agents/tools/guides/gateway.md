Gateway:
Summary: Controls network binding, authentication, TLS, config reload, and Control UI. Default port 18789.

Bind Modes:
· auto (default): 127.0.0.1 + Tailscale IP (if available) — most setups
· loopback: 127.0.0.1 only — strict local-only
· tailscale: Tailscale IP only — remote-only via VPN
· any: 0.0.0.0 (all interfaces) — behind reverse proxy, use with caution

config_manage set gateway.bind auto
config_manage set gateway.port 18789

Gateway Mode:
config_manage set gateway.mode local (single-device, default)
config_manage set gateway.mode remote (multi-device, external access)

Authentication:
config_manage set gateway.auth.token "my-secret-token" (API access)
config_manage set gateway.auth.password "my-password" (Control UI)

TLS / HTTPS:
config_manage set gateway.tls.enabled true
config_manage set gateway.tls.cert "/path/to/cert.pem"
config_manage set gateway.tls.key "/path/to/key.pem"
Cross-Field: tls.enabled=true REQUIRES both tls.cert and tls.key

Self-signed (testing only):
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj '/CN=localhost'
Production: use Let's Encrypt or org CA.

Config Reload:
· hybrid (default): Hot-reload config, full-reload channels — best balance
· full: Restart everything on config change — when hot-reload causes issues
· none: No auto-reload, manual restart — CI/CD, scripted deployments

config_manage set gateway.reload.mode hybrid

Control UI:
config_manage set gateway.controlUi.basePath "/" (reverse proxy base path)
config_manage set gateway.controlUi.allowedOrigins "https://my-domain.com"

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. config_manage status — check if running, note port and bind address
2. Won't start → port conflict. TELL user: try different port or check lsof -i :18789. If TLS enabled, verify cert/key paths exist and are readable.
3. UI not accessible → check gateway.bind (loopback = localhost only). Remote access needs tailscale or any. Check auth.token is set.
4. Channels don't connect → channel-specific issue. Load: config_manage channels {channel}.setup
5. Config changes don't apply → check gateway.reload.mode (none = restart required)

Gateway Paths:
gateway.port: number, 18789 — HTTP port (1-65535)
gateway.bind: enum, auto — auto, loopback, tailscale, any
gateway.mode: enum, local — local, remote
gateway.auth.token: string — API access token (sensitive)
gateway.auth.password: string — Control UI password (sensitive)
gateway.reload.mode: enum, hybrid — hybrid, full, none
gateway.tls.enabled: boolean, false — Enable HTTPS
gateway.tls.cert: string — Certificate path (PEM)
gateway.tls.key: string — Private key path (PEM)
gateway.controlUi.basePath: string, / — URL base path
gateway.controlUi.allowedOrigins: array, [] — CORS origins
