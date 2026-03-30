import crypto from "node:crypto";
import fs from "node:fs";
import { runCliAgent } from "../../agents/cli-runner.js";
import { getCliSessionId } from "../../agents/cli-session.js";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import { isCliProvider } from "../../agents/model-selection.js";
import {
  isCompactionFailureError,
  isContextOverflowError,
  isLikelyContextOverflowError,
  isTransientHttpError,
  sanitizeUserFacingText,
} from "../../agents/pi-embedded-helpers.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import {
  resolveGroupSessionKey,
  resolveSessionTranscriptPath,
  updateSessionStore,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent, registerAgentRunContext } from "../../infra/agent-events.js";
import { defaultRuntime } from "../../runtime.js";
import {
  isMarkdownCapableMessageChannel,
  resolveMessageChannel,
} from "../../utils/message-channel.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../tokens.js";
import {
  buildEmbeddedRunBaseParams,
  buildEmbeddedRunContexts,
  resolveModelFallbackOptions,
} from "./agent-runner-utils.js";
import { createBlockReplyDeliveryHandler } from "./reply-delivery.js";
export async function runAgentTurnWithFallback(params) {
  const TRANSIENT_HTTP_RETRY_DELAY_MS = 2500;
  let didLogHeartbeatStrip = false;
  let autoCompactionCompleted = false;
  const directlySentBlockKeys = new Set();
  const runId = params.opts?.runId ?? crypto.randomUUID();
  params.opts?.onAgentRunStart?.(runId);
  if (params.sessionKey) {
    registerAgentRunContext(runId, {
      sessionKey: params.sessionKey,
      verboseLevel: params.resolvedVerboseLevel,
      isHeartbeat: params.isHeartbeat,
    });
  }
  let runResult;
  let fallbackProvider = params.followupRun.run.provider;
  let fallbackModel = params.followupRun.run.model;
  let didResetAfterCompactionFailure = false;
  let didRetryTransientHttpError = false;
  // Tracks whether the underlying SDK/CLI was actually invoked at least once.
  // If false when an error is caught, we must emit a lifecycle event manually
  // (the SDK never ran so it never emitted one, which would leave the chat UI stuck).
  let sdkAttempted = false;
  while (true) {
    try {
      const normalizeStreamingText = (payload) => {
        let text = payload.text;
        if (!params.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
          const stripped = stripHeartbeatToken(text, {
            mode: "message",
          });
          if (stripped.didStrip && !didLogHeartbeatStrip) {
            didLogHeartbeatStrip = true;
            logVerbose("Stripped stray HEARTBEAT_OK token from reply");
          }
          if (stripped.shouldSkip && (payload.mediaUrls?.length ?? 0) === 0) {
            return { skip: true };
          }
          text = stripped.text;
        }
        if (isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
          return { skip: true };
        }
        if (!text) {
          if ((payload.mediaUrls?.length ?? 0) > 0) {
            return { text: undefined, skip: false };
          }
          return { skip: true };
        }
        const sanitized = sanitizeUserFacingText(text, {
          errorContext: Boolean(payload.isError),
        });
        if (!sanitized.trim()) {
          return { skip: true };
        }
        return { text: sanitized, skip: false };
      };
      const handlePartialForTyping = async (payload) => {
        const { text, skip } = normalizeStreamingText(payload);
        if (skip || !text) {
          return;
        }
        await params.typingSignals.signalTextDelta(text);
        return text;
      };
      const blockReplyPipeline = params.blockReplyPipeline;
      const onToolResult = params.opts?.onToolResult;
      const fallbackResult = await runWithModelFallback({
        ...resolveModelFallbackOptions(params.followupRun.run),
        run: (provider, model) => {
          sdkAttempted = true;
          params.opts?.onModelSelected?.({
            provider,
            model,
            thinkLevel: params.followupRun.run.thinkLevel,
          });
          if (isCliProvider(provider, params.followupRun.run.config)) {
            const startedAt = Date.now();
            emitAgentEvent({
              runId,
              stream: "lifecycle",
              data: {
                phase: "start",
                startedAt,
              },
            });
            const cliSessionId = getCliSessionId(params.getActiveSessionEntry(), provider);
            return (async () => {
              let lifecycleTerminalEmitted = false;
              try {
                const result = await runCliAgent({
                  sessionId: params.followupRun.run.sessionId,
                  sessionKey: params.sessionKey,
                  agentId: params.followupRun.run.agentId,
                  sessionFile: params.followupRun.run.sessionFile,
                  workspaceDir: params.followupRun.run.workspaceDir,
                  config: params.followupRun.run.config,
                  prompt: params.commandBody,
                  provider,
                  model,
                  thinkLevel: params.followupRun.run.thinkLevel,
                  timeoutMs: params.followupRun.run.timeoutMs,
                  runId,
                  extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
                  ownerNumbers: params.followupRun.run.ownerNumbers,
                  cliSessionId,
                  images: params.opts?.images,
                });
                const cliText = result.payloads?.[0]?.text?.trim();
                if (cliText) {
                  emitAgentEvent({
                    runId,
                    stream: "assistant",
                    data: { text: cliText },
                  });
                }
                emitAgentEvent({
                  runId,
                  stream: "lifecycle",
                  data: {
                    phase: "end",
                    startedAt,
                    endedAt: Date.now(),
                  },
                });
                lifecycleTerminalEmitted = true;
                return result;
              } catch (err) {
                emitAgentEvent({
                  runId,
                  stream: "lifecycle",
                  data: {
                    phase: "error",
                    startedAt,
                    endedAt: Date.now(),
                    error: String(err),
                  },
                });
                lifecycleTerminalEmitted = true;
                throw err;
              } finally {
                if (!lifecycleTerminalEmitted) {
                  emitAgentEvent({
                    runId,
                    stream: "lifecycle",
                    data: {
                      phase: "error",
                      startedAt,
                      endedAt: Date.now(),
                      error: "CLI run completed without lifecycle terminal event",
                    },
                  });
                }
              }
            })();
          }
          const { authProfile, embeddedContext, senderContext } = buildEmbeddedRunContexts({
            run: params.followupRun.run,
            sessionCtx: params.sessionCtx,
            hasRepliedRef: params.opts?.hasRepliedRef,
            provider,
          });
          const runBaseParams = buildEmbeddedRunBaseParams({
            run: params.followupRun.run,
            provider,
            model,
            runId,
            authProfile,
          });
          const ownerName = params.followupRun.run.config?.owner?.displayName;
          const inputProvenance =
            senderContext.senderName || !ownerName
              ? undefined
              : { kind: "external_user", sourceChannel: "webchat", humanName: ownerName };
          return runEmbeddedPiAgent({
            ...embeddedContext,
            groupId: resolveGroupSessionKey(params.sessionCtx)?.id,
            groupChannel:
              params.sessionCtx.GroupChannel?.trim() ?? params.sessionCtx.GroupSubject?.trim(),
            groupSpace: params.sessionCtx.GroupSpace?.trim() ?? undefined,
            ...senderContext,
            ...runBaseParams,
            inputProvenance,
            prompt: params.commandBody,
            extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
            toolResultFormat: (() => {
              const channel = resolveMessageChannel(
                params.sessionCtx.Surface,
                params.sessionCtx.Provider,
              );
              if (!channel) {
                return "markdown";
              }
              return isMarkdownCapableMessageChannel(channel) ? "markdown" : "plain";
            })(),
            suppressToolErrorWarnings: params.opts?.suppressToolErrorWarnings,
            images: params.opts?.images,
            abortSignal: params.opts?.abortSignal,
            blockReplyBreak: params.resolvedBlockStreamingBreak,
            blockReplyChunking: params.blockReplyChunking,
            onPartialReply: async (payload) => {
              const textForTyping = await handlePartialForTyping(payload);
              if (!params.opts?.onPartialReply || textForTyping === undefined) {
                return;
              }
              await params.opts.onPartialReply({
                text: textForTyping,
                mediaUrls: payload.mediaUrls,
              });
            },
            onAssistantMessageStart: async () => {
              await params.typingSignals.signalMessageStart();
              await params.opts?.onAssistantMessageStart?.();
            },
            onReasoningStream:
              params.typingSignals.shouldStartOnReasoning || params.opts?.onReasoningStream
                ? async (payload) => {
                    await params.typingSignals.signalReasoningDelta();
                    await params.opts?.onReasoningStream?.({
                      text: payload.text,
                      mediaUrls: payload.mediaUrls,
                    });
                  }
                : undefined,
            onReasoningEnd: params.opts?.onReasoningEnd,
            onAgentEvent: async (evt) => {
              if (evt.stream === "tool") {
                const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                const name = typeof evt.data.name === "string" ? evt.data.name : undefined;
                if (phase === "start" || phase === "update") {
                  await params.typingSignals.signalToolStart();
                  await params.opts?.onToolStart?.({ name, phase });
                }
              }
              if (evt.stream === "compaction") {
                const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                if (phase === "end") {
                  autoCompactionCompleted = true;
                }
              }
            },
            onBlockReply: params.opts?.onBlockReply
              ? createBlockReplyDeliveryHandler({
                  onBlockReply: params.opts.onBlockReply,
                  currentMessageId:
                    params.sessionCtx.MessageSidFull ?? params.sessionCtx.MessageSid,
                  normalizeStreamingText,
                  applyReplyToMode: params.applyReplyToMode,
                  typingSignals: params.typingSignals,
                  blockStreamingEnabled: params.blockStreamingEnabled,
                  blockReplyPipeline,
                  directlySentBlockKeys,
                })
              : undefined,
            onBlockReplyFlush:
              params.blockStreamingEnabled && blockReplyPipeline
                ? async () => {
                    await blockReplyPipeline.flush({ force: true });
                  }
                : undefined,
            shouldEmitToolResult: params.shouldEmitToolResult,
            shouldEmitToolOutput: params.shouldEmitToolOutput,
            onToolResult: onToolResult
              ? (payload) => {
                  const task = (async () => {
                    const { text, skip } = normalizeStreamingText(payload);
                    if (skip) {
                      return;
                    }
                    await params.typingSignals.signalTextDelta(text);
                    await onToolResult({
                      text,
                      mediaUrls: payload.mediaUrls,
                    });
                  })()
                    .catch((err) => {
                      logVerbose(`tool result delivery failed: ${String(err)}`);
                    })
                    .finally(() => {
                      params.pendingToolTasks.delete(task);
                    });
                  params.pendingToolTasks.add(task);
                }
              : undefined,
          });
        },
      });
      runResult = fallbackResult.result;
      fallbackProvider = fallbackResult.provider;
      fallbackModel = fallbackResult.model;
      const embeddedError = runResult.meta?.error;
      if (
        embeddedError &&
        isContextOverflowError(embeddedError.message) &&
        !didResetAfterCompactionFailure &&
        (await params.resetSessionAfterCompactionFailure(embeddedError.message))
      ) {
        didResetAfterCompactionFailure = true;
        return {
          kind: "final",
          payload: {
            text: `\u26A0\uFE0F Context limit exceeded. I've reset our conversation to start fresh - please try again.

To prevent this, increase your compaction buffer by setting \`agents.defaults.compaction.reserveTokensFloor\` to 4000 or higher in your config.`,
          },
        };
      }
      if (embeddedError?.kind === "role_ordering") {
        const didReset = await params.resetSessionAfterRoleOrderingConflict(embeddedError.message);
        if (didReset) {
          return {
            kind: "final",
            payload: {
              text: "\u26A0\uFE0F Message ordering conflict. I've reset the conversation - please try again.",
            },
          };
        }
      }
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isContextOverflow = isLikelyContextOverflowError(message);
      const isCompactionFailure = isCompactionFailureError(message);
      const isSessionCorruption = /function call turn comes immediately after/i.test(message);
      const isRoleOrderingError = /incorrect role information|roles must alternate/i.test(message);
      const isTransientHttp = isTransientHttpError(message);
      if (
        isCompactionFailure &&
        !didResetAfterCompactionFailure &&
        (await params.resetSessionAfterCompactionFailure(message))
      ) {
        didResetAfterCompactionFailure = true;
        return {
          kind: "final",
          payload: {
            text: `\u26A0\uFE0F Context limit exceeded during compaction. I've reset our conversation to start fresh - please try again.

To prevent this, increase your compaction buffer by setting \`agents.defaults.compaction.reserveTokensFloor\` to 4000 or higher in your config.`,
          },
        };
      }
      if (isRoleOrderingError) {
        const didReset = await params.resetSessionAfterRoleOrderingConflict(message);
        if (didReset) {
          return {
            kind: "final",
            payload: {
              text: "\u26A0\uFE0F Message ordering conflict. I've reset the conversation - please try again.",
            },
          };
        }
      }
      if (
        isSessionCorruption &&
        params.sessionKey &&
        params.activeSessionStore &&
        params.storePath
      ) {
        const sessionKey = params.sessionKey;
        const corruptedSessionId = params.getActiveSessionEntry()?.sessionId;
        defaultRuntime.error(
          `Session history corrupted (Gemini function call ordering). Resetting session: ${params.sessionKey}`,
        );
        try {
          if (corruptedSessionId) {
            const transcriptPath = resolveSessionTranscriptPath(corruptedSessionId);
            try {
              fs.unlinkSync(transcriptPath);
            } catch {}
          }
          delete params.activeSessionStore[sessionKey];
          await updateSessionStore(params.storePath, (store) => {
            delete store[sessionKey];
          });
        } catch (cleanupErr) {
          defaultRuntime.error(
            `Failed to reset corrupted session ${params.sessionKey}: ${String(cleanupErr)}`,
          );
        }
        return {
          kind: "final",
          payload: {
            text: "\u26A0\uFE0F Session history was corrupted. I've reset the conversation - please try again!",
          },
        };
      }
      if (isTransientHttp && !didRetryTransientHttpError) {
        didRetryTransientHttpError = true;
        defaultRuntime.error(
          `Transient HTTP provider error before reply (${message}). Retrying once in ${TRANSIENT_HTTP_RETRY_DELAY_MS}ms.`,
        );
        await new Promise((resolve) => {
          setTimeout(resolve, TRANSIENT_HTTP_RETRY_DELAY_MS);
        });
        continue;
      }
      defaultRuntime.error(`Embedded agent failed before reply: ${message}`);
      const safeMessage = isTransientHttp
        ? sanitizeUserFacingText(message, { errorContext: true })
        : message;
      const trimmedMessage = safeMessage.replace(/\.\s*$/, "");
      const fallbackText = isContextOverflow
        ? "\u26A0\uFE0F Context overflow \u2014 prompt too large for this model. Try a shorter message or a larger-context model."
        : isRoleOrderingError
          ? "\u26A0\uFE0F Message ordering conflict - please try again. If this persists, use /new to start a fresh session."
          : `\u26A0\uFE0F Agent failed before reply: ${trimmedMessage}.\nLogs: genosos logs --follow`;
      // If the SDK was never invoked (e.g. all auth profiles disabled), no lifecycle event
      // was emitted by the SDK. Emit one now so server-chat.js can broadcast state:"error"
      // and the webchat UI clears its loading indicator.
      if (!sdkAttempted) {
        emitAgentEvent({
          runId,
          stream: "lifecycle",
          data: { phase: "error", error: message, endedAt: Date.now() },
        });
      }
      return {
        kind: "final",
        payload: {
          text: fallbackText,
        },
      };
    }
  }
  return {
    kind: "success",
    runResult,
    fallbackProvider,
    fallbackModel,
    didLogHeartbeatStrip,
    autoCompactionCompleted,
    directlySentBlockKeys: directlySentBlockKeys.size > 0 ? directlySentBlockKeys : undefined,
  };
}
