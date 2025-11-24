/**
 * @typedef {object} CrossFieldRule
 * @property {string} field - Sibling field name
 * @property {*} [eq] - When THIS field equals this value, emit `message`
 * @property {string} [message] - Error/warning message
 * @property {*} [when] - When sibling field equals this value
 * @property {string} [requires] - What this field must contain (JSON string)
 */

/**
 * @typedef {object} Blueprint
 * @property {string} pathPattern - Glob-style path (e.g. "channels.*.allowFrom")
 * @property {"scalar"|"array"|"object"} valueType
 * @property {"string"|"number"|"smart"|null} [itemCoerce]
 * @property {Record<string, {itemCoerce?: string, note?: string}>} [channelRules]
 * @property {CrossFieldRule[]} [crossField]
 * @property {string} guidance - Natural language guidance for the agent
 * @property {string[]} [enumValues] - Valid enum values
 * @property {object} [examples] - Usage examples
 */

/** @type {Blueprint[]} */
export default [
  // --- Common per-channel paths ---
  {
    pathPattern: "channels.*.enabled",
    valueType: "scalar",
    guidance: "Enable or disable the channel. Use true/false.",
    examples: { set: true },
  },
  {
    pathPattern: "channels.*.allowFrom",
    valueType: "array",
    itemCoerce: "smart",
    channelRules: {
      discord: { itemCoerce: "string", note: "Discord IDs are always strings (snowflakes)" },
      whatsapp: {
        itemCoerce: "string",
        note: "WhatsApp IDs are phone strings (e.g. '34660777328@s.whatsapp.net')",
      },
      telegram: {
        itemCoerce: "smart",
        note: "Telegram IDs: numeric strings become numbers, usernames stay strings",
      },
      signal: { itemCoerce: "string", note: "Signal IDs are phone strings" },
      irc: { itemCoerce: "string", note: "IRC nicknames are strings" },
      imessage: { itemCoerce: "string", note: "iMessage IDs are phone/email strings" },
      nostr: { itemCoerce: "string", note: "Nostr pubkeys are hex strings" },
      slack: { itemCoerce: "string", note: "Slack user IDs are strings (e.g. 'U12345678')" },
      googlechat: { itemCoerce: "string", note: "Google Chat user IDs are strings" },
    },
    crossField: [{ field: "dmPolicy", when: "open", requires: '["*"]' }],
    guidance:
      "Allowlist of user IDs permitted to interact. Add one at a time with 'set'. Use 'remove' to delete. Use '*' to allow everyone (requires dmPolicy='open').",
    examples: { set: "34660777328", remove: "34660777328" },
  },
  {
    pathPattern: "channels.*.dmPolicy",
    valueType: "scalar",
    enumValues: ["open", "allowlist", "pairing"],
    crossField: [
      {
        field: "allowFrom",
        eq: "open",
        message:
          "dmPolicy='open' requires allowFrom to include '*'. Set allowFrom=['*'] first or add '*' to it.",
      },
    ],
    guidance:
      "'open' = accept DMs from anyone (requires allowFrom=['*']). 'allowlist' = only from listed IDs. 'pairing' = require pairing handshake.",
    examples: { set: "allowlist" },
  },
  {
    pathPattern: "channels.*.groupPolicy",
    valueType: "scalar",
    enumValues: ["open", "allowlist", "off"],
    guidance:
      "'open' = respond in all groups. 'allowlist' = only in allowGroups list. 'off' = ignore group messages.",
    examples: { set: "allowlist" },
  },
  {
    pathPattern: "channels.*.allowGroups",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Group IDs/names where the bot responds. Only used when groupPolicy='allowlist'. Add one at a time with 'set'.",
    examples: { set: "-1001234567890" },
  },
  {
    pathPattern: "channels.*.replyMode",
    valueType: "scalar",
    enumValues: ["reply", "quote", "none"],
    guidance:
      "'reply' = reply to the original message. 'quote' = quote the message. 'none' = send as standalone.",
    examples: { set: "reply" },
  },
  {
    pathPattern: "channels.*.accountId",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Account identifier for multi-account channels (e.g. WhatsApp phone, Nostr pubkey).",
    examples: { set: "my-account" },
  },
  {
    pathPattern: "channels.*.displayName",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Display name shown in the channel. Overrides the agent's default name.",
    examples: { set: "Nyx Assistant" },
  },

  // --- Telegram-specific ---
  {
    pathPattern: "channels.telegram.customCommands",
    valueType: "object",
    guidance:
      "Custom Telegram bot commands. Object with command names as keys, descriptions as values. Use 'set' with a JSON object.",
    examples: { set: '{"start": "Start conversation", "help": "Show help"}' },
  },
  {
    pathPattern: "channels.telegram.allowBots",
    valueType: "scalar",
    guidance: "Allow other Telegram bots to interact. Default: false.",
    examples: { set: false },
  },
  {
    pathPattern: "channels.telegram.parseMode",
    valueType: "scalar",
    enumValues: ["MarkdownV2", "HTML", "Markdown"],
    guidance: "Telegram message parse mode. 'MarkdownV2' recommended. 'Markdown' is legacy.",
    examples: { set: "MarkdownV2" },
  },

  // --- Discord-specific ---
  {
    pathPattern: "channels.discord.activityType",
    valueType: "scalar",
    enumValues: [0, 1, 2, 3, 4, 5],
    crossField: [
      {
        field: "activityUrl",
        eq: 1,
        message: "activityType=1 (Streaming) requires activityUrl to be set.",
      },
    ],
    guidance:
      "Discord presence activity type. 0=Playing, 1=Streaming (requires activityUrl), 2=Listening, 3=Watching, 4=Custom, 5=Competing.",
    examples: { set: 0 },
  },
  {
    pathPattern: "channels.discord.activityUrl",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "URL for Discord streaming activity (activityType=1). Must be a valid Twitch or YouTube URL.",
    examples: { set: "https://twitch.tv/channel" },
  },
  {
    pathPattern: "channels.discord.activityName",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Text shown in Discord presence activity status.",
    examples: { set: "with AI" },
  },

  // --- IRC-specific ---
  {
    pathPattern: "channels.irc.nickserv.register",
    valueType: "scalar",
    crossField: [
      {
        field: "registerEmail",
        eq: true,
        message: "nickserv.register=true requires registerEmail to be set.",
      },
    ],
    guidance: "Auto-register nickname with NickServ. Requires registerEmail when enabled.",
    examples: { set: true },
  },
  {
    pathPattern: "channels.irc.nickserv.registerEmail",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Email address for NickServ registration. Required when nickserv.register=true.",
    examples: { set: "bot@example.com" },
  },
  {
    pathPattern: "channels.irc.nickserv.password",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "NickServ password for auto-identify. Sensitive value.",
    examples: { set: "my-password" },
  },

  // --- Nostr-specific ---
  {
    pathPattern: "channels.nostr.relays",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Nostr relay URLs (wss://). Add one at a time with 'set'. Use 'remove' to delete.",
    examples: { set: "wss://relay.damus.io", remove: "wss://relay.damus.io" },
  },
  {
    pathPattern: "channels.nostr.profile.name",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Nostr profile display name.",
    examples: { set: "Nyx" },
  },
  {
    pathPattern: "channels.nostr.profile.about",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Nostr profile bio/about text.",
    examples: { set: "AI assistant powered by GenosOS" },
  },
  {
    pathPattern: "channels.nostr.profile.picture",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Nostr profile picture URL.",
    examples: { set: "https://example.com/avatar.png" },
  },
  {
    pathPattern: "channels.nostr.profile.nip05",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Nostr NIP-05 verification identifier (user@domain).",
    examples: { set: "nyx@example.com" },
  },

  // --- WhatsApp-specific ---
  {
    pathPattern: "channels.whatsapp.enabled",
    valueType: "scalar",
    guidance:
      "Enable or disable WhatsApp. For first-time linking, use `config_manage channels whatsapp.setup` to open the QR overlay.",
    examples: { set: true },
  },
  {
    pathPattern: "channels.whatsapp.dmPolicy",
    valueType: "scalar",
    enumValues: ["open", "allowlist", "pairing", "disabled"],
    crossField: [
      {
        field: "allowFrom",
        eq: "open",
        message:
          "dmPolicy='open' requires allowFrom to include '*'. Set allowFrom=['*'] first or add '*' to it.",
      },
    ],
    guidance:
      "'pairing' (default) = unknown senders get a pairing code, owner approves via approval system. 'allowlist' = only numbers in allowFrom can interact. 'open' = accept DMs from anyone (requires allowFrom=['*']). 'disabled' = ignore all WhatsApp DMs. For personal phones, use 'allowlist' + your number in allowFrom. For dedicated phones, 'pairing' is recommended.",
    examples: { set: "allowlist" },
  },
  {
    pathPattern: "channels.whatsapp.selfChatMode",
    valueType: "scalar",
    guidance:
      "When true, enables self-chat: messages you send to yourself on WhatsApp reach GenosOS. Recommended for personal phone setups where you are the primary user.",
    examples: { set: true },
  },
  {
    pathPattern: "channels.whatsapp.autoReact",
    valueType: "scalar",
    guidance: "Auto-react to messages with an emoji while processing. Default: false.",
    examples: { set: true },
  },

  // --- Signal-specific ---
  {
    pathPattern: "channels.signal.signalCliPath",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Path to signal-cli binary. Required for Signal channel.",
    examples: { set: "/usr/local/bin/signal-cli" },
  },
];
