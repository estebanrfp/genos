import { formatCliCommand } from "../../cli/command-format.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
export function resolveChannelDefaultAccountId(params) {
  const accountIds = params.accountIds ?? params.plugin.config.listAccountIds(params.cfg);
  return params.plugin.config.defaultAccountId?.(params.cfg) ?? accountIds[0] ?? DEFAULT_ACCOUNT_ID;
}
export function formatPairingApproveHint(channelId) {
  const listCmd = formatCliCommand(`genosos pairing list ${channelId}`);
  const approveCmd = formatCliCommand(`genosos pairing approve ${channelId} <code>`);
  return `Approve via: ${listCmd} / ${approveCmd}`;
}
