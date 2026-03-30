/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "messages.tts.auto",
    valueType: "scalar",
    enumValues: ["off", "always", "inbound", "tagged"],
    guidance:
      "'off' = no auto-TTS. 'always' = speak every reply. 'inbound' = speak only when user sends audio. 'tagged' = speak only tagged messages.",
    examples: { set: "off" },
  },
  {
    pathPattern: "messages.tts.provider",
    valueType: "scalar",
    enumValues: ["kokoro", "openai", "elevenlabs", "edge"],
    guidance: "Active TTS provider. Must have the provider configured and running.",
    examples: { set: "kokoro" },
  },
  {
    pathPattern: "messages.tts.kokoro.voice",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Kokoro TTS voice name. Default: 'af_heart'.",
    examples: { set: "af_heart" },
  },
  {
    pathPattern: "messages.tts.kokoro.language",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Kokoro TTS language code (BCP-47). Default: 'es'.",
    examples: { set: "es" },
  },
  {
    pathPattern: "messages.tts.openai.voice",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "OpenAI TTS voice. Options: alloy, echo, fable, onyx, nova, shimmer.",
    examples: { set: "nova" },
  },
  {
    pathPattern: "messages.tts.openai.model",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "OpenAI TTS model. Default: 'tts-1'. Use 'tts-1-hd' for higher quality.",
    examples: { set: "tts-1" },
  },
  {
    pathPattern: "messages.tts.elevenlabs.voiceId",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "ElevenLabs voice ID. Find IDs in your ElevenLabs dashboard.",
    examples: { set: "21m00Tcm4TlvDq8ikWAM" },
  },
  {
    pathPattern: "messages.tts.edge.voice",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Edge TTS voice name. E.g. 'es-ES-AlvaroNeural', 'en-US-AriaNeural'.",
    examples: { set: "es-ES-AlvaroNeural" },
  },
  {
    pathPattern: "messages.tts.edge.lang",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Edge TTS language code. Default: 'es-ES'.",
    examples: { set: "es-ES" },
  },
  {
    pathPattern: "messages.suppressToolErrors",
    valueType: "scalar",
    enumValues: [true, false],
    guidance: "Suppress tool error warnings in chat output. Default: false.",
    examples: { set: false },
  },
  {
    pathPattern: "messages.ackReaction",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Emoji reaction sent as acknowledgment. Empty string disables ack reactions.",
    examples: { set: "👍" },
  },
  {
    pathPattern: "messages.ackReactionScope",
    valueType: "scalar",
    enumValues: ["group-mentions", "group-all", "direct", "all"],
    guidance:
      "'group-mentions' = ack only when mentioned in groups. 'group-all' = ack all group msgs. 'direct' = ack DMs only. 'all' = ack everything.",
    examples: { set: "group-mentions" },
  },
  {
    pathPattern: "messages.inbound.debounceMs",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Debounce window in ms for inbound messages. Batches rapid messages. Default: 0 (no debounce).",
    examples: { set: 1500 },
  },
];
