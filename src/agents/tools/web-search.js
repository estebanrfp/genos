let extractGrokContent = function (data) {
    for (const output of data.output ?? []) {
      if (output.type !== "message") {
        continue;
      }
      for (const block of output.content ?? []) {
        if (block.type === "output_text" && typeof block.text === "string" && block.text) {
          const urls = (block.annotations ?? [])
            .filter((a) => a.type === "url_citation" && typeof a.url === "string")
            .map((a) => a.url);
          return { text: block.text, annotationCitations: [...new Set(urls)] };
        }
      }
    }
    const text = typeof data.output_text === "string" ? data.output_text : undefined;
    return { text, annotationCitations: [] };
  },
  resolveSearchConfig = function (cfg) {
    const search = cfg?.tools?.web?.search;
    if (!search || typeof search !== "object") {
      return;
    }
    return search;
  },
  resolveSearchEnabled = function (params) {
    if (typeof params.search?.enabled === "boolean") {
      return params.search.enabled;
    }
    if (params.sandboxed) {
      return true;
    }
    return true;
  },
  resolveSearchApiKey = function (search) {
    const fromConfig =
      search && "apiKey" in search && typeof search.apiKey === "string"
        ? normalizeSecretInput(search.apiKey)
        : "";
    const fromEnv = normalizeSecretInput(process.env.BRAVE_API_KEY);
    return fromConfig || fromEnv || undefined;
  },
  missingSearchKeyPayload = function (provider) {
    if (provider === "perplexity") {
      return {
        error: "missing_perplexity_api_key",
        message:
          "web_search (perplexity) needs an API key. Set PERPLEXITY_API_KEY or OPENROUTER_API_KEY in the Gateway environment, or configure tools.web.search.perplexity.apiKey.",
        docs: "https://docs.genos.ai/tools/web",
      };
    }
    if (provider === "grok") {
      return {
        error: "missing_xai_api_key",
        message:
          "web_search (grok) needs an xAI API key. Set XAI_API_KEY in the Gateway environment, or configure tools.web.search.grok.apiKey.",
        docs: "https://docs.genos.ai/tools/web",
      };
    }
    return {
      error: "missing_brave_api_key",
      message: `web_search needs a Brave Search API key. Run \`${formatCliCommand("genosos configure --section web")}\` to store it, or set BRAVE_API_KEY in the Gateway environment.`,
      docs: "https://docs.genos.ai/tools/web",
    };
  },
  resolveSearchProvider = function (search) {
    const raw =
      search && "provider" in search && typeof search.provider === "string"
        ? search.provider.trim().toLowerCase()
        : "";
    if (raw === "perplexity") {
      return "perplexity";
    }
    if (raw === "grok") {
      return "grok";
    }
    if (raw === "brave") {
      return "brave";
    }
    return "brave";
  },
  resolvePerplexityConfig = function (search) {
    if (!search || typeof search !== "object") {
      return {};
    }
    const perplexity = "perplexity" in search ? search.perplexity : undefined;
    if (!perplexity || typeof perplexity !== "object") {
      return {};
    }
    return perplexity;
  },
  resolvePerplexityApiKey = function (perplexity) {
    const fromConfig = normalizeApiKey(perplexity?.apiKey);
    if (fromConfig) {
      return { apiKey: fromConfig, source: "config" };
    }
    const fromEnvPerplexity = normalizeApiKey(process.env.PERPLEXITY_API_KEY);
    if (fromEnvPerplexity) {
      return { apiKey: fromEnvPerplexity, source: "perplexity_env" };
    }
    const fromEnvOpenRouter = normalizeApiKey(process.env.OPENROUTER_API_KEY);
    if (fromEnvOpenRouter) {
      return { apiKey: fromEnvOpenRouter, source: "openrouter_env" };
    }
    return { apiKey: undefined, source: "none" };
  },
  normalizeApiKey = function (key) {
    return normalizeSecretInput(key);
  },
  inferPerplexityBaseUrlFromApiKey = function (apiKey) {
    if (!apiKey) {
      return;
    }
    const normalized = apiKey.toLowerCase();
    if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      return "direct";
    }
    if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      return "openrouter";
    }
    return;
  },
  resolvePerplexityBaseUrl = function (perplexity, apiKeySource = "none", apiKey) {
    const fromConfig =
      perplexity && "baseUrl" in perplexity && typeof perplexity.baseUrl === "string"
        ? perplexity.baseUrl.trim()
        : "";
    if (fromConfig) {
      return fromConfig;
    }
    if (apiKeySource === "perplexity_env") {
      return PERPLEXITY_DIRECT_BASE_URL;
    }
    if (apiKeySource === "openrouter_env") {
      return DEFAULT_PERPLEXITY_BASE_URL;
    }
    if (apiKeySource === "config") {
      const inferred = inferPerplexityBaseUrlFromApiKey(apiKey);
      if (inferred === "direct") {
        return PERPLEXITY_DIRECT_BASE_URL;
      }
      if (inferred === "openrouter") {
        return DEFAULT_PERPLEXITY_BASE_URL;
      }
    }
    return DEFAULT_PERPLEXITY_BASE_URL;
  },
  resolvePerplexityModel = function (perplexity) {
    const fromConfig =
      perplexity && "model" in perplexity && typeof perplexity.model === "string"
        ? perplexity.model.trim()
        : "";
    return fromConfig || DEFAULT_PERPLEXITY_MODEL;
  },
  isDirectPerplexityBaseUrl = function (baseUrl) {
    const trimmed = baseUrl.trim();
    if (!trimmed) {
      return false;
    }
    try {
      return new URL(trimmed).hostname.toLowerCase() === "api.perplexity.ai";
    } catch {
      return false;
    }
  },
  resolvePerplexityRequestModel = function (baseUrl, model) {
    if (!isDirectPerplexityBaseUrl(baseUrl)) {
      return model;
    }
    return model.startsWith("perplexity/") ? model.slice("perplexity/".length) : model;
  },
  resolveGrokConfig = function (search) {
    if (!search || typeof search !== "object") {
      return {};
    }
    const grok = "grok" in search ? search.grok : undefined;
    if (!grok || typeof grok !== "object") {
      return {};
    }
    return grok;
  },
  resolveGrokApiKey = function (grok) {
    const fromConfig = normalizeApiKey(grok?.apiKey);
    if (fromConfig) {
      return fromConfig;
    }
    const fromEnv = normalizeApiKey(process.env.XAI_API_KEY);
    return fromEnv || undefined;
  },
  resolveGrokModel = function (grok) {
    const fromConfig =
      grok && "model" in grok && typeof grok.model === "string" ? grok.model.trim() : "";
    return fromConfig || DEFAULT_GROK_MODEL;
  },
  resolveGrokInlineCitations = function (grok) {
    return grok?.inlineCitations === true;
  },
  resolveSearchCount = function (value, fallback) {
    const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
    return clamped;
  },
  normalizeFreshness = function (value) {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const lower = trimmed.toLowerCase();
    if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) {
      return lower;
    }
    const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
    if (!match) {
      return;
    }
    const [, start, end] = match;
    if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
      return;
    }
    if (start > end) {
      return;
    }
    return `${start}to${end}`;
  },
  freshnessToPerplexityRecency = function (freshness) {
    if (!freshness) {
      return;
    }
    const map = {
      pd: "day",
      pw: "week",
      pm: "month",
      py: "year",
    };
    return map[freshness] ?? undefined;
  },
  isValidIsoDate = function (value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  },
  resolveSiteName = function (url) {
    if (!url) {
      return;
    }
    try {
      return new URL(url).hostname;
    } catch {
      return;
    }
  };
