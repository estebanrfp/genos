/**
 * Semantic Tool Filter — filters tools by embedding similarity to user intent.
 * Reduces prompt token usage by only including tools relevant to the user's message.
 * Tool embeddings are computed at boot and cached in RAM.
 * Query vector is reused from memory prefetch — zero extra API calls.
 */

import { cosineSimilarity } from "../memory/internal.js";

/** Core tools always visible regardless of semantic score */
const ALWAYS_VISIBLE = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "exec",
  "process",
  "web_fetch",
  "web_search",
  "config_manage",
  "boost",
]);

/** Intent descriptions per tool — natural language for better semantic matching */
const TOOL_INTENTS = {
  browser: "The user wants to browse a website, take screenshots, or interact with web pages",
  canvas: "The user wants to create or edit visual content, diagrams, or UI mockups",
  nodes: "The user wants to manage knowledge nodes, memory entries, or structured data",
  cron: "The user wants to schedule a recurring or future task that runs automatically",
  message: "The user wants to send a message through a channel like WhatsApp, Telegram, or Discord",
  tts: "The user wants text spoken aloud as audio or voice synthesis",
  gateway: "The user wants to manage the API gateway, server configuration, or network settings",
  providers: "The user wants to change or manage AI model providers or API credentials",
  agents_list: "The user wants to see available agents or browse the agent directory",
  sessions_list: "The user wants to see conversation sessions or browse session history",
  sessions_history: "The user wants to review past conversation history or retrieve old messages",
  sessions_send: "The user wants to send a message to another session or delegate a task",
  sessions_spawn: "The user wants to create a new agent session or start a parallel conversation",
  subagents: "The user wants to delegate a task to a specialized agent or create a subagent",
  session_status: "The user wants to know the current session state, active tools, or context size",
  image: "The user wants to generate, create, or analyze an image using AI",
  apply_patch: "The user wants to apply a code patch or diff to modify files",
};

/** @type {Map<string, number[]>} */
const toolEmbeddings = new Map();

/**
 * Index tool embeddings at boot using the embedding provider.
 * Each tool gets an embedding from its name + description + intent phrase.
 * Cached in embed_cache by hash — only re-embeds when description changes.
 * @param {Array<{name: string, description: string}>} tools
 * @param {{embedBatch: (texts: string[]) => Promise<number[][]>}} embeddingProvider
 */
export async function indexToolEmbeddings(tools, embeddingProvider) {
  if (!embeddingProvider?.embedBatch) {
    return;
  }
  const texts = tools.map((t) => {
    const intent = TOOL_INTENTS[t.name] ?? "";
    return `${t.name}: ${t.description}${intent ? `. User might say: ${intent}` : ""}`;
  });
  const vecs = await embeddingProvider.embedBatch(texts);
  toolEmbeddings.clear();
  let indexed = 0;
  for (let i = 0; i < tools.length; i++) {
    if (vecs[i]) {
      toolEmbeddings.set(tools[i].name, vecs[i]);
      indexed++;
    }
  }
  console.log(`[tools] indexed ${indexed} tool embeddings`);
}

/**
 * Filter tools by semantic similarity to the user's query vector.
 * Core tools (read, write, exec, bash, etc.) always pass through.
 * Domain tools only included if cosine similarity >= threshold.
 * @param {Array<{name: string}>} tools - Tools to filter
 * @param {number[]} queryVec - User message embedding (from memory prefetch)
 * @param {Object} [options]
 * @param {Set<string>} [options.alwaysInclude] - Tool names to always include
 * @param {number} [options.threshold] - Minimum cosine similarity (default: 0.25)
 * @returns {Array} Filtered tools
 */
export function applySemanticToolFilter(
  tools,
  queryVec,
  { alwaysInclude = ALWAYS_VISIBLE, threshold = 0.25 } = {},
) {
  if (!queryVec || !toolEmbeddings.size) {
    return tools;
  }
  return tools.filter((tool) => {
    if (alwaysInclude.has(tool.name)) {
      return true;
    }
    const vec = toolEmbeddings.get(tool.name);
    if (!vec) {
      return true;
    }
    return cosineSimilarity(queryVec, vec) >= threshold;
  });
}

/** @returns {boolean} Whether tool embeddings have been indexed */
export function hasToolEmbeddings() {
  return toolEmbeddings.size > 0;
}
