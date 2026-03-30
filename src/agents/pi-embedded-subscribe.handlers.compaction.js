import { emitAgentEvent } from "../infra/agent-events.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
export function handleAutoCompactionStart(ctx) {
  ctx.state.compactionInFlight = true;
  ctx.incrementCompactionCount();
  ctx.ensureCompactionPromise();
  ctx.log.debug(`embedded run compaction start: runId=${ctx.params.runId}`);
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "compaction",
    data: { phase: "start" },
  });
  ctx.params.onAgentEvent?.({
    stream: "compaction",
    data: { phase: "start" },
  });
  const hookRunner = getGlobalHookRunner();
  if (hookRunner?.hasHooks("before_compaction")) {
    hookRunner
      .runBeforeCompaction(
        {
          messageCount: ctx.params.session.messages?.length ?? 0,
        },
        {},
      )
      .catch((err) => {
        ctx.log.warn(`before_compaction hook failed: ${String(err)}`);
      });
  }
}
export function handleAutoCompactionEnd(ctx, evt) {
  ctx.state.compactionInFlight = false;
  const willRetry = Boolean(evt.willRetry);
  if (willRetry) {
    ctx.noteCompactionRetry();
    ctx.resetForCompactionRetry();
    ctx.log.debug(`embedded run compaction retry: runId=${ctx.params.runId}`);
  } else {
    ctx.maybeResolveCompactionWait();
  }
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "compaction",
    data: { phase: "end", willRetry },
  });
  ctx.params.onAgentEvent?.({
    stream: "compaction",
    data: { phase: "end", willRetry },
  });
  if (!willRetry) {
    const hookRunnerEnd = getGlobalHookRunner();
    if (hookRunnerEnd?.hasHooks("after_compaction")) {
      hookRunnerEnd
        .runAfterCompaction(
          {
            messageCount: ctx.params.session.messages?.length ?? 0,
            compactedCount: ctx.getCompactionCount(),
          },
          {},
        )
        .catch((err) => {
          ctx.log.warn(`after_compaction hook failed: ${String(err)}`);
        });
    }
  }
}
