let isToolCallBlock = function (block) {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = block.type;
    return (
      typeof type === "string" &&
      (type === "toolCall" || type === "toolUse" || type === "functionCall")
    );
  },
  hasToolCallInput = function (block) {
    const hasInput = "input" in block ? block.input !== undefined && block.input !== null : false;
    const hasArguments =
      "arguments" in block ? block.arguments !== undefined && block.arguments !== null : false;
    return hasInput || hasArguments;
  },
  hasNonEmptyStringField = function (value) {
    return typeof value === "string" && value.trim().length > 0;
  },
  hasToolCallId = function (block) {
    return hasNonEmptyStringField(block.id);
  },
  hasToolCallName = function (block) {
    return hasNonEmptyStringField(block.name);
  },
  makeMissingToolResult = function (params) {
    return {
      role: "toolResult",
      toolCallId: params.toolCallId,
      toolName: params.toolName ?? "unknown",
      content: [
        {
          type: "text",
          text: "[genosos] missing tool result in session history; inserted synthetic error result for transcript repair.",
        },
      ],
      isError: true,
      timestamp: Date.now(),
    };
  };
import { extractToolCallsFromAssistant, extractToolResultId } from "./tool-call-id.js";

export { makeMissingToolResult };
export function stripToolResultDetails(messages) {
  let touched = false;
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || msg.role !== "toolResult") {
      out.push(msg);
      continue;
    }
    if (!("details" in msg)) {
      out.push(msg);
      continue;
    }
    const { details: _details, ...rest } = msg;
    touched = true;
    out.push(rest);
  }
  return touched ? out : messages;
}
export function repairToolCallInputs(messages) {
  let droppedToolCalls = 0;
  let droppedAssistantMessages = 0;
  let changed = false;
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }
    const nextContent = [];
    let droppedInMessage = 0;
    for (const block of msg.content) {
      if (
        isToolCallBlock(block) &&
        (!hasToolCallInput(block) || !hasToolCallId(block) || !hasToolCallName(block))
      ) {
        droppedToolCalls += 1;
        droppedInMessage += 1;
        changed = true;
        continue;
      }
      nextContent.push(block);
    }
    if (droppedInMessage > 0) {
      if (nextContent.length === 0) {
        droppedAssistantMessages += 1;
        changed = true;
        continue;
      }
      out.push({ ...msg, content: nextContent });
      continue;
    }
    out.push(msg);
  }
  return {
    messages: changed ? out : messages,
    droppedToolCalls,
    droppedAssistantMessages,
  };
}
export function sanitizeToolCallInputs(messages) {
  return repairToolCallInputs(messages).messages;
}
export function sanitizeToolUseResultPairing(messages) {
  return repairToolUseResultPairing(messages).messages;
}
export function repairToolUseResultPairing(messages) {
  const out = [];
  const added = [];
  const seenToolResultIds = new Set();
  let droppedDuplicateCount = 0;
  let droppedOrphanCount = 0;
  let moved = false;
  let changed = false;
  const pushToolResult = (msg) => {
    const id = extractToolResultId(msg);
    if (id && seenToolResultIds.has(id)) {
      droppedDuplicateCount += 1;
      changed = true;
      return;
    }
    if (id) {
      seenToolResultIds.add(id);
    }
    out.push(msg);
  };
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }
    const role = msg.role;
    if (role !== "assistant") {
      if (role !== "toolResult") {
        out.push(msg);
      } else {
        droppedOrphanCount += 1;
        changed = true;
      }
      continue;
    }
    const assistant = msg;
    const stopReason = assistant.stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      out.push(msg);
      continue;
    }
    const toolCalls = extractToolCallsFromAssistant(assistant);
    if (toolCalls.length === 0) {
      out.push(msg);
      continue;
    }
    const toolCallIds = new Set(toolCalls.map((t) => t.id));
    const spanResultsById = new Map();
    const remainder = [];
    let j = i + 1;
    for (; j < messages.length; j += 1) {
      const next = messages[j];
      if (!next || typeof next !== "object") {
        remainder.push(next);
        continue;
      }
      const nextRole = next.role;
      if (nextRole === "assistant") {
        break;
      }
      if (nextRole === "toolResult") {
        const toolResult = next;
        const id = extractToolResultId(toolResult);
        if (id && toolCallIds.has(id)) {
          if (seenToolResultIds.has(id)) {
            droppedDuplicateCount += 1;
            changed = true;
            continue;
          }
          if (!spanResultsById.has(id)) {
            spanResultsById.set(id, toolResult);
          }
          continue;
        }
      }
      if (nextRole !== "toolResult") {
        remainder.push(next);
      } else {
        droppedOrphanCount += 1;
        changed = true;
      }
    }
    out.push(msg);
    if (spanResultsById.size > 0 && remainder.length > 0) {
      moved = true;
      changed = true;
    }
    for (const call of toolCalls) {
      const existing = spanResultsById.get(call.id);
      if (existing) {
        pushToolResult(existing);
      } else {
        const missing = makeMissingToolResult({
          toolCallId: call.id,
          toolName: call.name,
        });
        added.push(missing);
        changed = true;
        pushToolResult(missing);
      }
    }
    for (const rem of remainder) {
      if (!rem || typeof rem !== "object") {
        out.push(rem);
        continue;
      }
      out.push(rem);
    }
    i = j - 1;
  }
  const changedOrMoved = changed || moved;
  return {
    messages: changedOrMoved ? out : messages,
    added,
    droppedDuplicateCount,
    droppedOrphanCount,
    moved: changedOrMoved,
  };
}
