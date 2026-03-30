let capToolResultSize = function (msg) {
  const role = msg.role;
  if (role !== "toolResult") {
    return msg;
  }
  const content = msg.content;
  if (!Array.isArray(content)) {
    return msg;
  }
  let totalTextChars = 0;
  for (const block of content) {
    if (block && typeof block === "object" && block.type === "text") {
      const text = block.text;
      if (typeof text === "string") {
        totalTextChars += text.length;
      }
    }
  }
  if (totalTextChars <= HARD_MAX_TOOL_RESULT_CHARS) {
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
    const blockBudget = Math.max(
      2000,
      Math.floor(HARD_MAX_TOOL_RESULT_CHARS * blockShare) - GUARD_TRUNCATION_SUFFIX.length,
    );
    if (textBlock.text.length <= blockBudget) {
      return block;
    }
    let cutPoint = blockBudget;
    const lastNewline = textBlock.text.lastIndexOf("\n", blockBudget);
    if (lastNewline > blockBudget * 0.8) {
      cutPoint = lastNewline;
    }
    return {
      ...textBlock,
      text: textBlock.text.slice(0, cutPoint) + GUARD_TRUNCATION_SUFFIX,
    };
  });
  return { ...msg, content: newContent };
};
import { emitSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import { HARD_MAX_TOOL_RESULT_CHARS } from "./pi-embedded-runner/tool-result-truncation.js";
import { makeMissingToolResult, sanitizeToolCallInputs } from "./session-transcript-repair.js";
import { extractToolCallsFromAssistant, extractToolResultId } from "./tool-call-id.js";
const GUARD_TRUNCATION_SUFFIX = `

\u26A0\uFE0F [Content truncated during persistence \u2014 original exceeded size limit. Use offset/limit parameters or request specific sections for large content.]`;
export function installSessionToolResultGuard(sessionManager, opts) {
  const originalAppend = sessionManager.appendMessage.bind(sessionManager);
  const pending = new Map();
  const persistMessage = (message) => {
    const transformer = opts?.transformMessageForPersistence;
    return transformer ? transformer(message) : message;
  };
  const persistToolResult = (message, meta) => {
    const transformer = opts?.transformToolResultForPersistence;
    return transformer ? transformer(message, meta) : message;
  };
  const allowSyntheticToolResults = opts?.allowSyntheticToolResults ?? true;
  const beforeWrite = opts?.beforeMessageWriteHook;
  const applyBeforeWriteHook = (msg) => {
    if (!beforeWrite) {
      return msg;
    }
    const result = beforeWrite({ message: msg });
    if (result?.block) {
      return null;
    }
    if (result?.message) {
      return result.message;
    }
    return msg;
  };
  const flushPendingToolResults = () => {
    if (pending.size === 0) {
      return;
    }
    if (allowSyntheticToolResults) {
      for (const [id, name] of pending.entries()) {
        const synthetic = makeMissingToolResult({ toolCallId: id, toolName: name });
        const flushed = applyBeforeWriteHook(
          persistToolResult(persistMessage(synthetic), {
            toolCallId: id,
            toolName: name,
            isSynthetic: true,
          }),
        );
        if (flushed) {
          originalAppend(flushed);
        }
      }
    }
    pending.clear();
  };
  const guardedAppend = (message) => {
    let nextMessage = message;
    const role = message.role;
    if (role === "assistant") {
      const sanitized = sanitizeToolCallInputs([message]);
      if (sanitized.length === 0) {
        if (allowSyntheticToolResults && pending.size > 0) {
          flushPendingToolResults();
        }
        return;
      }
      nextMessage = sanitized[0];
    }
    const nextRole = nextMessage.role;
    if (nextRole === "toolResult") {
      const id = extractToolResultId(nextMessage);
      const toolName = id ? pending.get(id) : undefined;
      if (id) {
        pending.delete(id);
      }
      const capped = capToolResultSize(persistMessage(nextMessage));
      const persisted = applyBeforeWriteHook(
        persistToolResult(capped, {
          toolCallId: id ?? undefined,
          toolName,
          isSynthetic: false,
        }),
      );
      if (!persisted) {
        return;
      }
      return originalAppend(persisted);
    }
    const toolCalls = nextRole === "assistant" ? extractToolCallsFromAssistant(nextMessage) : [];
    if (allowSyntheticToolResults) {
      if (pending.size > 0 && (toolCalls.length === 0 || nextRole !== "assistant")) {
        flushPendingToolResults();
      }
      if (pending.size > 0 && toolCalls.length > 0) {
        flushPendingToolResults();
      }
    }
    const finalMessage = applyBeforeWriteHook(persistMessage(nextMessage));
    if (!finalMessage) {
      return;
    }
    const result = originalAppend(finalMessage);
    const sessionFile = sessionManager.getSessionFile?.();
    if (sessionFile) {
      emitSessionTranscriptUpdate(sessionFile);
    }
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        pending.set(call.id, call.name);
      }
    }
    return result;
  };
  sessionManager.appendMessage = guardedAppend;
  return {
    flushPendingToolResults,
    getPendingIds: () => Array.from(pending.keys()),
  };
}
