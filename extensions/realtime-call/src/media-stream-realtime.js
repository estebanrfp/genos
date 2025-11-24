/**
 * Bidirectional media stream handler for OpenAI Realtime Conversation.
 * Bridges Twilio Media Streams WebSocket ↔ OpenAI Realtime API.
 *
 * Flow: Twilio audio (mulaw/8kHz) → OpenAI Realtime → AI audio (mulaw/8kHz) → Twilio
 * No intermediate STT, LLM, or TTS steps.
 */
import { WebSocketServer } from "ws";
import { OpenAIRealtimeConversationProvider } from "./providers/openai-realtime-conversation.js";

const LOG = "[RealtimeMediaStream]";

export class RealtimeMediaStreamHandler {
  wss = null;
  sessions = new Map();
  config;

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
            console.log(`${LOG} Twilio connected`);
            break;
          case "start":
            session = await this.handleStart(ws, message, streamToken);
            break;
          case "media":
            if (session?.realtimeSession && message.media?.payload) {
              session.realtimeSession.sendAudio(message.media.payload);
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
        console.error(`${LOG} Error processing message:`, error);
      }
    });

    ws.on("close", () => {
      if (session) this.handleStop(session);
    });

    ws.on("error", (error) => {
      console.error(`${LOG} WebSocket error:`, error);
    });
  }

  async handleStart(ws, message, streamToken) {
    const streamSid = message.streamSid || "";
    const callSid = message.start?.callSid || "";
    const effectiveToken = message.start?.customParameters?.token ?? streamToken;
    console.log(`${LOG} Stream started: ${streamSid} (call: ${callSid})`);

    if (!callSid) {
      console.warn(`${LOG} Missing callSid; closing stream`);
      ws.close(1008, "Missing callSid");
      return null;
    }

    if (
      this.config.shouldAcceptStream &&
      !this.config.shouldAcceptStream({ callId: callSid, streamSid, token: effectiveToken })
    ) {
      console.warn(`${LOG} Rejecting stream for unknown call: ${callSid}`);
      ws.close(1008, "Unknown call");
      return null;
    }

    const callInstructions = this.config.getCallInstructions?.(callSid);
    const effectiveInstructions = callInstructions
      ? `${this.config.realtimeInstructions}\n\n## Current call context\n${callInstructions}`
      : this.config.realtimeInstructions;
    const provider = new OpenAIRealtimeConversationProvider({
      apiKey: this.config.openaiApiKey,
      model: this.config.realtimeModel ?? "gpt-4o-realtime-preview",
      voice: this.config.realtimeVoice ?? "sage",
      instructions: effectiveInstructions,
      vadThreshold: this.config.vadThreshold ?? 0.5,
      silenceDurationMs: this.config.silenceDurationMs ?? 600,
    });

    const realtimeSession = provider.createSession({
      onAudioDelta: (base64Audio) => {
        this.sendAudioToTwilio(ws, streamSid, base64Audio);
      },
      onTranscriptDelta: (text) => {
        this.config.onTranscriptDelta?.(callSid, text);
      },
      onTranscriptDone: (text) => {
        this.config.onResponseTranscript?.(callSid, text);
      },
      onInputTranscript: (text) => {
        this.config.onUserTranscript?.(callSid, text);
      },
      onSpeechStart: () => {
        this.clearAudio(ws, streamSid);
        this.config.onSpeechStart?.(callSid);
      },
      onResponseStart: () => {
        this.config.onResponseStart?.(callSid);
      },
      onResponseDone: () => {
        this.config.onResponseDone?.(callSid);
      },
      onInterrupted: () => {
        this.clearAudio(ws, streamSid);
        console.log(`${LOG} User interrupted AI response`);
      },
    });

    try {
      await realtimeSession.connect();
      console.log(`${LOG} OpenAI Realtime conversation active for call ${callSid}`);
    } catch (err) {
      console.error(`${LOG} Failed to connect OpenAI Realtime:`, err);
      ws.close(1011, "Realtime connection failed");
      return null;
    }

    const session = { callId: callSid, streamSid, ws, realtimeSession };
    this.sessions.set(streamSid, session);
    this.config.onConnect?.(callSid, streamSid);

    // Trigger initial greeting — use call context if available
    const greetingPrompt = callInstructions ?? this.config.initialGreeting;
    if (greetingPrompt) {
      realtimeSession.triggerResponse(greetingPrompt);
    }

    return session;
  }

  handleStop(session) {
    console.log(`${LOG} Stream stopped: ${session.streamSid}`);
    session.realtimeSession.close();
    this.sessions.delete(session.streamSid);
    this.config.onDisconnect?.(session.callId);
  }

  /** Send audio from OpenAI back to Twilio. */
  sendAudioToTwilio(ws, streamSid, base64Audio) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: base64Audio },
      }),
    );
  }

  /** Clear pending audio in Twilio (for interruptions). */
  clearAudio(ws, streamSid) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ event: "clear", streamSid }));
  }

  getStreamToken(request) {
    if (!request.url || !request.headers.host) return;
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      return url.searchParams.get("token") ?? undefined;
    } catch {
      return;
    }
  }

  getSessionByCallId(callId) {
    return [...this.sessions.values()].find((s) => s.callId === callId);
  }

  closeAll() {
    for (const session of this.sessions.values()) {
      session.realtimeSession.close();
      session.ws.close();
    }
    this.sessions.clear();
  }
}
