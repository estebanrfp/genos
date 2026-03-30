import { logVerbose } from "../globals.js";
export async function startSlackStream(params) {
  const { client, channel, threadTs, text } = params;
  logVerbose(`slack-stream: starting stream in ${channel} thread=${threadTs}`);
  const streamer = client.chatStream({
    channel,
    thread_ts: threadTs,
  });
  const session = {
    streamer,
    channel,
    threadTs,
    stopped: false,
  };
  if (text) {
    await streamer.append({ markdown_text: text });
    logVerbose(`slack-stream: appended initial text (${text.length} chars)`);
  }
  return session;
}
export async function appendSlackStream(params) {
  const { session, text } = params;
  if (session.stopped) {
    logVerbose("slack-stream: attempted to append to a stopped stream, ignoring");
    return;
  }
  if (!text) {
    return;
  }
  await session.streamer.append({ markdown_text: text });
  logVerbose(`slack-stream: appended ${text.length} chars`);
}
export async function stopSlackStream(params) {
  const { session, text } = params;
  if (session.stopped) {
    logVerbose("slack-stream: stream already stopped, ignoring duplicate stop");
    return;
  }
  session.stopped = true;
  logVerbose(
    `slack-stream: stopping stream in ${session.channel} thread=${session.threadTs}${text ? ` (final text: ${text.length} chars)` : ""}`,
  );
  await session.streamer.stop(text ? { markdown_text: text } : undefined);
  logVerbose("slack-stream: stream stopped");
}
