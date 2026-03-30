import { WebSocket, WebSocketServer } from "ws";

export class MediaStreamHandler {
  wss = null;
  sessions = new Map();
  config;
  ttsQueues = new Map();
  ttsPlaying = new Map();
  ttsActiveControllers = new Map();
  constructor(config) {
    this.config = config;
  }
  handleUpgrade(request, socket, head) {
    if (!this.wss) {
      this.wss = new WebSocketServer({ noServer: true });
      this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss?.emit("connection", ws, request);
    });
  }
  async handleConnection(ws, _request) {
    let session = null;
    const streamToken = this.getStreamToken(_request);
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        switch (message.event) {
          case "connected":
            console.log("[MediaStream] Twilio connected");
            break;
          case "start":
            session = await this.handleStart(ws, message, streamToken);
            break;
          case "media":
            if (session && message.media?.payload) {
              const audioBuffer = Buffer.from(message.media.payload, "base64");
              session.sttSession.sendAudio(audioBuffer);
            }
            break;
          case "stop":
            if (session) {
              this.handleStop(session);
              session = null;
            }
            break;
        }
      } catch (error) {
        console.error("[MediaStream] Error processing message:", error);
      }
    });
    ws.on("close", () => {
      if (session) {
        this.handleStop(session);
      }
    });
    ws.on("error", (error) => {
      console.error("[MediaStream] WebSocket error:", error);
    });
  }
  async handleStart(ws, message, streamToken) {
    const streamSid = message.streamSid || "";
    const callSid = message.start?.callSid || "";
    const effectiveToken = message.start?.customParameters?.token ?? streamToken;
    console.log(`[MediaStream] Stream started: ${streamSid} (call: ${callSid})`);
    if (!callSid) {
      console.warn("[MediaStream] Missing callSid; closing stream");
      ws.close(1008, "Missing callSid");
      return null;
    }
    if (
      this.config.shouldAcceptStream &&
      !this.config.shouldAcceptStream({ callId: callSid, streamSid, token: effectiveToken })
    ) {
      console.warn(`[MediaStream] Rejecting stream for unknown call: ${callSid}`);
      ws.close(1008, "Unknown call");
      return null;
    }
    const sttSession = this.config.sttProvider.createSession();
    sttSession.onPartial((partial) => {
      this.config.onPartialTranscript?.(callSid, partial);
    });
    sttSession.onTranscript((transcript) => {
      this.config.onTranscript?.(callSid, transcript);
    });
    sttSession.onSpeechStart(() => {
      this.config.onSpeechStart?.(callSid);
    });
    const session = {
      callId: callSid,
      streamSid,
      ws,
      sttSession,
    };
    this.sessions.set(streamSid, session);
    this.config.onConnect?.(callSid, streamSid);
    sttSession.connect().catch((err) => {
      console.warn(`[MediaStream] STT connection failed (TTS still works):`, err.message);
    });
    return session;
  }
  handleStop(session) {
    console.log(`[MediaStream] Stream stopped: ${session.streamSid}`);
    this.clearTtsState(session.streamSid);
    session.sttSession.close();
    this.sessions.delete(session.streamSid);
    this.config.onDisconnect?.(session.callId);
  }
  getStreamToken(request) {
    if (!request.url || !request.headers.host) {
      return;
    }
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      return url.searchParams.get("token") ?? undefined;
    } catch {
      return;
    }
  }
  getOpenSession(streamSid) {
    const session = this.sessions.get(streamSid);
    return session?.ws.readyState === WebSocket.OPEN ? session : undefined;
  }
  sendToStream(streamSid, message) {
    const session = this.getOpenSession(streamSid);
    session?.ws.send(JSON.stringify(message));
  }
  sendAudio(streamSid, muLawAudio) {
    this.sendToStream(streamSid, {
      event: "media",
      streamSid,
      media: { payload: muLawAudio.toString("base64") },
    });
  }
  sendMark(streamSid, name) {
    this.sendToStream(streamSid, {
      event: "mark",
      streamSid,
      mark: { name },
    });
  }
  clearAudio(streamSid) {
    this.sendToStream(streamSid, { event: "clear", streamSid });
  }
  async queueTts(streamSid, playFn) {
    const queue = this.getTtsQueue(streamSid);
    let resolveEntry;
    let rejectEntry;
    const promise = new Promise((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });
    queue.push({
      playFn,
      controller: new AbortController(),
      resolve: resolveEntry,
      reject: rejectEntry,
    });
    if (!this.ttsPlaying.get(streamSid)) {
      this.processQueue(streamSid);
    }
    return promise;
  }
  clearTtsQueue(streamSid) {
    const queue = this.getTtsQueue(streamSid);
    queue.length = 0;
    this.ttsActiveControllers.get(streamSid)?.abort();
    this.clearAudio(streamSid);
  }
  getSessionByCallId(callId) {
    return [...this.sessions.values()].find((session) => session.callId === callId);
  }
  closeAll() {
    for (const session of this.sessions.values()) {
      this.clearTtsState(session.streamSid);
      session.sttSession.close();
      session.ws.close();
    }
    this.sessions.clear();
  }
  getTtsQueue(streamSid) {
    const existing = this.ttsQueues.get(streamSid);
    if (existing) {
      return existing;
    }
    const queue = [];
    this.ttsQueues.set(streamSid, queue);
    return queue;
  }
  async processQueue(streamSid) {
    this.ttsPlaying.set(streamSid, true);
    while (true) {
      const queue = this.ttsQueues.get(streamSid);
      if (!queue || queue.length === 0) {
        this.ttsPlaying.set(streamSid, false);
        this.ttsActiveControllers.delete(streamSid);
        return;
      }
      const entry = queue.shift();
      this.ttsActiveControllers.set(streamSid, entry.controller);
      try {
        await entry.playFn(entry.controller.signal);
        entry.resolve();
      } catch (error) {
        if (entry.controller.signal.aborted) {
          entry.resolve();
        } else {
          console.error("[MediaStream] TTS playback error:", error);
          entry.reject(error);
        }
      } finally {
        if (this.ttsActiveControllers.get(streamSid) === entry.controller) {
          this.ttsActiveControllers.delete(streamSid);
        }
      }
    }
  }
  clearTtsState(streamSid) {
    const queue = this.ttsQueues.get(streamSid);
    if (queue) {
      queue.length = 0;
    }
    this.ttsActiveControllers.get(streamSid)?.abort();
    this.ttsActiveControllers.delete(streamSid);
    this.ttsPlaying.delete(streamSid);
    this.ttsQueues.delete(streamSid);
  }
}
