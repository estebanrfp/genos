let normalizeFailureText = function (text) {
    return text.replace(/\s+/g, " ").trim();
  },
  truncateFailureText = function (text, maxChars) {
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
  },
  formatToolFailureMeta = function (details) {
    if (!details || typeof details !== "object") {
      return;
    }
    const record = details;
    const status = typeof record.status === "string" ? record.status : undefined;
    const exitCode =
      typeof record.exitCode === "number" && Number.isFinite(record.exitCode)
        ? record.exitCode
        : undefined;
    const parts = [];
    if (status) {
      parts.push(`status=${status}`);
    }
    if (exitCode !== undefined) {
      parts.push(`exitCode=${exitCode}`);
    }
    return parts.length > 0 ? parts.join(" ") : undefined;
  },
  extractToolResultText = function (content) {
    return collectTextContentBlocks(content).join("\n");
  },
  collectToolFailures = function (messages) {
    const failures = [];
    const seen = new Set();
    for (const message of messages) {
      if (!message || typeof message !== "object") {
        continue;
      }
      const role = message.role;
      if (role !== "toolResult") {
        continue;
      }
      const toolResult = message;
      if (toolResult.isError !== true) {
        continue;
      }
      const toolCallId = typeof toolResult.toolCallId === "string" ? toolResult.toolCallId : "";
      if (!toolCallId || seen.has(toolCallId)) {
        continue;
      }
      seen.add(toolCallId);
      const toolName =
        typeof toolResult.toolName === "string" && toolResult.toolName.trim()
          ? toolResult.toolName
          : "tool";
      const rawText = extractToolResultText(toolResult.content);
      const meta = formatToolFailureMeta(toolResult.details);
      const normalized = normalizeFailureText(rawText);
      const summary = truncateFailureText(
        normalized || (meta ? "failed" : "failed (no output)"),
        MAX_TOOL_FAILURE_CHARS,
      );
      failures.push({ toolCallId, toolName, summary, meta });
    }
    return failures;
  },
  formatToolFailuresSection = function (failures) {
    if (failures.length === 0) {
      return "";
    }
    const lines = failures.slice(0, MAX_TOOL_FAILURES).map((failure) => {
      const meta = failure.meta ? ` (${failure.meta})` : "";
      return `- ${failure.toolName}${meta}: ${failure.summary}`;
    });
    if (failures.length > MAX_TOOL_FAILURES) {
      lines.push(`- ...and ${failures.length - MAX_TOOL_FAILURES} more`);
    }
    return `\n\n## Tool Failures\n${lines.join("\n")}`;
  },
  computeFileLists = function (fileOps) {
    const modified = new Set([...fileOps.edited, ...fileOps.written]);
    const readFiles = [...fileOps.read].filter((f) => !modified.has(f)).toSorted();
    const modifiedFiles = [...modified].toSorted();
    return { readFiles, modifiedFiles };
  },
  formatFileOperations = function (readFiles, modifiedFiles) {
    const sections = [];
    if (readFiles.length > 0) {
      sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
    }
    if (modifiedFiles.length > 0) {
      sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
    }
    if (sections.length === 0) {
      return "";
    }
    return `\n\n${sections.join("\n\n")}`;
  };
import fs from "node:fs";
import path from "node:path";
import { extractSections } from "../../auto-reply/reply/post-compaction-context.js";
import {
  BASE_CHUNK_RATIO,
  MIN_CHUNK_RATIO,
  SAFETY_MARGIN,
  computeAdaptiveChunkRatio,
  estimateMessagesTokens,
  isOversizedForSummary,
  pruneHistoryForContextShare,
  resolveContextWindowTokens,
  summarizeInStages,
} from "../compaction.js";
import { collectTextContentBlocks } from "../content-blocks.js";
import { getCompactionSafeguardRuntime } from "./compaction-safeguard-runtime.js";
const FALLBACK_SUMMARY =
  "Summary unavailable due to context limits. Older messages were truncated.";
const TURN_PREFIX_INSTRUCTIONS =
  "This summary covers the prefix of a split turn. Focus on the original request, early progress, and any details needed to understand the retained suffix.";
