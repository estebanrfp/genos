Overview
This skill lets you search the web using a self-hosted SearxNG instance. It provides privacy-respecting, aggregated search results in JSON so you can automate queries, filter by category or language, and keep search data on your own infrastructure.

How this skill works
The skill queries your SearxNG server’s /search endpoint and returns JSON-formatted results aggregated from 70+ engines. You can pass parameters for query, categories, language, page number and format; responses include title, url, content snippet, engines, score, and category for each result. It works with a local or remote SearxNG instance, including Docker deployments.

When to use it
You need private, self-hosted search without third-party tracking.
You want machine-readable search results for automation or pipelines.
You need to aggregate results from multiple engines (web, images, news, videos).
You want localized searches (language/region) or paginated results.
You prefer a lightweight JSON API over commercial search APIs.
Best practices
Run SearxNG behind HTTPS and an access control proxy if exposed to the internet.
Enable JSON format in settings.yml (formats: [html, json]) for API use.
Set SEARXNG_URL environment variable to avoid hardcoding endpoints in scripts.
Use categories to narrow searches (general, images, news, it, science, videos).
Monitor container logs for engine rate-limiting and rotate or disable noisy engines.
Example use cases
Shell integration: add a searxng() function to your shell to run quick JSON searches and pretty-print top results.
Automated scraping: feed queries from a job queue and consume SearxNG JSON for downstream processing.
Research workflow: query multiple categories and languages to gather diverse sources and snippets.
Private search gateway: host SearxNG for a small team to avoid external trackers while keeping familiar search results.
Backup/archival tools: periodically archive top results for given queries via the JSON API.
FAQ
What URL does the skill use by default?

It defaults to http://localhost:8080. Set SEARXNG_URL to point to a custom host.

How do I get JSON results?

Ensure settings.yml includes formats: [html, json] and call /search with &format=json in the query string.
