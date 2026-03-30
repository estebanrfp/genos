export function createReplyReferencePlanner(options) {
  let hasReplied = options.hasReplied ?? false;
  const allowReference = options.allowReference !== false;
  const existingId = options.existingId?.trim();
  const startId = options.startId?.trim();
  const use = () => {
    if (!allowReference) {
      return;
    }
    if (options.replyToMode === "off") {
      return;
    }
    const id = existingId ?? startId;
    if (!id) {
      return;
    }
    if (options.replyToMode === "all") {
      hasReplied = true;
      return id;
    }
    if (!hasReplied) {
      hasReplied = true;
      return id;
    }
    return;
  };
  const markSent = () => {
    hasReplied = true;
  };
  return {
    use,
    markSent,
    hasReplied: () => hasReplied,
  };
}
