#!/usr/bin/env node

/**
 * GSC Sitemaps — list all sitemaps registered in Search Console.
 * Usage: node sitemaps.mjs <siteUrl>
 * @module gsc-analytics/sitemaps
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const siteUrl = process.argv[2];
if (!siteUrl || siteUrl === "-h") {
  console.error("Usage: node sitemaps.mjs <siteUrl>");
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const token = execFileSync("node", [join(scriptDir, "auth.mjs")], {
  env: process.env,
  encoding: "utf-8",
}).trim();

const res = await fetch(
  `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
  { headers: { Authorization: `Bearer ${token}` } },
);

if (!res.ok) {
  const text = await res.text();
  console.error(`Sitemaps failed (${res.status}): ${text}`);
  process.exit(1);
}

const data = await res.json();
const sitemaps = (data.sitemap ?? []).map((s) => ({
  path: s.path,
  lastSubmitted: s.lastSubmitted ?? null,
  isPending: s.isPending ?? false,
  lastDownloaded: s.lastDownloaded ?? null,
  warnings: s.warnings ?? 0,
  errors: s.errors ?? 0,
  contents: (s.contents ?? []).map((c) => ({
    type: c.type,
    submitted: c.submitted ?? 0,
    indexed: c.indexed ?? 0,
  })),
}));

console.log(JSON.stringify({ siteUrl, sitemaps }, null, 2));
