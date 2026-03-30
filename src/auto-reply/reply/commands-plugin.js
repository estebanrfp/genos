import { matchPluginCommand, executePluginCommand } from "../../plugins/commands.js";
export const handlePluginCommand = async (params, allowTextCommands) => {
  const { command, cfg } = params;
  if (!allowTextCommands) {
    return null;
  }
  const match = matchPluginCommand(command.commandBodyNormalized);
  if (!match) {
    return null;
  }
  const result = await executePluginCommand({
    command: match.command,
    args: match.args,
    senderId: command.senderId,
    channel: command.channel,
    channelId: command.channelId,
    isAuthorizedSender: command.isAuthorizedSender,
    commandBody: command.commandBodyNormalized,
    config: cfg,
    from: command.from,
    to: command.to,
    accountId: params.ctx.AccountId ?? undefined,
    messageThreadId:
      typeof params.ctx.MessageThreadId === "number" ? params.ctx.MessageThreadId : undefined,
  });
  return {
    shouldContinue: false,
    reply: result,
  };
};
