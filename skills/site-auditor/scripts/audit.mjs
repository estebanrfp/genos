#!/usr/bin/env node

/**
 * Technical SEO auditor — fetches pages and analyzes HTML structure.
 * Usage: node audit.mjs <url> [--pages 5] [--timeout 10000]
 * @module site-auditor/audit
 */

const args = process.argv.slice(2);
if (!args[0] || args[0] === "-h" || args[0] === "--help") {
  console.error("Usage: node audit.mjs <url> [--pages 5] [--timeout 10000]");
  process.exit(2);
}

const baseUrl = args[0].replace(/\/$/, "");
let maxPages = 5;
let timeout = 10000;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--pages") {
    maxPages = Math.min(parseInt(args[++i] ?? "5", 10), 20);
    continue;
  }
  if (args[i] === "--timeout") {
    timeout = parseInt(args[++i] ?? "10000", 10);
    continue;
  }
}

const origin = new URL(baseUrl).origin;

/** @param {string} url */
const safeFetch = async (url) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "GenosOS-SiteAuditor/1.0" },
      redirect: "follow",
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, text: await res.text(), url: res.url };
  } catch (err) {
    return { ok: false, status: 0, text: "", url, error: err.message };
  }
};

/** @param {string} html */
const extractMeta = (html) => {
  const tag = (re) => html.match(re)?.[1]?.trim() ?? null;
  const all = (re) => [...html.matchAll(re)].map((m) => m[1]?.trim()).filter(Boolean);

  return {
    title: tag(/<title[^>]*>([^<]+)<\/title>/i),
    description: tag(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i),
    canonical: tag(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i),
    h1: all(/<h1[^>]*>(.*?)<\/h1>/gi).map((h) => h.replace(/<[^>]+>/g, "")),
    h2Count: (html.match(/<h2[^>]*>/gi) ?? []).length,
    ogTitle: tag(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i),
    ogDescription: tag(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i),
    ogImage: tag(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i),
    viewport: tag(/<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']+)["']/i),
    lang: tag(/<html[^>]*lang=["']([^"']+)["']/i),
  };
};

/** @param {string} html @param {string} origin */
const extractInternalLinks = (html, origin) => {
  const links = new Set();
  for (const [, href] of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const resolved = new URL(href, origin);
      if (
        resolved.origin === origin &&
        !resolved.pathname.match(/\.(css|js|png|jpg|svg|ico|woff)$/i)
      ) {
        links.add(resolved.pathname);
      }
    } catch {}
  }
  return [...links];
};

// --- Robots.txt ---
const robotsRes = await safeFetch(`${origin}/robots.txt`);
const robots = {
  found: robotsRes.ok,
  status: robotsRes.status,
  ...(robotsRes.error ? { error: robotsRes.error } : {}),
  rules: [],
  sitemapRefs: [],
};
if (robotsRes.ok) {
  for (const line of robotsRes.text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("sitemap:")) {
      robots.sitemapRefs.push(trimmed.slice(8).trim());
    } else if (
      trimmed.startsWith("Disallow:") ||
      trimmed.startsWith("Allow:") ||
      trimmed.startsWith("User-agent:")
    ) {
      robots.rules.push(trimmed);
    }
  }
}

// --- Sitemap ---
const sitemapUrls = robots.sitemapRefs.length ? robots.sitemapRefs : [`${origin}/sitemap.xml`];
const sitemap = { found: false, urls: [], errors: [] };
for (const smUrl of sitemapUrls) {
  const smRes = await safeFetch(smUrl);
  if (!smRes.ok) {
    sitemap.errors.push({ url: smUrl, status: smRes.status, error: smRes.error ?? "not found" });
    continue;
  }
  sitemap.found = true;
  const locs = [...smRes.text.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
  const lastmods = [...smRes.text.matchAll(/<lastmod>([^<]+)<\/lastmod>/gi)].map((m) => m[1]);
  sitemap.urls.push({
    source: smUrl,
    urlCount: locs.length,
    newestLastmod: lastmods.sort().reverse()[0] ?? null,
    oldestLastmod: lastmods.sort()[0] ?? null,
    sampleUrls: locs.slice(0, 5),
  });
}

// --- Pages audit ---
const homePage = await safeFetch(baseUrl);
const discoveredLinks = homePage.ok ? extractInternalLinks(homePage.text, origin) : [];
const pagesToAudit = [
  baseUrl,
  ...discoveredLinks.slice(0, maxPages - 1).map((p) => `${origin}${p}`),
];
const pages = [];
const issues = [];

for (const pageUrl of pagesToAudit) {
  const isHome = pageUrl === baseUrl;
  const res = isHome ? homePage : await safeFetch(pageUrl);

  if (!res.ok) {
    pages.push({ url: pageUrl, status: res.status, error: res.error ?? "fetch failed" });
    if (res.status >= 400)
      issues.push({ severity: "WARN", page: pageUrl, issue: `HTTP ${res.status}` });
    continue;
  }

  const meta = extractMeta(res.text);
  const internalLinks = extractInternalLinks(res.text, origin);
  const page = {
    url: pageUrl,
    status: res.status,
    ...meta,
    internalLinkCount: internalLinks.length,
  };
  pages.push(page);

  // Issue detection
  if (!meta.title) issues.push({ severity: "CRITICAL", page: pageUrl, issue: "Missing <title>" });
  else if (meta.title.length > 60)
    issues.push({
      severity: "WARN",
      page: pageUrl,
      issue: `Title too long (${meta.title.length} chars)`,
    });

  if (!meta.description)
    issues.push({ severity: "WARN", page: pageUrl, issue: "Missing meta description" });
  else if (meta.description.length > 160)
    issues.push({
      severity: "INFO",
      page: pageUrl,
      issue: `Description long (${meta.description.length} chars)`,
    });

  if (meta.h1.length === 0)
    issues.push({ severity: "CRITICAL", page: pageUrl, issue: "Missing <h1>" });
  else if (meta.h1.length > 1)
    issues.push({
      severity: "WARN",
      page: pageUrl,
      issue: `Multiple <h1> tags (${meta.h1.length})`,
    });

  if (!meta.canonical)
    issues.push({ severity: "WARN", page: pageUrl, issue: "Missing canonical URL" });
  if (!meta.ogTitle) issues.push({ severity: "INFO", page: pageUrl, issue: "Missing og:title" });
  if (!meta.viewport)
    issues.push({ severity: "CRITICAL", page: pageUrl, issue: "Missing viewport meta" });
}

// --- Summary ---
const critical = issues.filter((i) => i.severity === "CRITICAL").length;
const warn = issues.filter((i) => i.severity === "WARN").length;
const info = issues.filter((i) => i.severity === "INFO").length;

console.log(
  JSON.stringify(
    {
      url: baseUrl,
      robots,
      sitemap,
      pages,
      issues,
      summary: {
        pagesAudited: pages.length,
        critical,
        warn,
        info,
        score: Math.max(0, 100 - critical * 15 - warn * 5 - info * 1),
      },
    },
    null,
    2,
  ),
);
