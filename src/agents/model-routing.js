import { isSubagentSessionKey } from "../sessions/session-key-utils.js";
import { parseModelRef } from "./model-selection.js";
import { extractTierModel, normalizeTierProfile } from "./tier-profiles.js";

const CODE_MARKERS_RE =
  /```|(?:^|\s)(?:function|class|import|export|const|let|async|await|=>|def |return )\s/gm;
const ANALYSIS_KEYWORDS_RE =
  /\b(?:analy[sz]e|anali[zc]a[r]?|debug|depura[r]?|explain\s+why|explica\s+(?:por\s+qu[eé]|c[oó]mo)|compare|compara[r]?|refactor|review|revisa[r]?|optimize|optimiza[r]?|architect|design|dise[nñ]a[r]?|investigate|investiga[r]?|diagnose|diagnostica[r]?|evalua[r]?|audita[r]?|examina[r]?)\b/gi;
const REASONING_KEYWORDS_RE =
  /\b(?:step[- ]by[- ]step|paso\s+a\s+paso|think\s+carefully|piensa\s+bien|reason\s+about|razona\s+sobre|chain[- ]of[- ]thought|prove|prueba\s+que|derive|deriva[r]?|formal|demuestra|en\s+detalle|a\s+fondo|profundidad)\b/gi;
/** Config/implementation/destructive tasks that require complex tier (Opus). */
const CONFIG_ESCALATION_RE =
  /\b(?:crea[r]?|configura[r]?|configure|instala[r]?|install|implementa[r]?|implement|conecta[r]?|connect|setup|set\s*up|habilita[r]?|enable|desactiva[r]?|disable|securiza[r]?|asegura[r]?|secure|protege[r]?|protect|migra[r]?|migrate|despliega[r]?|deploy|integra[r]?|integrate|elimina[r]?|delete|borra[r]?|remove|desconecta[r]?|disconnect|revoca[r]?|revoke|restaura[r]?|restore|actualiza[r]?|update|modifica[r]?|modify|renombra[r]?|rename)\b/gi;
/** Target nouns — escalation only triggers when paired with these. */
const CONFIG_TARGET_RE =
  /\b(?:agent[e]?|canal(?:es)?|channel[s]?|servicio[s]?|service[s]?|proveedor(?:es)?|provider[s]?|herramienta[s]?|tool[s]?|cron|webhook[s]?|api|negocio|business|asistente|assistant|bot|extensi[oó]n(?:es)?|plugin[s]?|seguridad|security|firewall|vault|certificado[s]?|ssl|tls|backup[s]?|whatsapp|discord|telegram|slack|signal|matrix|nostr|imessage|stripe|calendar|crm|tts|voz|voice)\b/gi;

/**
 * Count regex matches in text.
 * @param {string} text
 * @param {RegExp} re
 * @returns {number}
 */
const countMatches = (text, re) => {
  const m = text.match(re);
  return m?.length ?? 0;
};

/**
 * Estimate token count from character length.
 * @param {string} text
 * @returns {number}
 */
const estimateTokens = (text) => Math.ceil(text.length / 4);

/**
 * Classify prompt complexity into a routing tier.
 * @param {string} prompt - The user prompt text
 * @param {object} [opts]
 * @param {string} [opts.sessionKey] - Session key
 * @param {number} [opts.imageCount] - Number of attached images
 * @param {number} [opts.turnCount] - Conversation turn depth
 * @returns {"normal" | "complex"}
 */
export const classifyPromptTier = (prompt, opts = {}) => {
  const text = prompt?.trim() ?? "";
  if (!text) {
    return "normal";
  }

  const tokens = estimateTokens(text);
  const images = opts.imageCount ?? 0;
  const turnCount = opts.turnCount ?? 0;

  let score = 0;

  // Token length signal
  if (tokens > 2000) {
    score += 4;
  } else if (tokens > 200) {
    score += 2;
  }

  // Image count signal
  if (images >= 2) {
    score += 3;
  } else if (images === 1) {
    score += 1;
  }

  // Code markers signal
  const codeHits = countMatches(text, CODE_MARKERS_RE);
  if (codeHits >= 3) {
    score += 3;
  } else if (codeHits >= 1) {
    score += 1;
  }

  // Analysis keywords signal
  const analysisHits = countMatches(text, ANALYSIS_KEYWORDS_RE);
  if (analysisHits >= 2) {
    score += 3;
  } else if (analysisHits === 1) {
    score += 3;
  }

  // Reasoning keywords signal
  if (countMatches(text, REASONING_KEYWORDS_RE) >= 1) {
    score += 4;
  }

  // Deep conversation signal
  if (turnCount > 10) {
    score += 2;
  }

  // Two-tier system: normal (Sonnet) or complex (Opus)
  return score > 7 ? "complex" : "normal";
};

/**
 * Classify which capabilities a prompt needs, independent of tier.
 * Analyzes prompt content to decide thinking, reasoning, verbose levels.
 * @param {string} prompt
 * @param {object} [opts]
 * @param {number} [opts.imageCount]
 * @returns {{ thinking?: string, reasoning?: string, verbose?: string }}
 */
export const classifyPromptCapabilities = (prompt, opts = {}) => {
  const text = prompt?.trim() ?? "";
  if (!text) {
    return {};
  }

  const caps = {};
  const tokens = estimateTokens(text);
  const reasoningHits = countMatches(text, REASONING_KEYWORDS_RE);
  const analysisHits = countMatches(text, ANALYSIS_KEYWORDS_RE);
  const codeHits = countMatches(text, CODE_MARKERS_RE);
  const images = opts.imageCount ?? 0;

  // Thinking: needed for complex reasoning, analysis, or long prompts
  if (reasoningHits >= 1 || (analysisHits >= 2 && tokens > 500)) {
    caps.thinking = "high";
  } else if (analysisHits >= 1 || codeHits >= 3 || tokens > 1000) {
    caps.thinking = "low";
  }

  // Reasoning: explicit chain-of-thought or formal reasoning requests
  if (reasoningHits >= 1) {
    caps.reasoning = "on";
  }

  // Verbose: multi-image analysis, very long prompts, or deep code review
  if (images >= 2 || tokens > 2000 || (codeHits >= 3 && analysisHits >= 1)) {
    caps.verbose = "on";
  }

  return caps;
};

/**
 * Detect if a prompt requests configuration, implementation, or security work.
 * These tasks require the complex tier (Opus) for reliable multi-step execution.
 * Returns "complex" when an action verb is paired with a system target noun.
 * Management/query-only prompts (list, show, status) are NOT escalated.
 * @param {string} prompt
 * @returns {"complex" | null}
 */
export const classifyTierEscalation = (prompt) => {
  const text = prompt?.trim() ?? "";
  if (!text) {
    return null;
  }
  const actionHits = countMatches(text, CONFIG_ESCALATION_RE);
  const targetHits = countMatches(text, CONFIG_TARGET_RE);
  return actionHits >= 1 && targetHits >= 1 ? "complex" : null;
};

/**
 * Check whether an agent has delegation capabilities (can spawn/send to other agents).
 * Agents with these capabilities need at least "normal" tier to reason about delegation.
 * @param {object} config - Full GenosOS config
 * @param {string} [agentId] - Agent ID to check
 * @returns {boolean}
 */
const isOrchestratorAgent = (config, agentId) => {
  if (!agentId) {
    return false;
  }
  const agents = config?.agents?.list ?? [];
  const entry = agents.find((a) => a.id === agentId);
  if (!entry) {
    return agentId === "main";
  }
  // Has subagent spawn permissions
  const allowAgents = entry.subagents?.allowAgents;
  if (Array.isArray(allowAgents) && allowAgents.length > 0) {
    return true;
  }
  // Is the default (main) agent
  if (entry.default || agentId === "main") {
    return true;
  }
  // Is in the A2A allow list (can communicate with other agents)
  const a2aAllow = config?.tools?.agentToAgent?.allow ?? [];
  if (a2aAllow.includes(agentId) || a2aAllow.includes("*")) {
    return true;
  }
  return false;
};

/**
 * Check whether a session should be excluded from smart routing.
 * Only dynamically spawned subagents get routed (sessionKey contains "subagent:").
 * Configured agents (main, specialists) use manual tier selection via UI.
 * @param {string} [sessionKey] - Session key to check
 * @returns {boolean}
 */
export const isRoutingExcluded = (sessionKey) => {
  return !isSubagentSessionKey(sessionKey);
};

/**
 * Resolve routed model from tier config.
 * Returns null if routing is disabled or tier model is invalid.
 * Excluded for default/main agents — only subagents get dynamic routing.
 * Orchestrator agents (with delegation capabilities) get a minimum floor of "normal".
 * @param {object} params
 * @param {object} params.config - Full GenosOS config
 * @param {string} params.prompt - User prompt
 * @param {string} [params.sessionKey]
 * @param {number} [params.imageCount]
 * @param {number} [params.turnCount]
 * @param {string} [params.agentId] - Current agent ID
 * @param {string} params.defaultProvider - Current provider
 * @returns {{ provider: string, model: string, tier: string, thinking?: string, verbose?: string, reasoning?: string } | null}
 */
export const resolveRoutedModel = (params) => {
  const routing = params.config?.agents?.defaults?.model?.routing;
  if (!routing?.enabled || !routing?.tiers) {
    return null;
  }

  // Only spawned subagents get routed — configured agents keep their defaultTier
  if (isRoutingExcluded(params.sessionKey)) {
    return null;
  }

  let tier = classifyPromptTier(params.prompt, {
    sessionKey: params.sessionKey,
    imageCount: params.imageCount,
    turnCount: params.turnCount,
  });

  // Orchestrator agents need at least "normal" to reason about delegation
  if (tier === "simple" && isOrchestratorAgent(params.config, params.agentId)) {
    tier = "normal";
  }

  const tierValue = routing.tiers[tier];
  if (!tierValue) {
    return null;
  }

  const modelRef = extractTierModel(tierValue);
  const parsed = parseModelRef(modelRef, params.defaultProvider);
  if (!parsed) {
    return null;
  }

  const profile = normalizeTierProfile(tierValue, tier);
  // Explicit config profile takes priority; otherwise infer from prompt analysis
  const inferred = classifyPromptCapabilities(params.prompt, {
    imageCount: params.imageCount,
  });
  const thinking = profile.thinking ?? inferred.thinking;
  const reasoning = profile.reasoning ?? inferred.reasoning;
  const verbose = profile.verbose ?? inferred.verbose;
  return {
    provider: parsed.provider,
    model: parsed.model,
    tier,
    ...(thinking !== undefined ? { thinking } : {}),
    ...(verbose !== undefined ? { verbose } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
};
