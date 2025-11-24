#!/usr/bin/env node

/**
 * Google Calendar — check free/busy availability.
 * Usage: node freebusy.mjs [--calendar <id>] [--days <n>]
 * @module google-calendar/freebusy
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const token = execFileSync("node", [join(dir, "auth.mjs")], {
  encoding: "utf-8",
  env: process.env,
}).trim();

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const calendarId = flag("calendar", process.env.GOOGLE_CALENDAR_ID || "primary");
const days = parseInt(flag("days", "7"), 10);
const now = new Date();
const timeMin = now.toISOString();
const timeMax = new Date(now.getTime() + days * 86400000).toISOString();

const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    timeMin,
    timeMax,
    items: [{ id: calendarId }],
  }),
});

if (!res.ok) {
  const text = await res.text();
  console.error(JSON.stringify({ error: true, status: res.status, message: text }));
  process.exit(1);
}

const data = await res.json();
const busy = data.calendars?.[calendarId]?.busy ?? [];
console.log(
  JSON.stringify({ calendarId, timeMin, timeMax, busySlots: busy.length, busy }, null, 2),
);
