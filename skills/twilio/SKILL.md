---
name: twilio
description: Twilio APIs — Voice calls, SMS/MMS, WhatsApp, Verify, Conversations. Direct HTTPS, no SDK needed.
metadata:
  {
    "genosos":
      {
        "emoji": "📞",
        "requires": { "env": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] },
        "primaryEnv": "TWILIO_ACCOUNT_SID",
      },
  }
---

# Twilio

Access Twilio APIs for Voice, SMS/MMS, WhatsApp, Verify, Conversations, and more via direct HTTPS requests.

## Setup

1. Sign up at [twilio.com](https://www.twilio.com) (trial gives $15 free credit)
2. In the onboarding, select: **Twilio** > **With code** > **AI Agents** > **Voice**
3. Buy a phone number (Phone Numbers > Buy a number) — ~$1.15/mo for US numbers
4. Go to **Account Dashboard** and copy:
   - **Account SID** (starts with `AC...`)
   - **Auth Token** (click Show to reveal)
5. Set environment variables:
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+16616054453
   ```

## Base URL

```
https://api.twilio.com/2010-04-01/Accounts/{AccountSid}
```

## Authentication

HTTP Basic auth: Account SID as username, Auth Token as password.

```bash
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls.json" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -d "To=+34612345678" \
  -d "From=$TWILIO_PHONE_NUMBER" \
  -d "Url=http://demo.twilio.com/docs/voice.xml"
```

## Quick Start — Make a Call

```bash
python3 <<'EOF'
import urllib.request, urllib.parse, os, json, base64

sid = os.environ["TWILIO_ACCOUNT_SID"]
token = os.environ["TWILIO_AUTH_TOKEN"]
phone = os.environ.get("TWILIO_PHONE_NUMBER", "+16616054453")

data = urllib.parse.urlencode({
    "To": "+34XXXXXXXXX",
    "From": phone,
    "Url": "http://demo.twilio.com/docs/voice.xml"
}).encode()

req = urllib.request.Request(
    f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls.json",
    data=data, method="POST"
)
credentials = base64.b64encode(f"{sid}:{token}".encode()).decode()
req.add_header("Authorization", f"Basic {credentials}")

print(json.dumps(json.load(urllib.request.urlopen(req)), indent=2))
EOF
```

## Quick Start — Send SMS

```bash
python3 <<'EOF'
import urllib.request, urllib.parse, os, json, base64

sid = os.environ["TWILIO_ACCOUNT_SID"]
token = os.environ["TWILIO_AUTH_TOKEN"]
phone = os.environ.get("TWILIO_PHONE_NUMBER", "+16616054453")

data = urllib.parse.urlencode({
    "To": "+34XXXXXXXXX",
    "From": phone,
    "Body": "Hello from GenosOS!"
}).encode()

req = urllib.request.Request(
    f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
    data=data, method="POST"
)
credentials = base64.b64encode(f"{sid}:{token}".encode()).decode()
req.add_header("Authorization", f"Basic {credentials}")

print(json.dumps(json.load(urllib.request.urlopen(req)), indent=2))
EOF
```

## API Reference

### Voice (Calls)

- **Create call:** `POST /Calls.json` — fields: `To`, `From`, `Url` (TwiML)
- **Get call:** `GET /Calls/{CallSid}.json`
- **Update/hangup:** `POST /Calls/{CallSid}.json` — `Status=completed`
- **List calls:** `GET /Calls.json`

### Messaging (SMS/MMS)

- **Send:** `POST /Messages.json` — fields: `To`, `From`, `Body`, `MediaUrl` (MMS)
- **Get:** `GET /Messages/{MessageSid}.json`
- **List:** `GET /Messages.json`

### WhatsApp

Same Messages API but with `whatsapp:` prefix on numbers:

- `From=whatsapp:+14155238886` (Twilio sandbox)
- `To=whatsapp:+34612345678`

### Verify (OTP)

- Base: `https://verify.twilio.com/v2`
- Create service, send verification, check code
- Channels: SMS, Voice, WhatsApp, Email, TOTP

### Conversations

- Base: `https://conversations.twilio.com/v1`
- Omni-channel threads across SMS, WhatsApp, chat

### Lookup

- Phone number intelligence (line type, carrier, formatting)
- `GET https://lookups.twilio.com/v2/PhoneNumbers/{number}`

## References

See `references/` folder for detailed guides on each Twilio service:

- `twilio-api-overview.md` — base endpoints and auth
- `twilio-auth-and-webhooks.md` — webhook signature validation
- `twilio-voice.md` — calls and IVR
- `twilio-messaging-sms-mms.md` — SMS/MMS workflows
- `twilio-whatsapp.md` — WhatsApp specifics
- `twilio-conversations.md` — omni-channel threads
- `twilio-verify.md` — OTP flows
- `twilio-sendgrid.md` — email via SendGrid
- `twilio-studio.md` — visual flow builder
- `twilio-lookup.md` — phone intelligence
- `twilio-proxy.md` — masked communications
- `twilio-sync.md` — real-time state
- `twilio-taskrouter.md` — routing and queues
- `twilio-segment-engage.md` — CDP and audience activation

## Trial Limitations

- Can only call/SMS **verified numbers** (add in Twilio console > Verified Caller IDs)
- Outbound calls play a trial message before your TwiML
- $15.50 credit, no credit card required
- Upgrade to Pay-as-you-go to remove restrictions

## Notes

- All API calls use HTTPS directly to `api.twilio.com` — no third-party proxies
- Voice calls require a TwiML URL or `Twiml` parameter with inline XML
- For real-time voice AI: use Twilio Media Streams + OpenAI Realtime API
- Rate limits apply per account; monitor 429 responses
- Validate `X-Twilio-Signature` on all inbound webhooks
