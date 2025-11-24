const RelationType = {
  Thread: "m.thread",
};
export function resolveMatrixThreadTarget(params) {
  const { threadReplies, messageId, threadRootId } = params;
  if (threadReplies === "off") {
    return;
  }
  const isThreadRoot = params.isThreadRoot === true;
  const hasInboundThread = Boolean(threadRootId && threadRootId !== messageId && !isThreadRoot);
  if (threadReplies === "inbound") {
    return hasInboundThread ? threadRootId : undefined;
  }
  if (threadReplies === "always") {
    return threadRootId ?? messageId;
  }
  return;
}
export function resolveMatrixThreadRootId(params) {
  const relates = params.content["m.relates_to"];
  if (!relates || typeof relates !== "object") {
    return;
  }
  if ("rel_type" in relates && relates.rel_type === RelationType.Thread) {
    if ("event_id" in relates && typeof relates.event_id === "string") {
      return relates.event_id;
    }
    if (
      "m.in_reply_to" in relates &&
      typeof relates["m.in_reply_to"] === "object" &&
      relates["m.in_reply_to"] &&
      "event_id" in relates["m.in_reply_to"] &&
      typeof relates["m.in_reply_to"].event_id === "string"
    ) {
      return relates["m.in_reply_to"].event_id;
    }
  }
  return;
}
