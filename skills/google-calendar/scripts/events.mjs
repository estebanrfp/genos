#!/usr/bin/env node

/**
 * Google Calendar events — list, create, update, delete.
 * Usage:
 *   node events.mjs list [--calendar <id>] [--days <n>] [--limit <n>]
 *   node events.mjs get <eventId> [--calendar <id>]
 *   node events.mjs create <summary> <start> <end> [--calendar <id>] [--description <text>] [--attendees <emails>] [--timezone <tz>]
 *   node events.mjs quickadd <text> [--calendar <id>]
 *   node events.mjs update <eventId> <json-patch> [--calendar <id>]
 *   node events.mjs delete <eventId> [--calendar <id>]
 * @module google-calendar/events
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const token = execFileSync("node", [join(dir, "auth.mjs")], {
  encoding: "utf-8",
  env: process.env,
}).trim();
const BASE = "https://www.googleapis.com/calendar/v3";

const args = process.argv.slice(2);
const action = args[0] ?? "list";

/** @param {string} flag */
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const calendarId = encodeURIComponent(
  flag("calendar", process.env.GOOGLE_CALENDAR_ID || "primary"),
);
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

/** @param {string} url @param {RequestInit} opts */
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers, ...opts });
  if (!res.ok) {
    const text = await res.text();
    console.error(JSON.stringify({ error: true, status: res.status, message: text }));
    process.exit(1);
  }
  if (res.status === 204) return {};
  return res.json();
};

const output = (data) => console.log(JSON.stringify(data, null, 2));

switch (action) {
  case "list": {
    const days = parseInt(flag("days", "7"), 10);
    const limit = parseInt(flag("limit", "25"), 10);
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + days * 86400000).toISOString();
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: String(limit),
      singleEvents: "true",
      orderBy: "startTime",
    });
    const data = await api(`${BASE}/calendars/${calendarId}/events?${params}`);
    const events = (data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
      status: e.status,
      location: e.location,
      attendees: e.attendees?.map((a) => a.email),
    }));
    output({ count: events.length, events });
    break;
  }
  case "get": {
    const eventId = args[1];
    if (!eventId) {
      console.error("Usage: events.mjs get <eventId>");
      process.exit(1);
    }
    const data = await api(`${BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`);
    output(data);
    break;
  }
  case "create": {
    const summary = args[1];
    const start = args[2];
    const end = args[3];
    if (!summary || !start || !end) {
      console.error("Usage: events.mjs create <summary> <startDateTime> <endDateTime>");
      process.exit(1);
    }
    const tz = flag("timezone", "Europe/Madrid");
    const description = flag("description", undefined);
    const attendeesRaw = flag("attendees", "");
    const body = {
      summary,
      start: start.includes("T") ? { dateTime: start, timeZone: tz } : { date: start },
      end: end.includes("T") ? { dateTime: end, timeZone: tz } : { date: end },
    };
    if (description) body.description = description;
    if (attendeesRaw) body.attendees = attendeesRaw.split(",").map((e) => ({ email: e.trim() }));
    const data = await api(`${BASE}/calendars/${calendarId}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    output({ created: true, id: data.id, summary: data.summary, htmlLink: data.htmlLink });
    break;
  }
  case "quickadd": {
    const text = args[1];
    if (!text) {
      console.error("Usage: events.mjs quickadd <text>");
      process.exit(1);
    }
    const data = await api(
      `${BASE}/calendars/${calendarId}/events/quickAdd?text=${encodeURIComponent(text)}`,
      { method: "POST" },
    );
    output({ created: true, id: data.id, summary: data.summary, start: data.start });
    break;
  }
  case "update": {
    const eventId = args[1];
    const patch = args[2];
    if (!eventId || !patch) {
      console.error('Usage: events.mjs update <eventId> \'{"summary":"New title"}\'');
      process.exit(1);
    }
    const data = await api(
      `${BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        body: patch,
      },
    );
    output({ updated: true, id: data.id, summary: data.summary });
    break;
  }
  case "delete": {
    const eventId = args[1];
    if (!eventId) {
      console.error("Usage: events.mjs delete <eventId>");
      process.exit(1);
    }
    await api(`${BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
    output({ deleted: true, eventId });
    break;
  }
  default:
    console.error(`Unknown action: ${action}. Use: list, get, create, quickadd, update, delete`);
    process.exit(1);
}
