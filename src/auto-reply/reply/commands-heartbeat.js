import { logVerbose } from "../../globals.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";

/**
 * Handle /heartbeat command — triggers an immediate heartbeat run.
 */
export const handleHeartbeatCommand = async (params) => {
  if (params.command.commandBodyNormalized !== "/heartbeat") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /heartbeat from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  requestHeartbeatNow({ reason: "manual", coalesceMs: 0 });
  return {
    shouldContinue: false,
    reply: { text: "Heartbeat triggered.", role: "system" },
  };
};
