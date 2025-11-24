import { getChannelPlugin } from "../../channels/plugins/index.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { requireValidConfigSnapshot } from "../config-validation.js";
export async function requireValidConfig(runtime = defaultRuntime) {
  return await requireValidConfigSnapshot(runtime);
}
export function formatAccountLabel(params) {
  const base = params.accountId || DEFAULT_ACCOUNT_ID;
  if (params.name?.trim()) {
    return `${base} (${params.name.trim()})`;
  }
  return base;
}
export const channelLabel = (channel) => {
  const plugin = getChannelPlugin(channel);
  return plugin?.meta.label ?? channel;
};
export function formatChannelAccountLabel(params) {
  const channelText = channelLabel(params.channel);
  const accountText = formatAccountLabel({
    accountId: params.accountId,
    name: params.name,
  });
  const styledChannel = params.channelStyle ? params.channelStyle(channelText) : channelText;
  const styledAccount = params.accountStyle ? params.accountStyle(accountText) : accountText;
  return `${styledChannel} ${styledAccount}`;
}
export function shouldUseWizard(params) {
  return params?.hasFlags === false;
}
