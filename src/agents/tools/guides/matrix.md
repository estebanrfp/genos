Matrix:
Summary: Plugin required. Needs homeserver URL + access token (or userId + password for auto-login). E2EE optional but required for Beeper and encrypted rooms. Use full Matrix IDs (@user:server) — display names are ambiguous.

Setup:

1. Install plugin: genosos plugins install @genosos/matrix
   · Or from local: genosos plugins install ./extensions/matrix
2. Get access token:
   curl --request POST \
    --url https://YOUR_HOMESERVER/\_matrix/client/v3/login \
    --header 'Content-Type: application/json' \
    --data '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"YOUR_USERNAME"},"password":"YOUR_PASSWORD"}'
   · Copy access_token from response
   · Or let GenosOS handle login: set userId + password (token stored automatically)
3. Configure:
   config*manage set channels.matrix.enabled true
   config_manage set channels.matrix.homeserver "https://matrix.example.org"
   config_manage set channels.matrix.accessToken "syt*..."
   Env fallback: MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN (or MATRIX_USER_ID + MATRIX_PASSWORD)
   With access token, user ID is fetched automatically via /whoami.
4. Enable E2EE (if needed):
   config_manage set channels.matrix.encryption true
   · Verify device in another Matrix client (Element, etc.) to establish trust
   · If crypto module errors: pnpm rebuild @matrix-org/matrix-sdk-crypto-nodejs

Diagnostic (Matrix-specific):
· Plugin not loaded / channel unknown → TELL user: Matrix plugin not installed. Run genosos plugins install @genosos/matrix and restart gateway.
· Auth error → check accessToken. If empty, guide through token generation.
· Connected but not responding → check groupPolicy — if allowlist, rooms must be listed. Bot responds only to @mentions by default.
· Encrypted rooms fail → check channels.matrix.encryption — if false, enable. TELL user: verify bot's device in Element for E2EE to work.

Room Config:
config_manage set channels.matrix.groupPolicy allowlist
config_manage set channels.matrix.groups '{"!roomId:example.org": {"allow": true}}'
· With alias: '{"#alias:example.org": {"allow": true}}'
· No @mention: '{"!roomId:example.org": {"allow": true, "requireMention": false}}'

Room Sender Restriction:
config_manage set channels.matrix.groupAllowFrom '["@user:example.org"]'

DM Policy:
config_manage set channels.matrix.dm.policy allowlist
config_manage set channels.matrix.dm.allowFrom '["@user:example.org"]'
WARNING: Use full Matrix IDs (@user:server). Display names and bare localparts are ambiguous and ignored.

Thread Replies:
config_manage set channels.matrix.threadReplies inbound
· Options: off, inbound (default), always

Auto-Join Invites:
config_manage set channels.matrix.autoJoin always
· Options: always (default), allowlist, off
config_manage set channels.matrix.autoJoinAllowlist '["!roomId:example.org"]'

Matrix-Specific Paths:
channels.matrix.homeserver: string — Homeserver URL
channels.matrix.accessToken: string — Access token (secret)
channels.matrix.userId: string — Full Matrix ID (@user:server)
channels.matrix.password: string — Login password (token auto-stored, secret)
channels.matrix.encryption: boolean, false — Enable E2EE
channels.matrix.dm.policy: enum, pairing — pairing, allowlist, open, disabled
channels.matrix.dm.allowFrom: array, [] — Full Matrix user IDs
channels.matrix.groups: object, {} — Room allowlist + settings
channels.matrix.groupAllowFrom: array, [] — Room sender allowlist
channels.matrix.threadReplies: enum, inbound — off, inbound, always
channels.matrix.replyToMode: enum, off — off, first, all
channels.matrix.autoJoin: enum, always — always, allowlist, off
channels.matrix.textChunkLimit: number — Max chars per message
channels.matrix.mediaMaxMb: number — Media size cap
