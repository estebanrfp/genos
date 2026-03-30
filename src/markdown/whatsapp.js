import { escapeRegExp } from "../utils.js";
const FENCE_PLACEHOLDER = "\0FENCE";
const INLINE_CODE_PLACEHOLDER = "\0CODE";
export function markdownToWhatsApp(text) {
  if (!text) {
    return text;
  }
  const fences = [];
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    fences.push(match);
    return `${FENCE_PLACEHOLDER}${fences.length - 1}`;
  });
  const inlineCodes = [];
  result = result.replace(/`[^`\n]+`/g, (match) => {
    inlineCodes.push(match);
    return `${INLINE_CODE_PLACEHOLDER}${inlineCodes.length - 1}`;
  });
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replace(/__(.+?)__/g, "*$1*");
  result = result.replace(/~~(.+?)~~/g, "~$1~");
  result = result.replace(
    new RegExp(`${escapeRegExp(INLINE_CODE_PLACEHOLDER)}(\\d+)`, "g"),
    (_, idx) => inlineCodes[Number(idx)] ?? "",
  );
  result = result.replace(
    new RegExp(`${escapeRegExp(FENCE_PLACEHOLDER)}(\\d+)`, "g"),
    (_, idx) => fences[Number(idx)] ?? "",
  );
  return result;
}
