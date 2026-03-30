import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import { resolveAgentIdFromSessionKey, normalizeAgentId } from "../../routing/session-key.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { spawnSubagentDirect } from "../subagent-spawn.js";
import { jsonResult, readStringParam } from "./common.js";
import { resolveAgentIdByNameOrId } from "./sessions-send-helpers.js";
const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  keep: Type.Optional(Type.Boolean()),
  cleanup: optionalStringEnum(["delete", "keep"]),
});
export function createSessionsSpawnTool(opts) {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      "Spawn a NEW background sub-agent session under YOUR OWN agent. Use only for the FIRST message; for follow-ups use sessions_send.\n\n" +
      "## When to use\n" +
      "Only for spawning subagents within your own agent scope (parallel tasks, specialists). " +
      "To communicate with ANOTHER agent, use sessions_send to their main session instead — never spawn sessions on other agents.\n\n" +
      "## keep (default false)\n" +
      "Decides whether the session persists after completion.\n" +
      "- keep: true → session stays alive (ongoing identity, companion, long-lived relationship)\n" +
      "- keep: false → auto-delete on completion (one-shot task, lookup, transient work)\n\n" +
      "Decision guide: Will you need this session again later? If yes → keep: true. If it's a fire-and-forget task → omit or keep: false.",
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args;
      const task = readStringParam(params, "task", { required: true });
      const label = typeof params.label === "string" ? params.label.trim() : "";
      const rawAgentId = readStringParam(params, "agentId");
      const requestedAgentId = rawAgentId
        ? resolveAgentIdByNameOrId(loadConfig(), rawAgentId)
        : undefined;
      const modelOverride = readStringParam(params, "model");
      const thinkingOverrideRaw = readStringParam(params, "thinking");
      const keepExplicit = typeof params.keep === "boolean" ? params.keep : undefined;
      const cleanupLegacy =
        params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : undefined;
      const cleanup =
        keepExplicit !== undefined ? (keepExplicit ? "keep" : "delete") : cleanupLegacy;
      const timeoutSecondsCandidate =
        typeof params.runTimeoutSeconds === "number"
          ? params.runTimeoutSeconds
          : typeof params.timeoutSeconds === "number"
            ? params.timeoutSeconds
            : undefined;
      const runTimeoutSeconds =
        typeof timeoutSecondsCandidate === "number" && Number.isFinite(timeoutSecondsCandidate)
          ? Math.max(0, Math.floor(timeoutSecondsCandidate))
          : undefined;

      // Fast-path: reject cross-agent spawn immediately with actionable guidance.
      // Do NOT waste a round-trip — tell the model to use sessions_send instead.
      if (requestedAgentId && opts?.agentSessionKey) {
        const callerAgentId = normalizeAgentId(resolveAgentIdFromSessionKey(opts.agentSessionKey));
        if (normalizeAgentId(requestedAgentId) !== callerAgentId) {
          return jsonResult({
            status: "forbidden",
            error:
              `Cannot spawn a session on another agent ("${requestedAgentId}"). ` +
              `Use sessions_send with agentId="${requestedAgentId}" and label="main" instead — ` +
              `the target agent decides how to handle the request.`,
          });
        }
      }

      const result = await spawnSubagentDirect(
        {
          task,
          label: label || undefined,
          agentId: requestedAgentId,
          model: modelOverride,
          thinking: thinkingOverrideRaw,
          runTimeoutSeconds,
          cleanup,
          expectsCompletionMessage: true,
        },
        {
          agentSessionKey: opts?.agentSessionKey,
          agentChannel: opts?.agentChannel,
          agentAccountId: opts?.agentAccountId,
          agentTo: opts?.agentTo,
          agentThreadId: opts?.agentThreadId,
          agentGroupId: opts?.agentGroupId,
          agentGroupChannel: opts?.agentGroupChannel,
          agentGroupSpace: opts?.agentGroupSpace,
          requesterAgentIdOverride: opts?.requesterAgentIdOverride,
        },
      );
      return jsonResult(result);
    },
  };
}
