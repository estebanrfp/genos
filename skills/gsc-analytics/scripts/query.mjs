#!/usr/bin/env node

/**
 * GSC Search Analytics query — clicks, impressions, CTR, position.
 * Usage: node query.mjs <siteUrl> [--dim query|page|date] [--days 28] [--limit 25]
 * Outputs JSON to stdout.
 * @module gsc-analytics/query
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (!args[0] || args[0] === "-h" || args[0] === "--help") {
  console.error("Usage: node query.mjs <siteUrl> [--dim query|page|date] [--days 28] [--limit 25]");
  process.exit(2);
}

const siteUrl = args[0];
let dimension = "query";
let days = 28;
let limit = 25;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--dim") {
    dimension = args[++i] ?? "query";
    continue;
  }
  if (args[i] === "--days") {
    days = parseInt(args[++i] ?? "28", 10);
    continue;
  }
  if (args[i] === "--limit") {
    limit = parseInt(args[++i] ?? "25", 10);
    continue;
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const token = execFileSync("node", [join(scriptDir, "auth.mjs")], {
  env: process.env,
  encoding: "utf-8",
}).trim();

const end = new Date();
const start = new Date(end.getTime() - days * 86400000);
const fmt = (d) => d.toISOString().slice(0, 10);

const res = await fetch(
  `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: [dimension],
      rowLimit: Math.min(limit, 25000),
    }),
  },
);

if (!res.ok) {
  const text = await res.text();
  console.error(`Query failed (${res.status}): ${text}`);
  process.exit(1);
}

const data = await res.json();
const rows = (data.rows ?? []).map((r) => ({
  [dimension]: r.keys?.[0] ?? "",
  clicks: r.clicks ?? 0,
  impressions: r.impressions ?? 0,
  ctr: `${((r.ctr ?? 0) * 100).toFixed(1)}%`,
  position: (r.position ?? 0).toFixed(1),
}));

console.log(JSON.stringify({ siteUrl, dimension, days, rows }, null, 2));
