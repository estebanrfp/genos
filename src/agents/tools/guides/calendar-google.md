Calendar Google:
Summary: Google Calendar integration for appointment scheduling, availability management, and event CRUD. Agent uses web_fetch for all API calls with OAuth Bearer token. OAuth flow via existing google-antigravity-auth pattern or manual service account. Best for: dental clinics, law firms, hair salons, any appointment-based business.

Setup:

1. Create Google Cloud project (if not exists):
   · console.cloud.google.com → New Project → name "GenosOS" → Create
   · Or reuse existing project from google-antigravity provider
2. Enable Calendar API:
   · APIs & Services → Library → search "Google Calendar API" → Enable
3. Create credentials:
   Option A — OAuth 2.0 (recommended for personal/business calendars):
   · APIs & Services → Credentials → Create Credentials → OAuth client ID
   · Application type: Desktop app → Create
   · Copy Client ID + Client Secret
   · Run OAuth flow: genosos models auth login --provider google-antigravity
   · Grant calendar scope when prompted. Token stored automatically in providers.
   · Verify: config_manage providers list → google-antigravity should show connected
   Option B — Service Account (for automated/headless operation):
   · APIs & Services → Credentials → Create Credentials → Service Account
   · Download JSON key file → extract client_email + private_key
   · Share your calendar with the service account email (Calendar Settings → Share → add service account email → Make changes to events)
   · Store key: config_manage set services.google-calendar.serviceAccountKey "{json_key_content}"
4. Configure calendar:
   config_manage set services.google-calendar.enabled true
   config_manage set services.google-calendar.calendarId "primary"
   · "primary" = default calendar. For specific: use calendar ID (email-like string from Calendar Settings → Integrate calendar)
   config_manage set services.google-calendar.timezone "Europe/Madrid"
5. Verify connection — agent can test with:
   web_fetch GET "https://www.googleapis.com/calendar/v3/calendars/primary" headers={"Authorization":"Bearer {token}"}
   Success: 200 with calendar summary, timezone. Failure: 401 = token expired (refresh needed), 403 = calendar not shared / scope missing.

API Reference (for agent use via web_fetch):

All requests: Authorization: Bearer {access_token}, Content-Type: application/json
Base URL: https://www.googleapis.com/calendar/v3

List Calendars:
GET /users/me/calendarList
Returns all calendars the user has access to. Use to find calendarId.

List Events:
GET /calendars/{calendarId}/events?timeMin={ISO8601}&timeMax={ISO8601}&singleEvents=true&orderBy=startTime
Example: GET /calendars/primary/events?timeMin=2026-03-05T00:00:00Z&timeMax=2026-03-06T00:00:00Z&singleEvents=true&orderBy=startTime
· singleEvents=true expands recurring events into individual instances
· maxResults=10 to limit

Create Event:
POST /calendars/{calendarId}/events
Body: {
"summary": "Dental Checkup — John Doe",
"description": "Regular checkup, patient #1234",
"start": {"dateTime": "2026-03-10T10:00:00", "timeZone": "Europe/Madrid"},
"end": {"dateTime": "2026-03-10T11:00:00", "timeZone": "Europe/Madrid"},
"attendees": [{"email": "patient@example.com"}],
"reminders": {"useDefault": false, "overrides": [{"method": "email", "minutes": 1440}, {"method": "popup", "minutes": 60}]}
}
· Always include timeZone in start/end to avoid UTC confusion
· attendees triggers email invitation (omit if not wanted)
· reminders: 1440 min = 24 hours, 60 min = 1 hour

Update Event:
PATCH /calendars/{calendarId}/events/{eventId}
Body: {"summary": "Updated Title", "start": {"dateTime": "2026-03-10T11:00:00", "timeZone": "Europe/Madrid"}}
· PATCH for partial update (only changed fields), PUT for full replace

Delete Event:
DELETE /calendars/{calendarId}/events/{eventId}
· sendUpdates=all to notify attendees of cancellation

Check Availability (FreeBusy):
POST /freeBusy
Body: {
"timeMin": "2026-03-10T08:00:00Z",
"timeMax": "2026-03-10T18:00:00Z",
"items": [{"id": "primary"}]
}
Returns busy periods. Agent computes free slots from business hours minus busy periods.

Business Hours Pattern:
Agent stores business hours in memory (e.g., Mon-Fri 9:00-18:00, Sat 9:00-14:00).
To find available slots:

1. Query freeBusy for the target day
2. Subtract busy periods from business hours
3. Filter slots by appointment duration (e.g., 30 min, 1 hour)
4. Present available times to customer

Recurring Events:
POST /calendars/{calendarId}/events
Body: {
"summary": "Weekly Team Meeting",
"start": {"dateTime": "2026-03-10T09:00:00", "timeZone": "Europe/Madrid"},
"end": {"dateTime": "2026-03-10T10:00:00", "timeZone": "Europe/Madrid"},
"recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=12"]
}
· RRULE format: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, BYDAY=MO,TU,WE, COUNT=N or UNTIL=date

Common Patterns:

Appointment booking flow:
Customer asks for appointment → agent checks freeBusy → presents available slots → customer picks → agent creates event with reminders → confirms to customer via WhatsApp/chat.

Daily schedule summary:
Agent queries today's events → formats as concise list → delivers to owner at start of day (via cron job or on request).

Appointment reminder:
Cron job queries tomorrow's events → for each: send WhatsApp reminder to attendee with time, location, and cancellation option.

Reschedule:
Agent finds existing event → proposes new times via freeBusy → customer confirms → agent updates event (PATCH) → attendees notified.

Token Refresh:
OAuth tokens expire after 1 hour. The auth-profiles system handles refresh automatically via google-antigravity-auth provider. If using manual tokens:
· Access token: short-lived (1h), stored in provider credentials
· Refresh token: long-lived, used to obtain new access tokens
· Agent should catch 401 errors and trigger token refresh before retry

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. 401 Unauthorized → token expired. If using google-antigravity provider, run: genosos models auth login --provider google-antigravity to re-authenticate. Token auto-refreshes for active sessions.
2. 403 Forbidden → Calendar API not enabled in Google Cloud Console. Or: calendar not shared with service account email. Or: scope missing (need calendar or calendar.events).
3. 404 Not Found → calendarId wrong. Use "primary" for default, or list calendars first: GET /users/me/calendarList.
4. Event not showing → check timezone. Events created with UTC times may appear on wrong day in local timezone. Always include timeZone in start/end.
5. Attendees not receiving invitations → check attendees[].email is valid. Google throttles invitations — don't bulk-create events with attendees.
6. FreeBusy returns empty → check timeMin/timeMax are ISO 8601 with timezone. Must be future dates. Check calendarId matches.
7. Recurring event issues → validate RRULE syntax. Common mistake: BYDAY=MON should be BYDAY=MO (2-letter codes).

Google Calendar Config Paths:
services.google-calendar.enabled: boolean, false — Enable Google Calendar integration
services.google-calendar.calendarId: string, primary — Calendar ID (primary or specific)
services.google-calendar.timezone: string — Default timezone (e.g., Europe/Madrid)
services.google-calendar.serviceAccountKey: string — Service account JSON key (secret, alternative to OAuth)
services.google-calendar.appointmentDuration: number, 60 — Default appointment duration in minutes
services.google-calendar.businessHours: object — Business hours config (mon-sun, start, end)
