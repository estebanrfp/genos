import { getMatrixRuntime } from "../../runtime.js";
export function resolveMentions(params) {
  const mentions = params.content["m.mentions"];
  const mentionedUsers = Array.isArray(mentions?.user_ids) ? new Set(mentions.user_ids) : new Set();
  const wasMentioned =
    Boolean(mentions?.room) ||
    (params.userId ? mentionedUsers.has(params.userId) : false) ||
    getMatrixRuntime().channel.mentions.matchesMentionPatterns(
      params.text ?? "",
      params.mentionRegexes,
    );
  return { wasMentioned, hasExplicitMention: Boolean(mentions) };
}
