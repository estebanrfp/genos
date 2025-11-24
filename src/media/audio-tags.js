import { parseInlineDirectives } from "../utils/directive-tags.js";
export function parseAudioTag(text) {
  const result = parseInlineDirectives(text, { stripReplyTags: false });
  return {
    text: result.text,
    audioAsVoice: result.audioAsVoice,
    hadTag: result.hasAudioTag,
  };
}
