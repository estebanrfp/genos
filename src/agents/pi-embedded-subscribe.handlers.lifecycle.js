import { emitAgentEvent } from "../infra/agent-events.js";
import { createInlineCodeState } from "../markdown/code-spans.js";
import { formatAssistantErrorText } from "./pi-embedded-helpers.js";
import { isAssistantMessage } from "./pi-embedded-utils.js";
export {
  handleAutoCompactionEnd,
  handleAutoCompactionStart,
} from "./pi-embedded-subscribe.handlers.compaction.js";
export function handleAgentStart(ctx) {
  ctx.log.debug(`embedded run agent start: runId=${ctx.params.runId}`);
  ctx.state.agentStartedAt = Date.now();
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "lifecycle",
    data: {
      phase: "start",
      startedAt: ctx.state.agentStartedAt,
    },
  });
  ctx.params.onAgentEvent?.({
    stream: "lifecycle",
    data: { phase: "start" },
  });
}
export function handleAgentEnd(ctx) {
  const lastAssistant = ctx.state.lastAssistant;
  const isError = isAssistantMessage(lastAssistant) && lastAssistant.stopReason === "error";
  ctx.log.debug(`embedded run agent end: runId=${ctx.params.runId} isError=${isError}`);
  if (isError && lastAssistant) {
    const friendlyError = formatAssistantErrorText(lastAssistant, {
      cfg: ctx.params.config,
      sessionKey: ctx.params.sessionKey,
      provider: lastAssistant.provider,
      model: lastAssistant.model,
    });
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "lifecycle",
      data: {
        phase: "error",
        error: friendlyError || lastAssistant.errorMessage || "LLM request failed.",
        endedAt: Date.now(),
      },
    });
    ctx.params.onAgentEvent?.({
      stream: "lifecycle",
      data: {
        phase: "error",
        error: friendlyError || lastAssistant.errorMessage || "LLM request failed.",
      },
    });
  } else {
    const usage = ctx.getUsageTotals?.() ?? undefined;
    const compactionCount = ctx.getCompactionCount?.() ?? undefined;
    const endedAt = Date.now();
    const startedAt = ctx.state.agentStartedAt;
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "lifecycle",
      data: {
        phase: "end",
        endedAt,
        usage,
        model: ctx.state.lastAssistant?.model ?? undefined,
        compactionCount: compactionCount > 0 ? compactionCount : undefined,
        durationMs: startedAt ? endedAt - startedAt : undefined,
      },
    });
    ctx.params.onAgentEvent?.({
      stream: "lifecycle",
      data: { phase: "end" },
    });
  }
  ctx.flushBlockReplyBuffer();
  ctx.state.blockState.thinking = false;
  ctx.state.blockState.final = false;
  ctx.state.blockState.inlineCode = createInlineCodeState();
  if (ctx.state.pendingCompactionRetry > 0) {
    ctx.resolveCompactionRetry();
  } else {
    ctx.maybeResolveCompactionWait();
  }
}
