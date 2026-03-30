Advanced:
Summary: Canvas host, plugins, shell environment, updates, discovery, broadcast, media, diagnostics.

Canvas Host:
Serves interactive visual tools (HTML/CSS/JS) that agents can present to the user.
config_manage set canvasHost.enabled true
config_manage set canvasHost.port 18790 (default: 18790)
config_manage set canvasHost.liveReload true (development)
Agents use canvas tool to present, hide, navigate, eval, and snapshot canvas content.

Plugins:
config_manage set plugins.enabled true (master switch)
config_manage set plugins.allow "my-plugin" (allowlist — only these load; empty = all minus deny)
config_manage set plugins.deny "untrusted-plugin" (denylist — never load, even if in allow)

Plugin Security:
· Trust all: plugins.enabled true, no allow/deny — development, personal use
· Allowlist: plugins.allow ["plugin-a","plugin-b"] — production, explicit control
· Denylist: plugins.deny ["untrusted-plugin"] — block specific known-bad
· Disabled: plugins.enabled false — minimal/headless deployments

Shell Environment:
Controls shell env capture for exec tool.
config_manage set env.shellEnv.enabled true (default: true)
config_manage set env.shellEnv.timeoutMs 5000 (default: 5000ms)
Captures $PATH, locale, env vars at startup so exec commands match user's shell.

Updates:
config_manage set update.channel stable (stable, beta, dev)
config_manage set update.checkOnStart true (default: true)

Discovery (mDNS):
config_manage set discovery.mdns.mode minimal (minimal=name only, full=name+capabilities, off)

Broadcast Strategy:
config_manage set broadcast.strategy parallel (parallel=all at once, sequential=one by one)

Media:
config_manage set media.preserveFilenames false (default: false — files renamed to hashes)

Diagnostics:
config_manage set diagnostics.flags "http-trace"
config_manage set diagnostics.cacheTrace.enabled true

Diagnostic — Common Issues:
STOP. Do NOT guess. Follow in order:

1. Canvas not loading → check canvasHost.enabled (true), check port not in use. TELL user: check lsof -i :{port}.
2. Plugin not loading → check plugins.enabled (true). If allowlist, verify plugin listed. If denylist, verify not blocked.
3. Exec wrong PATH → check env.shellEnv.enabled (true). Increase timeout if needed: env.shellEnv.timeoutMs 10000
4. mDNS not advertising → check discovery.mdns.mode (not off)

Advanced Paths:
canvasHost.enabled: boolean, false — Enable canvas server
canvasHost.port: number, 18790 — Canvas server port
canvasHost.liveReload: boolean, true — Live reload in dev
plugins.enabled: boolean, true — Master plugin switch
plugins.allow: array, [] — Plugin allowlist
plugins.deny: array, [] — Plugin denylist
env.shellEnv.enabled: boolean, true — Shell env capture
env.shellEnv.timeoutMs: number, 5000 — Capture timeout
update.channel: enum, stable — stable, beta, dev
update.checkOnStart: boolean, true — Auto-check updates
diagnostics.flags: array, [] — Debug flags
diagnostics.cacheTrace.enabled: boolean, false — Cache trace logging
discovery.mdns.mode: enum, minimal — minimal, full, off
broadcast.strategy: enum, parallel — parallel, sequential
media.preserveFilenames: boolean, false — Keep original filenames
