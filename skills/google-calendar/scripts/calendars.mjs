#!/usr/bin/env node

/**
 * Google Calendar — list available calendars.
 * Also checks GOOGLE_CALENDAR_ID if set and not in calendarList (shared calendars).
 * Usage: node calendars.mjs
 * @module google-calendar/calendars
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const token = execFileSync("node", [join(dir, "auth.mjs")], {
  encoding: "utf-8",
  env: process.env,
}).trim();

const headers = { Authorization: `Bearer ${token}` };

const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
  headers,
});

if (!res.ok) {
  const text = await res.text();
  console.error(JSON.stringify({ error: true, status: res.status, message: text }));
  process.exit(1);
}

const data = await res.json();
const calendars = (data.items ?? []).map((c) => ({
  id: c.id,
  summary: c.summary,
  primary: c.primary ?? false,
  accessRole: c.accessRole,
  timeZone: c.timeZone,
}));

const configuredId = process.env.GOOGLE_CALENDAR_ID;
if (configuredId && !calendars.some((c) => c.id === configuredId)) {
  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(configuredId)}`,
    { headers },
  );
  if (calRes.ok) {
    const cal = await calRes.json();
    calendars.push({
      id: cal.id,
      summary: cal.summary ?? configuredId,
      primary: false,
      accessRole: "writer",
      timeZone: cal.timeZone,
      configuredDefault: true,
    });
  }
}

console.log(
  JSON.stringify(
    { count: calendars.length, calendars, defaultCalendarId: configuredId ?? null },
    null,
    2,
  ),
);
