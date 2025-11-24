Providers:
Summary: Single source of truth for AI credentials. BEFORE adding, run config_manage providers list to check if already exists. If found, TELL user it's already connected (show masked key). Only proceed if not found or user explicitly wants to replace.
For non-AI service keys (Google SA, Tavily, Hashnode, etc.) use config_manage apis instead.

API Key Providers (most common):
Anthropic, OpenAI, Google, xAI, OpenRouter, Together, Venice, HuggingFace, LiteLLM, Moonshot, Kimi, ZAI, Xiaomi, Qianfan, Synthetic, MiniMax, Vercel AI Gateway, OpenCode, custom.

config_manage providers add {provider} {api_key}
Example: config_manage providers add openai sk-proj-abc123...
A [SYSTEM] notification confirms: "{Provider} connected — credential saved as '{provider}:default'."

For anthropic-token variant (setup token, not API key): use provider name anthropic-token.

Custom endpoint (LM Studio, vLLM, LiteLLM proxy):
config_manage providers add custom {api_key}
config_manage set providers.custom.baseUrl "http://localhost:1234/v1"

Interactive Providers (require CLI — cannot add from chat):
· Device Flow: github-copilot, qwen-portal, minimax-portal
· Browser OAuth: chutes, openai-codex, google-antigravity, google-gemini-cli
TELL user to run in terminal: genosos models auth login --provider {provider-id}
CLI handles device codes, browser opening, and callback. Credential appears in providers list automatically.

Ollama (local models, no API key):
config_manage set providers.ollama.enabled true
· Default base URL: http://localhost:11434
· Custom: config_manage set providers.ollama.baseUrl "http://host:11434"
Models auto-discovered. Check: config_manage models list

Diagnostic:
STOP. Do NOT guess. Follow in order — resolve what you can, inform what you know, ask only what you cannot determine:

1. Run config_manage providers list — check exists, not paused (disabled: true). If paused: config_manage providers resume {provider}
2. Provider exists but calls fail → key may be invalid/expired. Check masked value (config_manage providers get {provider}). If wrong prefix/length, TELL user to provide new key. Overwrite: config_manage providers add {provider} {new_key}
3. Not in list → never added. Guide through setup above.
4. Rate limit / quota → TELL user: API quota may be exhausted. Check billing at provider's website. Common: OpenAI platform.openai.com, Anthropic console.anthropic.com
5. Model not found → wrong model ID. Run config_manage models list for available models.
6. Timeout / connection → check custom baseUrl (config_manage get providers.{name}.baseUrl). Verify endpoint reachable.

Common Tasks:
· List: config_manage providers list (filter: enabled, disabled)
· Overlay: config_manage providers status
· Pause/resume: config_manage providers pause openai / config_manage providers resume openai
· Delete: config_manage providers delete openai (or specific: providers delete openai:secondary)
· Multiple credentials: config_manage providers add openai {key2} openai:secondary
· Failover: first active non-disabled credential wins. Change priority by pausing lower-priority.

API Key Format Reference:
· Anthropic: sk-ant- (sk-ant-api03-...)
· OpenAI: sk- or sk-proj- (sk-proj-abc123...)
· Google: AIza (AIzaSy...)
· xAI: xai- (xai-abc123...)
· OpenRouter: sk-or- (sk-or-v1-...)
· HuggingFace: hf\_ (hf_abc123...)
· Venice: venice- (venice-abc...)

Provider Paths:
providers.{name}.enabled: boolean, true — Enable/disable provider
providers.{name}.baseUrl: string — Custom API endpoint
providers.{name}.profiles[].apiKey: string — API key (secret, masked)
providers.{name}.profiles[].disabled: boolean, false — Pause credential
providers.{name}.profiles[].type: enum, api_key — api_key, token, oauth
providers.{name}.models[]: array — Explicit model list override
providers.ollama.enabled: boolean, false — Enable Ollama discovery
providers.ollama.baseUrl: string, localhost:11434 — Ollama endpoint
auth.order.{provider}[]: array — Credential priority order
