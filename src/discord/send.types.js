export class DiscordSendError extends Error {
  kind;
  channelId;
  missingPermissions;
  constructor(message, opts) {
    super(message);
    this.name = "DiscordSendError";
    if (opts) {
      Object.assign(this, opts);
    }
  }
  toString() {
    return this.message;
  }
}
export const DISCORD_MAX_EMOJI_BYTES = 262144;
export const DISCORD_MAX_STICKER_BYTES = 524288;
