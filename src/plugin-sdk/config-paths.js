export function resolveChannelAccountConfigBasePath(params) {
  const channels = params.cfg.channels;
  const channelSection = channels?.[params.channelKey];
  const accounts = channelSection?.accounts;
  const useAccountPath = Boolean(accounts?.[params.accountId]);
  return useAccountPath
    ? `channels.${params.channelKey}.accounts.${params.accountId}.`
    : `channels.${params.channelKey}.`;
}
