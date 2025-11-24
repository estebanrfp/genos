import { describe, expect, it } from "vitest";
import { MediaStreamHandler } from "./media-stream.js";
const createStubSession = () => ({
  connect: async () => {},
  sendAudio: () => {},
  waitForTranscript: async () => "",
  onPartial: () => {},
  onTranscript: () => {},
  onSpeechStart: () => {},
  close: () => {},
  isConnected: () => true,
});
const createStubSttProvider = () => ({
  createSession: () => createStubSession(),
});
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const waitForAbort = (signal) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
describe("MediaStreamHandler TTS queue", () => {
  it("serializes TTS playback and resolves in order", async () => {
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
    });
    const started = [];
    const finished = [];
    let resolveFirst;
    const firstGate = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const first = handler.queueTts("stream-1", async () => {
      started.push(1);
      await firstGate;
      finished.push(1);
    });
    const second = handler.queueTts("stream-1", async () => {
      started.push(2);
      finished.push(2);
    });
    await flush();
    expect(started).toEqual([1]);
    resolveFirst();
    await first;
    await second;
    expect(started).toEqual([1, 2]);
    expect(finished).toEqual([1, 2]);
  });
  it("cancels active playback and clears queued items", async () => {
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
    });
    let queuedRan = false;
    const started = [];
    const active = handler.queueTts("stream-1", async (signal) => {
      started.push("active");
      await waitForAbort(signal);
    });
    handler.queueTts("stream-1", async () => {
      queuedRan = true;
    });
    await flush();
    expect(started).toEqual(["active"]);
    handler.clearTtsQueue("stream-1");
    await active;
    await flush();
    expect(queuedRan).toBe(false);
  });
});
