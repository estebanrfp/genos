import { parseReplyDirectives } from "../auto-reply/reply/reply-directives.js";
import { createStreamingDirectiveAccumulator } from "../auto-reply/reply/streaming-directives.js";
import { formatToolAggregate } from "../auto-reply/tool-meta.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { buildCodeSpanIndex, createInlineCodeState } from "../markdown/code-spans.js";
import { EmbeddedBlockChunker } from "./pi-embedded-block-chunker.js";
import {
  isMessagingToolDuplicateNormalized,
  normalizeTextForComparison,
} from "./pi-embedded-helpers.js";
import { createEmbeddedPiSessionEventHandler } from "./pi-embedded-subscribe.handlers.js";
import { formatReasoningMessage, stripDowngradedToolCallText } from "./pi-embedded-utils.js";
import { hasNonzeroUsage, normalizeUsage } from "./usage.js";
const THINKING_TAG_SCAN_RE = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
const FINAL_TAG_SCAN_RE = /<\s*(\/?)\s*final\s*>/gi;
const log = createSubsystemLogger("agent/embedded");
export function subscribeEmbeddedPiSession(params) {
  const reasoningMode = params.reasoningMode ?? "off";
  const toolResultFormat = params.toolResultFormat ?? "markdown";
  const useMarkdown = toolResultFormat === "markdown";
  const state = {
    assistantTexts: [],
    toolMetas: [],
    toolMetaById: new Map(),
    toolSummaryById: new Set(),
    lastToolError: undefined,
    blockReplyBreak: params.blockReplyBreak ?? "text_end",
    reasoningMode,
    includeReasoning: reasoningMode === "on",
    shouldEmitPartialReplies: !(reasoningMode === "on" && !params.onBlockReply),
    streamReasoning: reasoningMode === "stream" && typeof params.onReasoningStream === "function",
    deltaBuffer: "",
    blockBuffer: "",
    blockState: { thinking: false, final: false, inlineCode: createInlineCodeState() },
    partialBlockState: { thinking: false, final: false, inlineCode: createInlineCodeState() },
    lastStreamedAssistant: undefined,
    lastStreamedAssistantCleaned: undefined,
    emittedAssistantUpdate: false,
    lastStreamedReasoning: undefined,
    lastBlockReplyText: undefined,
    reasoningStreamOpen: false,
    assistantMessageIndex: 0,
    lastAssistantTextMessageIndex: -1,
    lastAssistantTextNormalized: undefined,
    lastAssistantTextTrimmed: undefined,
    assistantTextBaseline: 0,
    suppressBlockChunks: false,
    lastReasoningSent: undefined,
    compactionInFlight: false,
    pendingCompactionRetry: 0,
    compactionRetryResolve: undefined,
    compactionRetryReject: undefined,
    compactionRetryPromise: null,
    unsubscribed: false,
    messagingToolSentTexts: [],
    messagingToolSentTextsNormalized: [],
    messagingToolSentTargets: [],
    messagingToolSentMediaUrls: [],
    pendingMessagingTexts: new Map(),
    pendingMessagingTargets: new Map(),
    successfulCronAdds: 0,
    pendingMessagingMediaUrls: new Map(),
  };
  const usageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  let compactionCount = 0;
  const assistantTexts = state.assistantTexts;
  const toolMetas = state.toolMetas;
  const toolMetaById = state.toolMetaById;
  const toolSummaryById = state.toolSummaryById;
  const messagingToolSentTexts = state.messagingToolSentTexts;
  const messagingToolSentTextsNormalized = state.messagingToolSentTextsNormalized;
  const messagingToolSentTargets = state.messagingToolSentTargets;
  const messagingToolSentMediaUrls = state.messagingToolSentMediaUrls;
  const pendingMessagingTexts = state.pendingMessagingTexts;
  const pendingMessagingTargets = state.pendingMessagingTargets;
  const replyDirectiveAccumulator = createStreamingDirectiveAccumulator();
  const partialReplyDirectiveAccumulator = createStreamingDirectiveAccumulator();
  const resetAssistantMessageState = (nextAssistantTextBaseline) => {
    state.deltaBuffer = "";
    state.blockBuffer = "";
    blockChunker?.reset();
    replyDirectiveAccumulator.reset();
    partialReplyDirectiveAccumulator.reset();
    state.blockState.thinking = false;
    state.blockState.final = false;
    state.blockState.inlineCode = createInlineCodeState();
    state.partialBlockState.thinking = false;
    state.partialBlockState.final = false;
    state.partialBlockState.inlineCode = createInlineCodeState();
    state.lastStreamedAssistant = undefined;
    state.lastStreamedAssistantCleaned = undefined;
    state.emittedAssistantUpdate = false;
    state.lastBlockReplyText = undefined;
    state.lastStreamedReasoning = undefined;
    state.lastReasoningSent = undefined;
    state.reasoningStreamOpen = false;
    state.suppressBlockChunks = false;
    state.assistantMessageIndex += 1;
    state.lastAssistantTextMessageIndex = -1;
    state.lastAssistantTextNormalized = undefined;
    state.lastAssistantTextTrimmed = undefined;
    state.assistantTextBaseline = nextAssistantTextBaseline;
  };
  const rememberAssistantText = (text) => {
    state.lastAssistantTextMessageIndex = state.assistantMessageIndex;
    state.lastAssistantTextTrimmed = text.trimEnd();
    const normalized = normalizeTextForComparison(text);
    state.lastAssistantTextNormalized = normalized.length > 0 ? normalized : undefined;
  };
  const shouldSkipAssistantText = (text) => {
    if (state.lastAssistantTextMessageIndex !== state.assistantMessageIndex) {
      return false;
    }
    const trimmed = text.trimEnd();
    if (trimmed && trimmed === state.lastAssistantTextTrimmed) {
      return true;
    }
    const normalized = normalizeTextForComparison(text);
    if (normalized.length > 0 && normalized === state.lastAssistantTextNormalized) {
      return true;
    }
    return false;
  };
  const pushAssistantText = (text) => {
    if (!text) {
      return;
    }
    if (shouldSkipAssistantText(text)) {
      return;
    }
    assistantTexts.push(text);
    rememberAssistantText(text);
  };
  const finalizeAssistantTexts = (args) => {
    const { text, addedDuringMessage, chunkerHasBuffered } = args;
    if (state.includeReasoning && text && !params.onBlockReply) {
      if (assistantTexts.length > state.assistantTextBaseline) {
        assistantTexts.splice(
          state.assistantTextBaseline,
          assistantTexts.length - state.assistantTextBaseline,
          text,
        );
        rememberAssistantText(text);
      } else {
        pushAssistantText(text);
      }
      state.suppressBlockChunks = true;
    } else if (!addedDuringMessage && !chunkerHasBuffered && text) {
      pushAssistantText(text);
    }
    state.assistantTextBaseline = assistantTexts.length;
  };
  const MAX_MESSAGING_SENT_TEXTS = 200;
  const MAX_MESSAGING_SENT_TARGETS = 200;
  const MAX_MESSAGING_SENT_MEDIA_URLS = 200;
  const trimMessagingToolSent = () => {
    if (messagingToolSentTexts.length > MAX_MESSAGING_SENT_TEXTS) {
      const overflow = messagingToolSentTexts.length - MAX_MESSAGING_SENT_TEXTS;
      messagingToolSentTexts.splice(0, overflow);
      messagingToolSentTextsNormalized.splice(0, overflow);
    }
    if (messagingToolSentTargets.length > MAX_MESSAGING_SENT_TARGETS) {
      const overflow = messagingToolSentTargets.length - MAX_MESSAGING_SENT_TARGETS;
      messagingToolSentTargets.splice(0, overflow);
    }
    if (messagingToolSentMediaUrls.length > MAX_MESSAGING_SENT_MEDIA_URLS) {
      const overflow = messagingToolSentMediaUrls.length - MAX_MESSAGING_SENT_MEDIA_URLS;
      messagingToolSentMediaUrls.splice(0, overflow);
    }
  };
  const ensureCompactionPromise = () => {
    if (!state.compactionRetryPromise) {
      state.compactionRetryPromise = new Promise((resolve, reject) => {
        state.compactionRetryResolve = resolve;
        state.compactionRetryReject = reject;
      });
      state.compactionRetryPromise.catch((err) => {
        log.debug(`compaction promise rejected (no waiter): ${String(err)}`);
      });
    }
  };
  const noteCompactionRetry = () => {
    state.pendingCompactionRetry += 1;
    ensureCompactionPromise();
  };
  const resolveCompactionRetry = () => {
    if (state.pendingCompactionRetry <= 0) {
      return;
    }
    state.pendingCompactionRetry -= 1;
    if (state.pendingCompactionRetry === 0 && !state.compactionInFlight) {
      state.compactionRetryResolve?.();
      state.compactionRetryResolve = undefined;
      state.compactionRetryReject = undefined;
      state.compactionRetryPromise = null;
    }
  };
  const maybeResolveCompactionWait = () => {
    if (state.pendingCompactionRetry === 0 && !state.compactionInFlight) {
      state.compactionRetryResolve?.();
      state.compactionRetryResolve = undefined;
      state.compactionRetryReject = undefined;
      state.compactionRetryPromise = null;
    }
  };
  const recordAssistantUsage = (usageLike) => {
    const usage = normalizeUsage(usageLike ?? undefined);
    if (!hasNonzeroUsage(usage)) {
      return;
    }
    usageTotals.input += usage.input ?? 0;
    usageTotals.output += usage.output ?? 0;
    usageTotals.cacheRead += usage.cacheRead ?? 0;
    usageTotals.cacheWrite += usage.cacheWrite ?? 0;
    const usageTotal =
      usage.total ??
      (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    usageTotals.total += usageTotal;
  };
  const getUsageTotals = () => {
    const hasUsage =
      usageTotals.input > 0 ||
      usageTotals.output > 0 ||
      usageTotals.cacheRead > 0 ||
      usageTotals.cacheWrite > 0 ||
      usageTotals.total > 0;
    if (!hasUsage) {
      return;
    }
    const derivedTotal =
      usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite;
    return {
      input: usageTotals.input || undefined,
      output: usageTotals.output || undefined,
      cacheRead: usageTotals.cacheRead || undefined,
      cacheWrite: usageTotals.cacheWrite || undefined,
      total: usageTotals.total || derivedTotal || undefined,
    };
  };
  const incrementCompactionCount = () => {
    compactionCount += 1;
  };
  const blockChunking = params.blockReplyChunking;
  const blockChunker = blockChunking ? new EmbeddedBlockChunker(blockChunking) : null;
  const shouldEmitToolResult = () =>
    typeof params.shouldEmitToolResult === "function"
      ? params.shouldEmitToolResult()
      : params.verboseLevel === "on" || params.verboseLevel === "full";
  const shouldEmitToolOutput = () =>
    typeof params.shouldEmitToolOutput === "function"
      ? params.shouldEmitToolOutput()
      : params.verboseLevel === "full";
  const formatToolOutputBlock = (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return "(no output)";
    }
    if (!useMarkdown) {
      return trimmed;
    }
    return `\`\`\`txt\n${trimmed}\n\`\`\``;
  };
  const emitToolSummary = (toolName, meta) => {
    if (!params.onToolResult) {
      return;
    }
    const agg = formatToolAggregate(toolName, meta ? [meta] : undefined, {
      markdown: useMarkdown,
    });
    const { text: cleanedText, mediaUrls } = parseReplyDirectives(agg);
    if (!cleanedText && (!mediaUrls || mediaUrls.length === 0)) {
      return;
    }
    try {
      params.onToolResult({
        text: cleanedText,
        mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
      });
    } catch {}
  };
  const emitToolOutput = (toolName, meta, output) => {
    if (!params.onToolResult || !output) {
      return;
    }
    const agg = formatToolAggregate(toolName, meta ? [meta] : undefined, {
      markdown: useMarkdown,
    });
    const message = `${agg}\n${formatToolOutputBlock(output)}`;
    const { text: cleanedText, mediaUrls } = parseReplyDirectives(message);
    if (!cleanedText && (!mediaUrls || mediaUrls.length === 0)) {
      return;
    }
    try {
      params.onToolResult({
        text: cleanedText,
        mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
      });
    } catch {}
  };
  const stripBlockTags = (text, state) => {
    if (!text) {
      return text;
    }
    const inlineStateStart = state.inlineCode ?? createInlineCodeState();
    const codeSpans = buildCodeSpanIndex(text, inlineStateStart);
    let processed = "";
    THINKING_TAG_SCAN_RE.lastIndex = 0;
    let lastIndex = 0;
    let inThinking = state.thinking;
    for (const match of text.matchAll(THINKING_TAG_SCAN_RE)) {
      const idx = match.index ?? 0;
      if (codeSpans.isInside(idx)) {
        continue;
      }
      if (!inThinking) {
        processed += text.slice(lastIndex, idx);
      }
      const isClose = match[1] === "/";
      inThinking = !isClose;
      lastIndex = idx + match[0].length;
    }
    if (!inThinking) {
      processed += text.slice(lastIndex);
    }
    state.thinking = inThinking;
    const finalCodeSpans = buildCodeSpanIndex(processed, inlineStateStart);
    if (!params.enforceFinalTag) {
      state.inlineCode = finalCodeSpans.inlineState;
      FINAL_TAG_SCAN_RE.lastIndex = 0;
      return stripTagsOutsideCodeSpans(processed, FINAL_TAG_SCAN_RE, finalCodeSpans.isInside);
    }
    let result = "";
    FINAL_TAG_SCAN_RE.lastIndex = 0;
    let lastFinalIndex = 0;
    let inFinal = state.final;
    let everInFinal = state.final;
    for (const match of processed.matchAll(FINAL_TAG_SCAN_RE)) {
      const idx = match.index ?? 0;
      if (finalCodeSpans.isInside(idx)) {
        continue;
      }
      const isClose = match[1] === "/";
      if (!inFinal && !isClose) {
        inFinal = true;
        everInFinal = true;
        lastFinalIndex = idx + match[0].length;
      } else if (inFinal && isClose) {
        result += processed.slice(lastFinalIndex, idx);
        inFinal = false;
        lastFinalIndex = idx + match[0].length;
      }
    }
    if (inFinal) {
      result += processed.slice(lastFinalIndex);
    }
    state.final = inFinal;
    if (!everInFinal) {
      return "";
    }
    const resultCodeSpans = buildCodeSpanIndex(result, inlineStateStart);
    state.inlineCode = resultCodeSpans.inlineState;
    return stripTagsOutsideCodeSpans(result, FINAL_TAG_SCAN_RE, resultCodeSpans.isInside);
  };
  const stripTagsOutsideCodeSpans = (text, pattern, isInside) => {
    let output = "";
    let lastIndex = 0;
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const idx = match.index ?? 0;
      if (isInside(idx)) {
        continue;
      }
      output += text.slice(lastIndex, idx);
      lastIndex = idx + match[0].length;
    }
    output += text.slice(lastIndex);
    return output;
  };
  const emitBlockChunk = (text) => {
    if (state.suppressBlockChunks) {
      return;
    }
    const chunk = stripDowngradedToolCallText(stripBlockTags(text, state.blockState)).trimEnd();
    if (!chunk) {
      return;
    }
    if (chunk === state.lastBlockReplyText) {
      return;
    }
    const normalizedChunk = normalizeTextForComparison(chunk);
    if (isMessagingToolDuplicateNormalized(normalizedChunk, messagingToolSentTextsNormalized)) {
      log.debug(`Skipping block reply - already sent via messaging tool: ${chunk.slice(0, 50)}...`);
      return;
    }
    if (shouldSkipAssistantText(chunk)) {
      return;
    }
    state.lastBlockReplyText = chunk;
    assistantTexts.push(chunk);
    rememberAssistantText(chunk);
    if (!params.onBlockReply) {
      return;
    }
    const splitResult = replyDirectiveAccumulator.consume(chunk);
    if (!splitResult) {
      return;
    }
    const {
      text: cleanedText,
      mediaUrls,
      audioAsVoice,
      replyToId,
      replyToTag,
      replyToCurrent,
    } = splitResult;
    if (!cleanedText && (!mediaUrls || mediaUrls.length === 0) && !audioAsVoice) {
      return;
    }
    params.onBlockReply({
      text: cleanedText,
      mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
      audioAsVoice,
      replyToId,
      replyToTag,
      replyToCurrent,
    });
  };
  const consumeReplyDirectives = (text, options) =>
    replyDirectiveAccumulator.consume(text, options);
  const consumePartialReplyDirectives = (text, options) =>
    partialReplyDirectiveAccumulator.consume(text, options);
  const flushBlockReplyBuffer = () => {
    if (!params.onBlockReply) {
      return;
    }
    if (blockChunker?.hasBuffered()) {
      blockChunker.drain({ force: true, emit: emitBlockChunk });
      blockChunker.reset();
      return;
    }
    if (state.blockBuffer.length > 0) {
      emitBlockChunk(state.blockBuffer);
      state.blockBuffer = "";
    }
  };
  const emitReasoningStream = (text) => {
    if (!state.streamReasoning || !params.onReasoningStream) {
      return;
    }
    const formatted = formatReasoningMessage(text);
    if (!formatted) {
      return;
    }
    if (formatted === state.lastStreamedReasoning) {
      return;
    }
    const prior = state.lastStreamedReasoning ?? "";
    const delta = formatted.startsWith(prior) ? formatted.slice(prior.length) : formatted;
    state.lastStreamedReasoning = formatted;
    emitAgentEvent({
      runId: params.runId,
      stream: "thinking",
      data: {
        text: formatted,
        delta,
      },
    });
    params.onReasoningStream({
      text: formatted,
    });
  };
  const resetForCompactionRetry = () => {
    assistantTexts.length = 0;
    toolMetas.length = 0;
    toolMetaById.clear();
    toolSummaryById.clear();
    state.lastToolError = undefined;
    messagingToolSentTexts.length = 0;
    messagingToolSentTextsNormalized.length = 0;
    messagingToolSentTargets.length = 0;
    messagingToolSentMediaUrls.length = 0;
    pendingMessagingTexts.clear();
    pendingMessagingTargets.clear();
    state.successfulCronAdds = 0;
    state.pendingMessagingMediaUrls.clear();
    resetAssistantMessageState(0);
  };
  const noteLastAssistant = (msg) => {
    if (msg?.role === "assistant") {
      state.lastAssistant = msg;
    }
  };
  const ctx = {
    params,
    state,
    log,
    blockChunking,
    blockChunker,
    hookRunner: params.hookRunner,
    noteLastAssistant,
    shouldEmitToolResult,
    shouldEmitToolOutput,
    emitToolSummary,
    emitToolOutput,
    stripBlockTags,
    emitBlockChunk,
    flushBlockReplyBuffer,
    emitReasoningStream,
    consumeReplyDirectives,
    consumePartialReplyDirectives,
    resetAssistantMessageState,
    resetForCompactionRetry,
    finalizeAssistantTexts,
    trimMessagingToolSent,
    ensureCompactionPromise,
    noteCompactionRetry,
    resolveCompactionRetry,
    maybeResolveCompactionWait,
    recordAssistantUsage,
    incrementCompactionCount,
    getUsageTotals,
    getCompactionCount: () => compactionCount,
  };
  const sessionUnsubscribe = params.session.subscribe(createEmbeddedPiSessionEventHandler(ctx));
  const unsubscribe = () => {
    if (state.unsubscribed) {
      return;
    }
    state.unsubscribed = true;
    if (state.compactionRetryPromise) {
      log.debug(`unsubscribe: rejecting compaction wait runId=${params.runId}`);
      const reject = state.compactionRetryReject;
      state.compactionRetryResolve = undefined;
      state.compactionRetryReject = undefined;
      state.compactionRetryPromise = null;
      const abortErr = new Error("Unsubscribed during compaction");
      abortErr.name = "AbortError";
      reject?.(abortErr);
    }
    if (params.session.isCompacting) {
      log.debug(`unsubscribe: aborting in-flight compaction runId=${params.runId}`);
      try {
        params.session.abortCompaction();
      } catch (err) {
        log.warn(`unsubscribe: compaction abort failed runId=${params.runId} err=${String(err)}`);
      }
    }
    sessionUnsubscribe();
  };
  return {
    assistantTexts,
    toolMetas,
    unsubscribe,
    isCompacting: () => state.compactionInFlight || state.pendingCompactionRetry > 0,
    isCompactionInFlight: () => state.compactionInFlight,
    getMessagingToolSentTexts: () => messagingToolSentTexts.slice(),
    getMessagingToolSentMediaUrls: () => messagingToolSentMediaUrls.slice(),
    getMessagingToolSentTargets: () => messagingToolSentTargets.slice(),
    getSuccessfulCronAdds: () => state.successfulCronAdds,
    didSendViaMessagingTool: () => messagingToolSentTexts.length > 0,
    getLastToolError: () => (state.lastToolError ? { ...state.lastToolError } : undefined),
    getUsageTotals,
    getCompactionCount: () => compactionCount,
    waitForCompactionRetry: () => {
      if (state.unsubscribed) {
        const err = new Error("Unsubscribed during compaction wait");
        err.name = "AbortError";
        return Promise.reject(err);
      }
      if (state.compactionInFlight || state.pendingCompactionRetry > 0) {
        ensureCompactionPromise();
        return state.compactionRetryPromise ?? Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        queueMicrotask(() => {
          if (state.unsubscribed) {
            const err = new Error("Unsubscribed during compaction wait");
            err.name = "AbortError";
            reject(err);
            return;
          }
          if (state.compactionInFlight || state.pendingCompactionRetry > 0) {
            ensureCompactionPromise();
            (state.compactionRetryPromise ?? Promise.resolve()).then(resolve, reject);
          } else {
            resolve();
          }
        });
      });
    },
  };
}
