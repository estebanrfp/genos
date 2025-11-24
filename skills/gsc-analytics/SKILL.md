---
name: gsc-analytics
description: Google Search Console analytics — keyword rankings, indexation status, sitemaps. Requires GOOGLE_SERVICE_ACCOUNT_JSON in env.vars.
metadata:
  {
    "genosos":
      {
        "emoji": "📊",
        "requires": { "bins": ["node"], "env": ["GOOGLE_SERVICE_ACCOUNT_JSON"] },
        "primaryEnv": "GOOGLE_SERVICE_ACCOUNT_JSON",
      },
  }
---

# GSC Analytics

Google Search Console data via service account. All scripts output JSON.

## Search Analytics (keywords, pages, dates)

```bash
node {baseDir}/scripts/query.mjs "sc-domain:example.com"
node {baseDir}/scripts/query.mjs "sc-domain:example.com" --dim page --days 7
node {baseDir}/scripts/query.mjs "https://example.com/" --dim date --days 90 --limit 50
```

Options:

- `--dim <query|page|date>`: Dimension to group by (default: query)
- `--days <n>`: Date range in days (default: 28)
- `--limit <n>`: Max rows (default: 25)

## URL Inspection (indexation check)

```bash
node {baseDir}/scripts/inspect.mjs "sc-domain:example.com" "https://example.com/page1" "https://example.com/page2"
```

Returns verdict, coverage state, robots.txt state, last crawl time per URL.
If verdict is UNKNOWN, the URL may not be tracked — this is NOT an error.

## Sitemaps

```bash
node {baseDir}/scripts/sitemaps.mjs "sc-domain:example.com"
```

Lists all registered sitemaps with submission dates, URL counts, and errors.

## siteUrl format

- Domain property: `sc-domain:example.com`
- URL prefix: `https://example.com/`
- Use sitemaps endpoint first to discover which format the property uses
- If unsure, try `sc-domain:` first — it covers all protocols and subdomains

## Notes

- Credentials come from `process.env.GOOGLE_SERVICE_ACCOUNT_JSON` (set via `config_manage apis`)
- The service account must be added as a user in GSC for the target property
- All scripts authenticate automatically via `auth.mjs` — no manual token management needed
