import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { applyInputProvenanceToUserMessage } from "../sessions/input-provenance.js";
import { installSessionToolResultGuard } from "./session-tool-result-guard.js";
export function guardSessionManager(sessionManager, opts) {
  if (typeof sessionManager.flushPendingToolResults === "function") {
    return sessionManager;
  }
  const hookRunner = getGlobalHookRunner();
  const beforeMessageWrite = hookRunner?.hasHooks("before_message_write")
    ? (event) => {
        return hookRunner.runBeforeMessageWrite(event, {
          agentId: opts?.agentId,
          sessionKey: opts?.sessionKey,
        });
      }
    : undefined;
  const transform = hookRunner?.hasHooks("tool_result_persist")
    ? (message, meta) => {
        const out = hookRunner.runToolResultPersist(
          {
            toolName: meta.toolName,
            toolCallId: meta.toolCallId,
            message,
            isSynthetic: meta.isSynthetic,
          },
          {
            agentId: opts?.agentId,
            sessionKey: opts?.sessionKey,
            toolName: meta.toolName,
            toolCallId: meta.toolCallId,
          },
        );
        return out?.message ?? message;
      }
    : undefined;
  const guard = installSessionToolResultGuard(sessionManager, {
    transformMessageForPersistence: (message) =>
      applyInputProvenanceToUserMessage(message, opts?.inputProvenance),
    transformToolResultForPersistence: transform,
    allowSyntheticToolResults: opts?.allowSyntheticToolResults,
    beforeMessageWriteHook: beforeMessageWrite,
  });
  sessionManager.flushPendingToolResults = guard.flushPendingToolResults;
  return sessionManager;
}
