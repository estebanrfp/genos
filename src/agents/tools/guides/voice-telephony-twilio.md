Voice Telephony (Twilio):
Summary: Bidirectional phone calls via Twilio. Outbound (notify/conversation) + inbound (allowlist/pairing/open). Media streaming with OpenAI Realtime STT. TTS via OpenAI, ElevenLabs, or Kokoro local. Webhook exposure via ngrok or Tailscale Funnel.

Setup:

1. Create Twilio account: twilio.com/try-twilio → sign up → verify phone number
2. Get credentials: Console → Account Info → copy Account SID + Auth Token
3. Buy phone number: Console → Phone Numbers → Buy a Number → select country → choose number with Voice capability
   IMPORTANT: Number must be E.164 format (+15550001234). Country determines local/toll-free/mobile.
4. Configure GenosOS:
   config_manage set plugins.entries.voice-call.config.enabled true
   config_manage set plugins.entries.voice-call.config.provider "twilio"
   config_manage set plugins.entries.voice-call.config.twilio.accountSid "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   config_manage set plugins.entries.voice-call.config.twilio.authToken "your_auth_token_here"
   config_manage set plugins.entries.voice-call.config.fromNumber "+15550001234"
   Env fallback: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
5. Configure webhook exposure (REQUIRED for inbound calls):
   Option A — Cloudflare Tunnel (recommended, fixed URL, fastest):
   config_manage set plugins.entries.voice-call.config.tunnel.provider "cloudflare"
   config_manage set plugins.entries.voice-call.config.tunnel.cloudflareToken "eyJ..."
   config_manage set plugins.entries.voice-call.config.tunnel.cloudflareHostname "voice.example.com"
   Requires: cloudflared installed, named tunnel created, DNS CNAME pointing to tunnel.
   Option B — ngrok:
   config_manage set plugins.entries.voice-call.config.tunnel.provider "ngrok"
   config_manage set plugins.entries.voice-call.config.tunnel.ngrokAuthToken "2abc..."
   Optional fixed domain: config_manage set plugins.entries.voice-call.config.tunnel.ngrokDomain "your-domain.ngrok-free.app"
   Option C — Tailscale Funnel (stable, no third party):
   config_manage set plugins.entries.voice-call.config.tailscale.mode "funnel"
   Option D — manual public URL:
   config_manage set plugins.entries.voice-call.config.publicUrl "https://your-domain.com/voice/webhook"
   Webhook server defaults: port 3334, bind 127.0.0.1, path /voice/webhook
   Override: config_manage set plugins.entries.voice-call.config.serve.port 3334
6. Configure inbound policy:
   config_manage set plugins.entries.voice-call.config.inboundPolicy "open"
   · disabled (default): reject all inbound calls
   · allowlist: only numbers in allowFrom
   · pairing: unknown callers get pairing prompt
   · open: accept all inbound calls
   For allowlist: config_manage set plugins.entries.voice-call.config.allowFrom '["+34660777328"]'
7. Set greeting (what the bot says when answering):
   config_manage set plugins.entries.voice-call.config.inboundGreeting "Hello, how can I help you?"
8. Restart gateway to apply voice-call plugin changes.

Outbound Calls:
Agent uses realtime_call tool:
· realtime_call initiate_call { to: "+34660777328", message: "Your appointment is tomorrow at 10am" }
· realtime_call initiate_call { to: "+34660777328", message: "Hello", mode: "conversation" }
Modes:
· notify (default): deliver message → short pause → hang up. Best for reminders, alerts, confirmations.
· conversation: deliver message → listen for response → agent responds → loop. Best for support, scheduling.
config_manage set plugins.entries.voice-call.config.outbound.defaultMode "conversation"

Streaming STT (real-time speech recognition):
config_manage set plugins.entries.voice-call.config.streaming.enabled true
config_manage set plugins.entries.voice-call.config.streaming.openaiApiKey "sk-..."
config_manage set plugins.entries.voice-call.config.streaming.sttModel "gpt-4o-transcribe"
Uses OpenAI Realtime API with VAD (voice activity detection). Partial + final transcriptions. Media stream via WebSocket at /voice/stream.

