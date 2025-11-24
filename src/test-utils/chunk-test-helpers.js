export function countLines(text) {
  return text.split("\n").length;
}
export function hasBalancedFences(chunk) {
  let open = null;
  for (const line of chunk.split("\n")) {
    const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) {
      continue;
    }
    const marker = match[2];
    if (!open) {
      open = { markerChar: marker[0], markerLen: marker.length };
      continue;
    }
    if (open.markerChar === marker[0] && marker.length >= open.markerLen) {
      open = null;
    }
  }
  return open === null;
}
