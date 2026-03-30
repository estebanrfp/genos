export function estimateUtf8Bytes(text) {
  if (!text) {
    return 0;
  }
  return Buffer.byteLength(text, "utf8");
}
export function splitTextToUtf8ByteLimit(text, maxUtf8Bytes) {
  if (maxUtf8Bytes <= 0) {
    return [text];
  }
  if (estimateUtf8Bytes(text) <= maxUtf8Bytes) {
    return [text];
  }
  const parts = [];
  let cursor = 0;
  while (cursor < text.length) {
    let low = cursor + 1;
    let high = Math.min(text.length, cursor + maxUtf8Bytes);
    let best = cursor;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const bytes = estimateUtf8Bytes(text.slice(cursor, mid));
      if (bytes <= maxUtf8Bytes) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (best <= cursor) {
      best = Math.min(text.length, cursor + 1);
    }
    if (
      best < text.length &&
      best > cursor &&
      text.charCodeAt(best - 1) >= 55296 &&
      text.charCodeAt(best - 1) <= 56319 &&
      text.charCodeAt(best) >= 56320 &&
      text.charCodeAt(best) <= 57343
    ) {
      best -= 1;
    }
    const part = text.slice(cursor, best);
    if (!part) {
      break;
    }
    parts.push(part);
    cursor = best;
  }
  return parts;
}