TTS for Calls:
Overrides global TTS config for telephony (μ-Law encoding, 8kHz):
config_manage set plugins.entries.voice-call.config.tts.provider "openai"
config_manage set plugins.entries.voice-call.config.tts.openai.voice "alloy"
config_manage set plugins.entries.voice-call.config.tts.openai.apiKey "sk-..."
Alternatives: elevenlabs (voiceId + apiKey), edge (free, lower quality). Kokoro local TTS also supported at gateway level.

Limits and Safety:
config_manage set plugins.entries.voice-call.config.maxDurationSeconds 300
config_manage set plugins.entries.voice-call.config.maxConcurrentCalls 1
config_manage set plugins.entries.voice-call.config.silenceTimeoutMs 800
config_manage set plugins.entries.voice-call.config.ringTimeoutMs 30000

Twilio Webhook Security:
Signature verification enabled by default (HMAC-SHA1 on X-Twilio-Signature header).
NEVER disable in production: config_manage set plugins.entries.voice-call.config.skipSignatureVerification false
Dev-only bypass for ngrok free tier: config_manage set plugins.entries.voice-call.config.tunnel.allowNgrokFreeTierLoopbackBypass true

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. Plugin not loading → check config_manage set plugins.entries.voice-call.config.enabled true. Restart gateway after changing.
2. Outbound calls fail → check credentials: accountSid starts with "AC", authToken is 32 hex chars. Verify at twilio.com/console. Check fromNumber is a Twilio number you own.
3. Inbound calls not arriving → check webhook URL reachable: publicUrl or tunnel must be configured. Verify Twilio Console → Phone Number → Voice webhook URL matches. Check inboundPolicy is not "disabled".
4. No audio / silence → check streaming.enabled + streaming.openaiApiKey. If using conversation mode, STT must be active. Check TTS provider configured.
5. Call connects but bot doesn't respond → check inboundGreeting is set. Check agent session key: calls create session hook:voicecall:{callId}.
6. Webhook signature errors → verify authToken matches Twilio Console. If behind proxy: config_manage set plugins.entries.voice-call.config.webhookSecurity.trustForwardingHeaders true
7. Calls drop after seconds → check maxDurationSeconds. For notify mode, check outbound.notifyHangupDelaySec (default 3s, may be too short for long messages).
8. ngrok tunnel not working → check ngrokAuthToken valid. Free tier: loopback bypass needed for signature verification.

Voice-Call Config Paths:
plugins.entries.voice-call.config.enabled: boolean, false — Enable voice-call plugin
plugins.entries.voice-call.config.provider: enum — twilio, telnyx, plivo, mock
plugins.entries.voice-call.config.twilio.accountSid: string — Twilio Account SID (starts with AC)
plugins.entries.voice-call.config.twilio.authToken: string — Twilio Auth Token (secret, 32 hex chars)
plugins.entries.voice-call.config.fromNumber: string — Outbound caller ID (E.164)
plugins.entries.voice-call.config.toNumber: string — Default outbound target (E.164)
plugins.entries.voice-call.config.inboundPolicy: enum, disabled — disabled, allowlist, pairing, open
plugins.entries.voice-call.config.allowFrom: array — Inbound allowlist (E.164 numbers)
plugins.entries.voice-call.config.inboundGreeting: string — Bot greeting on answer
plugins.entries.voice-call.config.outbound.defaultMode: enum, notify — notify, conversation
plugins.entries.voice-call.config.serve.port: number, 3334 — Webhook server port
plugins.entries.voice-call.config.serve.bind: string, 127.0.0.1 — Webhook server bind address
plugins.entries.voice-call.config.publicUrl: string — Manual public webhook URL
plugins.entries.voice-call.config.tunnel.provider: enum, none — none, cloudflare (recommended), ngrok, tailscale-serve, tailscale-funnel
plugins.entries.voice-call.config.streaming.enabled: boolean, false — Enable media streaming STT
plugins.entries.voice-call.config.streaming.openaiApiKey: string — OpenAI Realtime API key
plugins.entries.voice-call.config.maxDurationSeconds: number, 300 — Max call duration
plugins.entries.voice-call.config.maxConcurrentCalls: number, 5 — Concurrent call limit
plugins.entries.voice-call.config.tts.provider: enum — openai, elevenlabs, edge
plugins.entries.voice-call.config.skipSignatureVerification: boolean, false — Dev-only, NEVER in production
