let getToolResultTextLength = function (msg) {
    if (!msg || msg.role !== "toolResult") {
      return 0;
    }
    const content = msg.content;
    if (!Array.isArray(content)) {
      return 0;
    }
    let totalLength = 0;
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text") {
        const text = block.text;
        if (typeof text === "string") {
          totalLength += text.length;
        }
      }
    }
    return totalLength;
  },
  truncateToolResultMessage = function (msg, maxChars) {
    const content = msg.content;
    if (!Array.isArray(content)) {
      return msg;
    }
    const totalTextChars = getToolResultTextLength(msg);
    if (totalTextChars <= maxChars) {
      return msg;
    }
    const newContent = content.map((block) => {
      if (!block || typeof block !== "object" || block.type !== "text") {
        return block;
      }
      const textBlock = block;
      if (typeof textBlock.text !== "string") {
        return block;
      }
      const blockShare = textBlock.text.length / totalTextChars;
      const blockBudget = Math.max(MIN_KEEP_CHARS, Math.floor(maxChars * blockShare));
      return {
        ...textBlock,
        text: truncateToolResultText(textBlock.text, blockBudget),
      };
    });
    return { ...msg, content: newContent };
  };
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { log } from "./logger.js";
import { ensureSessionFileDecrypted } from "./session-manager-cache.js";
const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;
export const HARD_MAX_TOOL_RESULT_CHARS = 400000;
const MIN_KEEP_CHARS = 2000;
const TRUNCATION_SUFFIX = `

\u26A0\uFE0F [Content truncated \u2014 original was too large for the model's context window. The content above is a partial view. If you need more, request specific sections or use offset/limit parameters to read smaller chunks.]`;
export function truncateToolResultText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  const keepChars = Math.max(MIN_KEEP_CHARS, maxChars - TRUNCATION_SUFFIX.length);
  let cutPoint = keepChars;
  const lastNewline = text.lastIndexOf("\n", keepChars);
  if (lastNewline > keepChars * 0.8) {
    cutPoint = lastNewline;
  }
  return text.slice(0, cutPoint) + TRUNCATION_SUFFIX;
}
export function calculateMaxToolResultChars(contextWindowTokens) {
  const maxTokens = Math.floor(contextWindowTokens * MAX_TOOL_RESULT_CONTEXT_SHARE);
  const maxChars = maxTokens * 4;
  return Math.min(maxChars, HARD_MAX_TOOL_RESULT_CHARS);
}
export async function truncateOversizedToolResultsInSession(params) {
  const { sessionFile, contextWindowTokens } = params;
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  try {
    ensureSessionFileDecrypted(sessionFile);
    const sessionManager = SessionManager.open(sessionFile);
    const branch = sessionManager.getBranch();
    if (branch.length === 0) {
      return { truncated: false, truncatedCount: 0, reason: "empty session" };
    }
    const oversizedIndices = [];
    for (let i = 0; i < branch.length; i++) {
      const entry = branch[i];
      if (entry.type !== "message") {
        continue;
      }
      const msg = entry.message;
      if (msg.role !== "toolResult") {
        continue;
      }
      const textLength = getToolResultTextLength(msg);
      if (textLength > maxChars) {
        oversizedIndices.push(i);
        log.info(
          `[tool-result-truncation] Found oversized tool result: entry=${entry.id} chars=${textLength} maxChars=${maxChars} sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
        );
      }
    }
    if (oversizedIndices.length === 0) {
      return { truncated: false, truncatedCount: 0, reason: "no oversized tool results" };
    }
    const firstOversizedIdx = oversizedIndices[0];
    const firstOversizedEntry = branch[firstOversizedIdx];
    const branchFromId = firstOversizedEntry.parentId;
    if (!branchFromId) {
      sessionManager.resetLeaf();
    } else {
      sessionManager.branch(branchFromId);
    }
    const oversizedSet = new Set(oversizedIndices);
    let truncatedCount = 0;
    for (let i = firstOversizedIdx; i < branch.length; i++) {
      const entry = branch[i];
      if (entry.type === "message") {
        let message = entry.message;
        if (oversizedSet.has(i)) {
          message = truncateToolResultMessage(message, maxChars);
          truncatedCount++;
          const newLength = getToolResultTextLength(message);
          log.info(
            `[tool-result-truncation] Truncated tool result: originalEntry=${entry.id} newChars=${newLength} sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
          );
        }
        sessionManager.appendMessage(message);
      } else if (entry.type === "compaction") {
        sessionManager.appendCompaction(
          entry.summary,
          entry.firstKeptEntryId,
          entry.tokensBefore,
          entry.details,
          entry.fromHook,
        );
      } else if (entry.type === "thinking_level_change") {
        sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
      } else if (entry.type === "model_change") {
        sessionManager.appendModelChange(entry.provider, entry.modelId);
      } else if (entry.type === "custom") {
        sessionManager.appendCustomEntry(entry.customType, entry.data);
      } else if (entry.type === "custom_message") {
        sessionManager.appendCustomMessageEntry(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
        );
      } else if (entry.type === "branch_summary") {
        continue;
      } else if (entry.type === "label") {
        continue;
      } else if (entry.type === "session_info") {
        if (entry.name) {
          sessionManager.appendSessionInfo(entry.name);
        }
      }
    }
    log.info(
      `[tool-result-truncation] Truncated ${truncatedCount} tool result(s) in session (contextWindow=${contextWindowTokens} maxChars=${maxChars}) sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
    );
    return { truncated: true, truncatedCount };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn(`[tool-result-truncation] Failed to truncate: ${errMsg}`);
    return { truncated: false, truncatedCount: 0, reason: errMsg };
  }
}
export function truncateOversizedToolResultsInMessages(messages, contextWindowTokens) {
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  let truncatedCount = 0;
  const result = messages.map((msg) => {
    if (msg.role !== "toolResult") {
      return msg;
    }
    const textLength = getToolResultTextLength(msg);
    if (textLength <= maxChars) {
      return msg;
    }
    truncatedCount++;
    return truncateToolResultMessage(msg, maxChars);
  });
  return { messages: result, truncatedCount };
}
export function isOversizedToolResult(msg, contextWindowTokens) {
  if (msg.role !== "toolResult") {
    return false;
  }
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  return getToolResultTextLength(msg) > maxChars;
}
export function sessionLikelyHasOversizedToolResults(params) {
  const { messages, contextWindowTokens } = params;
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  for (const msg of messages) {
    if (msg.role !== "toolResult") {
      continue;
    }
    const textLength = getToolResultTextLength(msg);
    if (textLength > maxChars) {
      return true;
    }
  }
  return false;
}
