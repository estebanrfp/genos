Nostr:
Summary: Plugin required. Needs a keypair (nsec/npub). DMs only (NIP-04 encrypted) — no group chats, no media attachments. NIP-17 gift-wrap planned but not yet supported.

Setup:

1. Install plugin: genosos plugins install @genosos/nostr
2. Generate keypair: nak key generate → save nsec (private key) securely
3. Set private key via env (recommended): export NOSTR_PRIVATE_KEY="nsec1..."
   · Or via config: config_manage set channels.nostr.privateKey '${NOSTR_PRIVATE_KEY}'
4. Enable: config_manage set channels.nostr.enabled true
5. Restart gateway after installing/enabling plugin

Profile:
config_manage set channels.nostr.profile.name "genosos"
config_manage set channels.nostr.profile.about "Personal assistant bot"
config_manage set channels.nostr.profile.picture "https://example.com/avatar.png"
config_manage set channels.nostr.profile.nip05 "genosos@example.com"
Published as NIP-01 kind:0 event. URLs must use https://.
Profile editor overlay: config_manage channels nostr.profile

Relays:
config_manage set channels.nostr.relays '["wss://relay.damus.io", "wss://relay.primal.net", "wss://nostr.wine"]'
Default: relay.damus.io, nos.lol. Use 2-3 relays for redundancy. Too many = latency + duplicates.
Local relay for testing: ws://localhost:7777

Accepted key formats: npub... or 64-char hex for pubkeys, nsec... or hex for private key.

Diagnostic (Nostr-specific):
· Plugin not loaded / channel unknown → TELL user: Nostr plugin not installed. Run genosos plugins install @genosos/nostr and restart gateway.
· Relay connection errors → check relays. If empty, set defaults: '["wss://relay.damus.io", "wss://nos.lol"]'. Verify URLs use wss://.
· Not sending responses → relay may not accept writes or is rate-limiting. Try different relay.

Limitations:
· DMs only (NIP-04 encrypted) — no group chats
· No media attachments
· NIP-17 gift-wrap planned but not yet supported

Nostr-Specific Paths:
channels.nostr.privateKey: string, required — nsec or hex (secret)
channels.nostr.relays: array, [damus, nos.lol] — Relay WebSocket URLs
channels.nostr.profile.name: string — NIP-01 display name
channels.nostr.profile.about: string — Bio/description
channels.nostr.profile.picture: string — Avatar URL (https)
channels.nostr.profile.nip05: string — NIP-05 verification
