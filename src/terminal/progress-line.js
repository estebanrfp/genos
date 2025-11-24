let activeStream = null;
export function registerActiveProgressLine(stream) {
  if (!stream.isTTY) {
    return;
  }
  activeStream = stream;
}
export function clearActiveProgressLine() {
  if (!activeStream?.isTTY) {
    return;
  }
  activeStream.write(`\r\x1B[2K`);
}
export function unregisterActiveProgressLine(stream) {
  if (!activeStream) {
    return;
  }
  if (stream && activeStream !== stream) {
    return;
  }
  activeStream = null;
}
