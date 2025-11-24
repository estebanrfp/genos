Apis:
Summary: Service API keys and tokens live in env.vars (genosos.json). Injected automatically as process.env.VAR_NAME to ALL agents. This is the single source of truth for non-AI credentials.

Current env.vars keys:
Run config_manage get env.vars to list all configured service keys (values are masked).

Add/Update:
config_manage set env.vars.MY_SERVICE_KEY "value"
Example: config_manage set env.vars.GOOGLE_SERVICE_ACCOUNT_JSON '{"type":"service_account",...}'
Example: config_manage set env.vars.TAVILY_API_KEY "tvly-..."

Access from agent:
Service keys are available as process.env.VAR_NAME in exec/bash contexts.
For JSON credentials (e.g. Google Service Account), parse with JSON.parse(process.env.VAR_NAME).

Remove:
config_manage remove env.vars.MY_SERVICE_KEY

Rules:
· NEVER store credentials in workspace files, docs/, or memory/
· NEVER hardcode keys in scripts — always read from process.env
· If a credential is missing, ask the user to add it via config_manage set env.vars.KEY "value"
· env.vars is for service APIs (Google, Tavily, Hashnode, Cloudflare, etc.)
· AI provider credentials go in providers section, not here