import { Type } from "@sinclair/typebox";
import { formatCliCommand } from "../../cli/command-format.js";
import { wrapWebContent } from "../../security/external-content.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";
const _SEARCH_PROVIDERS = ["brave", "perplexity", "grok"];
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";
const PERPLEXITY_KEY_PREFIXES = ["pplx-"];
const OPENROUTER_KEY_PREFIXES = ["sk-or-"];
const XAI_API_ENDPOINT = "https://api.x.ai/v1/responses";
const DEFAULT_GROK_MODEL = "grok-4-1-fast";
const SEARCH_CACHE = new Map();
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;
const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
  country: Type.Optional(
    Type.String({
      description:
        "2-letter country code for region-specific results (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
    }),
  ),
  search_lang: Type.Optional(
    Type.String({
      description: "ISO language code for search results (e.g., 'de', 'en', 'fr').",
    }),
  ),
  ui_lang: Type.Optional(
    Type.String({
      description: "ISO language code for UI elements.",
    }),
  ),
  freshness: Type.Optional(
    Type.String({
      description:
        "Filter results by discovery time. Brave supports 'pd', 'pw', 'pm', 'py', and date range 'YYYY-MM-DDtoYYYY-MM-DD'. Perplexity supports 'pd', 'pw', 'pm', and 'py'.",
    }),
  ),
});
async function runPerplexitySearch(params) {
  const baseUrl = params.baseUrl.trim().replace(/\/$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const model = resolvePerplexityRequestModel(baseUrl, params.model);
  const body = {
    model,
    messages: [
      {
        role: "user",
        content: params.query,
      },
    ],
  };
  const recencyFilter = freshnessToPerplexityRecency(params.freshness);
  if (recencyFilter) {
    body.search_recency_filter = recencyFilter;
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "HTTP-Referer": "https://genosos.ai",
      "X-Title": "GenosOS Web Search",
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64000 });
    const detail = detailResult.text;
    throw new Error(`Perplexity API error (${res.status}): ${detail || res.statusText}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "No response";
  const citations = data.citations ?? [];
  return { content, citations };
}
async function runGrokSearch(params) {
  const body = {
    model: params.model,
    input: [
      {
        role: "user",
        content: params.query,
      },
    ],
    tools: [{ type: "web_search" }],
  };
  const res = await fetch(XAI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64000 });
    const detail = detailResult.text;
    throw new Error(`xAI API error (${res.status}): ${detail || res.statusText}`);
  }
  const data = await res.json();
  const { text: extractedText, annotationCitations } = extractGrokContent(data);
  const content = extractedText ?? "No response";
  const citations = (data.citations ?? []).length > 0 ? data.citations : annotationCitations;
  const inlineCitations = data.inline_citations;
  return { content, citations, inlineCitations };
}
async function runWebSearch(params) {
  const cacheKey = normalizeCacheKey(
    params.provider === "brave"
      ? `${params.provider}:${params.query}:${params.count}:${params.country || "default"}:${params.search_lang || "default"}:${params.ui_lang || "default"}:${params.freshness || "default"}`
      : params.provider === "perplexity"
        ? `${params.provider}:${params.query}:${params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL}:${params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL}:${params.freshness || "default"}`
        : `${params.provider}:${params.query}:${params.grokModel ?? DEFAULT_GROK_MODEL}:${String(params.grokInlineCitations ?? false)}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }
  const start = Date.now();
  if (params.provider === "perplexity") {
    const { content, citations } = await runPerplexitySearch({
      query: params.query,
      apiKey: params.apiKey,
      baseUrl: params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      timeoutSeconds: params.timeoutSeconds,
      freshness: params.freshness,
    });
    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      tookMs: Date.now() - start,
      externalContent: {
        untrusted: true,
        source: "web_search",
        provider: params.provider,
        wrapped: true,
      },
      content: wrapWebContent(content),
      citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }
  if (params.provider === "grok") {
    const { content, citations, inlineCitations } = await runGrokSearch({
      query: params.query,
      apiKey: params.apiKey,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      timeoutSeconds: params.timeoutSeconds,
      inlineCitations: params.grokInlineCitations ?? false,
    });
    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      tookMs: Date.now() - start,
      externalContent: {
        untrusted: true,
        source: "web_search",
        provider: params.provider,
        wrapped: true,
      },
      content: wrapWebContent(content),
      citations,
      inlineCitations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }
  if (params.provider !== "brave") {
    throw new Error("Unsupported web search provider.");
  }
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) {
    url.searchParams.set("country", params.country);
  }
  if (params.search_lang) {
    url.searchParams.set("search_lang", params.search_lang);
  }
  if (params.ui_lang) {
    url.searchParams.set("ui_lang", params.ui_lang);
  }
  if (params.freshness) {
    url.searchParams.set("freshness", params.freshness);
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64000 });
    const detail = detailResult.text;
    throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
  }
  const data = await res.json();
  const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
  const mapped = results.map((entry) => {
    const description = entry.description ?? "";
    const title = entry.title ?? "";
    const url = entry.url ?? "";
    const rawSiteName = resolveSiteName(url);
    return {
      title: title ? wrapWebContent(title, "web_search") : "",
      url,
      description: description ? wrapWebContent(description, "web_search") : "",
      published: entry.age || undefined,
      siteName: rawSiteName || undefined,
    };
  });
  const payload = {
    query: params.query,
    provider: params.provider,
    count: mapped.length,
    tookMs: Date.now() - start,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: params.provider,
      wrapped: true,
    },
    results: mapped,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}
