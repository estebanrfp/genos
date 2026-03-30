import fs from "node:fs/promises";
import { logVerbose } from "../../globals.js";
import { createInternalHookEvent, triggerInternalHook } from "../../hooks/internal-hooks.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { extractAgentId } from "../../sessions/session-key-utils.js";
import { shouldHandleTextCommands } from "../commands-registry.js";
import { handleAllowlistCommand } from "./commands-allowlist.js";
import { handleApproveCommand } from "./commands-approve.js";
import { handleBashCommand } from "./commands-bash.js";
import { handleCompactCommand } from "./commands-compact.js";
import { handleConfigCommand, handleDebugCommand } from "./commands-config.js";
import { handleHeartbeatCommand } from "./commands-heartbeat.js";
import {
  handleCommandsListCommand,
  handleContextCommand,
  handleExportSessionCommand,
  handleHelpCommand,
  handleStatusCommand,
  handleWhoamiCommand,
} from "./commands-info.js";
import { handleModelsCommand } from "./commands-models.js";
import { handlePluginCommand } from "./commands-plugin.js";
import { handleProvidersCommand } from "./commands-providers.js";
import {
  handleAbortTrigger,
  handleActivationCommand,
  handleRestartCommand,
  handleSendPolicyCommand,
  handleStopCommand,
  handleUsageCommand,
} from "./commands-session.js";
import { handleSubagentsCommand } from "./commands-subagents.js";
import { handleTtsCommands } from "./commands-tts.js";
import { routeReply } from "./route-reply.js";
let HANDLERS = null;
export async function handleCommands(params) {
  if (HANDLERS === null) {
    HANDLERS = [
      handlePluginCommand,
      handleBashCommand,
      handleActivationCommand,
      handleSendPolicyCommand,
      handleUsageCommand,
      handleRestartCommand,
      handleTtsCommands,
      handleHelpCommand,
      handleCommandsListCommand,
      handleStatusCommand,
      handleAllowlistCommand,
      handleApproveCommand,
      handleContextCommand,
      handleExportSessionCommand,
      handleWhoamiCommand,
      handleSubagentsCommand,
      handleConfigCommand,
      handleDebugCommand,
      handleModelsCommand,
      handleProvidersCommand,
      handleStopCommand,
      handleCompactCommand,
      handleHeartbeatCommand,
      handleAbortTrigger,
    ];
  }
  const resetMatch = params.command.commandBodyNormalized.match(/^\/(new|reset)(?:\s|$)/);
  const resetRequested = Boolean(resetMatch);
  if (resetRequested && !params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /reset from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (resetRequested && params.command.isAuthorizedSender) {
    const commandAction = resetMatch?.[1] ?? "new";
    const hookEvent = createInternalHookEvent("command", commandAction, params.sessionKey ?? "", {
      sessionEntry: params.sessionEntry,
      previousSessionEntry: params.previousSessionEntry,
      commandSource: params.command.surface,
      senderId: params.command.senderId,
      cfg: params.cfg,
    });
    await triggerInternalHook(hookEvent);
    if (hookEvent.messages.length > 0) {
      const channel = params.ctx.OriginatingChannel || params.command.channel;
      const to = params.ctx.OriginatingTo || params.command.from || params.command.to;
      if (channel && to) {
        const hookReply = { text: hookEvent.messages.join("\n\n") };
        await routeReply({
          payload: hookReply,
          channel,
          to,
          sessionKey: params.sessionKey,
          accountId: params.ctx.AccountId,
          threadId: params.ctx.MessageThreadId,
          cfg: params.cfg,
        });
      }
    }
    const hookRunner = getGlobalHookRunner();
    if (hookRunner?.hasHooks("before_reset")) {
      const prevEntry = params.previousSessionEntry;
      const sessionFile = prevEntry?.sessionFile;
      (async () => {
        try {
          const messages = [];
          if (sessionFile) {
            const content = await fs.readFile(sessionFile, "utf-8");
            for (const line of content.split("\n")) {
              if (!line.trim()) {
                continue;
              }
              try {
                const entry = JSON.parse(line);
                if (entry.type === "message" && entry.message) {
                  messages.push(entry.message);
                }
              } catch {}
            }
          } else {
            logVerbose("before_reset: no session file available, firing hook with empty messages");
          }
          await hookRunner.runBeforeReset(
            { sessionFile, messages, reason: commandAction },
            {
              agentId: extractAgentId(params.sessionKey),
              sessionKey: params.sessionKey,
              sessionId: prevEntry?.sessionId,
              workspaceDir: params.workspaceDir,
            },
          );
        } catch (err) {
          logVerbose(`before_reset hook failed: ${String(err)}`);
        }
      })();
    }
  }
  const allowTextCommands = shouldHandleTextCommands({
    cfg: params.cfg,
    surface: params.command.surface,
    commandSource: params.ctx.CommandSource,
  });
  for (const handler of HANDLERS) {
    const result = await handler(params, allowTextCommands);
    if (result) {
      return result;
    }
  }
  const sendPolicy = resolveSendPolicy({
    cfg: params.cfg,
    entry: params.sessionEntry,
    sessionKey: params.sessionKey,
    channel: params.sessionEntry?.channel ?? params.command.channel,
    chatType: params.sessionEntry?.chatType,
  });
  if (sendPolicy === "deny") {
    logVerbose(`Send blocked by policy for session ${params.sessionKey ?? "unknown"}`);
    return { shouldContinue: false };
  }
  return { shouldContinue: true };
}
