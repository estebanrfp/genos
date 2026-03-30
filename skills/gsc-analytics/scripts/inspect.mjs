#!/usr/bin/env node

/**
 * GSC URL Inspection — check indexation status for specific URLs.
 * Usage: node inspect.mjs <siteUrl> <url1> [url2] ...
 * @module gsc-analytics/inspect
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length < 2 || args[0] === "-h") {
  console.error("Usage: node inspect.mjs <siteUrl> <url1> [url2] ...");
  process.exit(2);
}

const [siteUrl, ...urls] = args;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const token = execFileSync("node", [join(scriptDir, "auth.mjs")], {
  env: process.env,
  encoding: "utf-8",
}).trim();

const results = [];
for (const url of urls) {
  const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inspectionUrl: url, siteUrl }),
  });

  if (!res.ok) {
    const text = await res.text();
    results.push({ url, error: `${res.status}: ${text}` });
    continue;
  }

  const data = await res.json();
  const idx = data?.inspectionResult?.indexStatusResult;
  results.push({
    url,
    verdict: idx?.verdict ?? "UNKNOWN",
    coverageState: idx?.coverageState ?? "UNKNOWN",
    robotsTxtState: idx?.robotsTxtState ?? "UNKNOWN",
    lastCrawlTime: idx?.lastCrawlTime ?? null,
    crawledAs: idx?.crawledAs ?? null,
    pageFetchState: idx?.pageFetchState ?? "UNKNOWN",
  });
}

console.log(JSON.stringify({ siteUrl, inspections: results }, null, 2));
