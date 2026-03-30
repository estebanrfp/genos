Signal:
Summary: Requires signal-cli (JVM or native) + a phone number. Two setup paths: link existing account (QR) or register new number (SMS). Dedicated bot number recommended.

Setup Path A — Link Existing Account (QR, fastest):

1. Install signal-cli:
   · macOS: brew install signal-cli
   · Linux native:
   VERSION=$(curl -Ls -o /dev/null -w %{url_effective} https://github.com/AsamK/signal-cli/releases/latest | sed 's/^.*\/v//')
     curl -L -O "https://github.com/AsamK/signal-cli/releases/download/v${VERSION}/signal-cli-${VERSION}-Linux-native.tar.gz"
     sudo tar xf "signal-cli-${VERSION}-Linux-native.tar.gz" -C /opt
   sudo ln -sf /opt/signal-cli /usr/local/bin/
2. Link device: signal-cli link -n "GenosOS" → scan QR code with Signal app on phone
3. Configure:
   config_manage set channels.signal.enabled true
   config_manage set channels.signal.account "+15551234567"
   config_manage set channels.signal.cliPath "signal-cli"

WARNING: Use a separate bot number. If personal number, bot ignores own messages (loop protection).

Setup Path B — Register New Number (SMS):

1. Register: signal-cli -a +BOT_NUMBER register
   · If captcha required: open signalcaptchas.org/registration/generate.html → complete → copy signalcaptcha:// link
   · signal-cli -a +BOT_NUMBER register --captcha 'signalcaptcha://...'
2. Verify: signal-cli -a +BOT_NUMBER verify VERIFICATION_CODE
3. Configure (same as Path A step 3)

WARNING: Registering with signal-cli de-authenticates the main Signal app for that number.

External Daemon Mode (for slow JVM starts or containers):
config_manage set channels.signal.httpUrl "http://127.0.0.1:8080"
config_manage set channels.signal.autoStart false

Diagnostic (Signal-specific):
· No account configured → TELL user: no Signal account. Register or link a phone number with signal-cli first.
· signal-cli not found → check cliPath. macOS Homebrew: /opt/homebrew/bin/signal-cli
· Connection/daemon error → TELL user: signal-cli daemon not running. Restart gateway or check autoStart.
· Auth error → account may need re-linking
· Group messages ignored → check groupPolicy, groupAllowFrom
· Slow startup → JVM build. Set channels.signal.startupTimeoutMs 60000 or recommend native build.

Reactions:
config_manage set channels.signal.actions.reactions true
config_manage set channels.signal.reactionLevel minimal
· Levels: off, ack, minimal, extensive

Signal-Specific Paths:
channels.signal.account: string — Bot phone E.164 format
channels.signal.cliPath: string, signal-cli — Path to binary
channels.signal.httpUrl: string — External daemon URL
channels.signal.autoStart: boolean, true — Auto-spawn daemon
channels.signal.groupAllowFrom: array, [] — Group sender allowlist
channels.signal.historyLimit: number, 50 — Group context messages
channels.signal.textChunkLimit: number, 4000 — Max chars per message
channels.signal.mediaMaxMb: number, 8 — Media size cap
channels.signal.sendReadReceipts: boolean, false — Forward read receipts
channels.signal.startupTimeoutMs: number — JVM startup timeout