export function createWebSearchTool(options) {
  const search = resolveSearchConfig(options?.config);
  if (!resolveSearchEnabled({ search, sandboxed: options?.sandboxed })) {
    return null;
  }
  const provider = resolveSearchProvider(search);
  const perplexityConfig = resolvePerplexityConfig(search);
  const grokConfig = resolveGrokConfig(search);
  const description =
    provider === "perplexity"
      ? "Search the web using Perplexity Sonar (direct or via OpenRouter). Returns AI-synthesized answers with citations from real-time web search."
      : provider === "grok"
        ? "Search the web using xAI Grok. Returns AI-synthesized answers with citations from real-time web search."
        : "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research.";
  return {
    label: "Web Search",
    name: "web_search",
    description,
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      const perplexityAuth =
        provider === "perplexity" ? resolvePerplexityApiKey(perplexityConfig) : undefined;
      const apiKey =
        provider === "perplexity"
          ? perplexityAuth?.apiKey
          : provider === "grok"
            ? resolveGrokApiKey(grokConfig)
            : resolveSearchApiKey(search);
      if (!apiKey) {
        return jsonResult(missingSearchKeyPayload(provider));
      }
      const params = args;
      const query = readStringParam(params, "query", { required: true });
      const count =
        readNumberParam(params, "count", { integer: true }) ?? search?.maxResults ?? undefined;
      const country = readStringParam(params, "country");
      const search_lang = readStringParam(params, "search_lang");
      const ui_lang = readStringParam(params, "ui_lang");
      const rawFreshness = readStringParam(params, "freshness");
      if (rawFreshness && provider !== "brave" && provider !== "perplexity") {
        return jsonResult({
          error: "unsupported_freshness",
          message: "freshness is only supported by the Brave and Perplexity web_search providers.",
          docs: "https://docs.genos.ai/tools/web",
        });
      }
      const freshness = rawFreshness ? normalizeFreshness(rawFreshness) : undefined;
      if (rawFreshness && !freshness) {
        return jsonResult({
          error: "invalid_freshness",
          message:
            "freshness must be one of pd, pw, pm, py, or a range like YYYY-MM-DDtoYYYY-MM-DD.",
          docs: "https://docs.genos.ai/tools/web",
        });
      }
      const result = await runWebSearch({
        query,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        apiKey,
        timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        provider,
        country,
        search_lang,
        ui_lang,
        freshness,
        perplexityBaseUrl: resolvePerplexityBaseUrl(
          perplexityConfig,
          perplexityAuth?.source,
          perplexityAuth?.apiKey,
        ),
        perplexityModel: resolvePerplexityModel(perplexityConfig),
        grokModel: resolveGrokModel(grokConfig),
        grokInlineCitations: resolveGrokInlineCitations(grokConfig),
      });
      return jsonResult(result);
    },
  };
}
export const __testing = {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  isDirectPerplexityBaseUrl,
  resolvePerplexityRequestModel,
  normalizeFreshness,
  freshnessToPerplexityRecency,
  resolveGrokApiKey,
  resolveGrokModel,
  resolveGrokInlineCitations,
  extractGrokContent,
};
