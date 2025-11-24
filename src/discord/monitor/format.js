export function resolveDiscordSystemLocation(params) {
  const { isDirectMessage, isGroupDm, guild, channelName } = params;
  if (isDirectMessage) {
    return "DM";
  }
  if (isGroupDm) {
    return `Group DM #${channelName}`;
  }
  return guild?.name ? `${guild.name} #${channelName}` : `#${channelName}`;
}
export function formatDiscordReactionEmoji(emoji) {
  if (emoji.id && emoji.name) {
    return `<:${emoji.name}:${emoji.id}>`;
  }
  if (emoji.id) {
    return `emoji:${emoji.id}`;
  }
  return emoji.name ?? "emoji";
}
export function formatDiscordUserTag(user) {
  const discriminator = (user.discriminator ?? "").trim();
  if (discriminator && discriminator !== "0") {
    return `${user.username}#${discriminator}`;
  }
  return user.username ?? user.id;
}
export function resolveTimestampMs(timestamp) {
  if (!timestamp) {
    return;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}
