export function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const OPENAI_TO_POLLY_MAP = {
  alloy: "Polly.Joanna",
  echo: "Polly.Matthew",
  fable: "Polly.Amy",
  onyx: "Polly.Brian",
  nova: "Polly.Salli",
  shimmer: "Polly.Kimberly",
};
export const DEFAULT_POLLY_VOICE = "Polly.Joanna";
export function mapVoiceToPolly(voice) {
  if (!voice) {
    return DEFAULT_POLLY_VOICE;
  }
  if (voice.startsWith("Polly.") || voice.startsWith("Google.")) {
    return voice;
  }
  return OPENAI_TO_POLLY_MAP[voice.toLowerCase()] || DEFAULT_POLLY_VOICE;
}
export function isOpenAiVoice(voice) {
  return voice.toLowerCase() in OPENAI_TO_POLLY_MAP;
}
export function getOpenAiVoiceNames() {
  return Object.keys(OPENAI_TO_POLLY_MAP);
}