const MAX_TOOL_FAILURES = 8;
const MAX_TOOL_FAILURE_CHARS = 240;
async function readWorkspaceContextForSummary() {
  const MAX_SUMMARY_CONTEXT_CHARS = 2000;
  const workspaceDir = process.cwd();
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  try {
    if (!fs.existsSync(agentsPath)) {
      return "";
    }
    const content = await fs.promises.readFile(agentsPath, "utf-8");
    const sections = extractSections(content, ["Session Startup", "Red Lines"]);
    if (sections.length === 0) {
      return "";
    }
    const combined = sections.join("\n\n");
    const safeContent =
      combined.length > MAX_SUMMARY_CONTEXT_CHARS
        ? combined.slice(0, MAX_SUMMARY_CONTEXT_CHARS) + "\n...[truncated]..."
        : combined;
    return `\n\n<workspace-critical-rules>\n${safeContent}\n</workspace-critical-rules>`;
  } catch {
    return "";
  }
}
export default function compactionSafeguardExtension(api) {
  api.on("session_before_compact", async (event, ctx) => {
    const { preparation, customInstructions, signal } = event;
    const { readFiles, modifiedFiles } = computeFileLists(preparation.fileOps);
    const fileOpsSummary = formatFileOperations(readFiles, modifiedFiles);
    const toolFailures = collectToolFailures([
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
    ]);
    const toolFailureSection = formatToolFailuresSection(toolFailures);
    const fallbackSummary = `${FALLBACK_SUMMARY}${toolFailureSection}${fileOpsSummary}`;
    const model = ctx.model;
    if (!model) {
      return {
        compaction: {
          summary: fallbackSummary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          details: { readFiles, modifiedFiles },
        },
      };
    }
    const apiKey = await ctx.modelRegistry.getApiKey(model);
    if (!apiKey) {
      return {
        compaction: {
          summary: fallbackSummary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          details: { readFiles, modifiedFiles },
        },
      };
    }
    try {
      const runtime = getCompactionSafeguardRuntime(ctx.sessionManager);
      const modelContextWindow = resolveContextWindowTokens(model);
      const contextWindowTokens = runtime?.contextWindowTokens ?? modelContextWindow;
      const turnPrefixMessages = preparation.turnPrefixMessages ?? [];
      let messagesToSummarize = preparation.messagesToSummarize;
      const maxHistoryShare = runtime?.maxHistoryShare ?? 0.5;
      const tokensBefore =
        typeof preparation.tokensBefore === "number" && Number.isFinite(preparation.tokensBefore)
          ? preparation.tokensBefore
          : undefined;
      let droppedSummary;
      if (tokensBefore !== undefined) {
        const summarizableTokens =
          estimateMessagesTokens(messagesToSummarize) + estimateMessagesTokens(turnPrefixMessages);
        const newContentTokens = Math.max(0, Math.floor(tokensBefore - summarizableTokens));
        const maxHistoryTokens = Math.floor(contextWindowTokens * maxHistoryShare * SAFETY_MARGIN);
        if (newContentTokens > maxHistoryTokens) {
          const pruned = pruneHistoryForContextShare({
            messages: messagesToSummarize,
            maxContextTokens: contextWindowTokens,
            maxHistoryShare,
            parts: 2,
          });
          if (pruned.droppedChunks > 0) {
            const newContentRatio = (newContentTokens / contextWindowTokens) * 100;
            console.warn(
              `Compaction safeguard: new content uses ${newContentRatio.toFixed(1)}% of context; dropped ${pruned.droppedChunks} older chunk(s) (${pruned.droppedMessages} messages) to fit history budget.`,
            );
            messagesToSummarize = pruned.messages;
            if (pruned.droppedMessagesList.length > 0) {
              try {
                const droppedChunkRatio = computeAdaptiveChunkRatio(
                  pruned.droppedMessagesList,
                  contextWindowTokens,
                );
                const droppedMaxChunkTokens = Math.max(
                  1,
                  Math.floor(contextWindowTokens * droppedChunkRatio),
                );
                droppedSummary = await summarizeInStages({
                  messages: pruned.droppedMessagesList,
                  model,
                  apiKey,
                  signal,
                  reserveTokens: Math.max(1, Math.floor(preparation.settings.reserveTokens)),
                  maxChunkTokens: droppedMaxChunkTokens,
                  contextWindow: contextWindowTokens,
                  customInstructions,
                  previousSummary: preparation.previousSummary,
                });
              } catch (droppedError) {
                console.warn(
                  `Compaction safeguard: failed to summarize dropped messages, continuing without: ${droppedError instanceof Error ? droppedError.message : String(droppedError)}`,
                );
              }
            }
          }
        }
      }
      const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
      const adaptiveRatio = computeAdaptiveChunkRatio(allMessages, contextWindowTokens);
      const maxChunkTokens = Math.max(1, Math.floor(contextWindowTokens * adaptiveRatio));
      const reserveTokens = Math.max(1, Math.floor(preparation.settings.reserveTokens));
      const effectivePreviousSummary = droppedSummary ?? preparation.previousSummary;
      const historySummary = await summarizeInStages({
        messages: messagesToSummarize,
        model,
        apiKey,
        signal,
        reserveTokens,
        maxChunkTokens,
        contextWindow: contextWindowTokens,
        customInstructions,
        previousSummary: effectivePreviousSummary,
      });
      let summary = historySummary;
      if (preparation.isSplitTurn && turnPrefixMessages.length > 0) {
        const prefixSummary = await summarizeInStages({
          messages: turnPrefixMessages,
          model,
          apiKey,
          signal,
          reserveTokens,
          maxChunkTokens,
          contextWindow: contextWindowTokens,
          customInstructions: TURN_PREFIX_INSTRUCTIONS,
          previousSummary: undefined,
        });
        summary = `${historySummary}\n\n---\n\n**Turn Context (split turn):**\n\n${prefixSummary}`;
      }
      summary += toolFailureSection;
      summary += fileOpsSummary;
      const workspaceContext = await readWorkspaceContextForSummary();
      if (workspaceContext) {
        summary += workspaceContext;
      }
      return {
        compaction: {
          summary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          details: { readFiles, modifiedFiles },
        },
      };
    } catch (error) {
      console.warn(
        `Compaction summarization failed; truncating history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        compaction: {
          summary: fallbackSummary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          details: { readFiles, modifiedFiles },
        },
      };
    }
  });
}
export const __testing = {
  collectToolFailures,
  formatToolFailuresSection,
  computeAdaptiveChunkRatio,
  isOversizedForSummary,
  BASE_CHUNK_RATIO,
  MIN_CHUNK_RATIO,
  SAFETY_MARGIN,
};
