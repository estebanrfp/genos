/**
 * OpenAI Realtime API — full bidirectional conversation provider.
 * Audio in → OpenAI thinks + speaks → audio out. No intermediate STT/LLM/TTS.
 * Uses gpt-4o-realtime-preview with server VAD for natural turn-taking.
 */
import WebSocket from "ws";

const LOG = "[RealtimeConversation]";
const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 1000;

export class OpenAIRealtimeConversationProvider {
  name = "openai-realtime-conversation";
  apiKey;
  model;
  voice;
  instructions;
  vadThreshold;
  silenceDurationMs;

  constructor(config) {
    if (!config.apiKey) {
      throw new Error("OpenAI API key required for Realtime Conversation");
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-realtime-preview";
    this.voice = config.voice ?? "sage";
    this.instructions =
      config.instructions ??
      "You are Nyx, a helpful voice assistant. Respond in Spanish. Keep responses brief and conversational (1-3 sentences). Be natural, warm, and friendly.";
    this.vadThreshold = config.vadThreshold ?? 0.5;
    this.silenceDurationMs = config.silenceDurationMs ?? 600;
  }

  /**
   * Create a new conversation session.
   * @param {object} opts
   * @param {(base64Audio: string) => void} opts.onAudioDelta - receive audio chunks (base64 pcm16/24kHz → needs conversion to mulaw/8kHz for Twilio)
   * @param {(text: string) => void} opts.onTranscriptDelta - partial response text
   * @param {(text: string) => void} opts.onTranscriptDone - final response text
   * @param {(text: string) => void} opts.onInputTranscript - what the user said (transcribed)
   * @param {() => void} opts.onSpeechStart - user started speaking
   * @param {() => void} opts.onResponseStart - AI started responding
   * @param {() => void} opts.onResponseDone - AI finished responding
   * @param {() => void} opts.onInterrupted - user interrupted AI
   */
  createSession(opts) {
    return new OpenAIRealtimeConversationSession({
      apiKey: this.apiKey,
      model: this.model,
      voice: this.voice,
      instructions: this.instructions,
      vadThreshold: this.vadThreshold,
      silenceDurationMs: this.silenceDurationMs,
      ...opts,
    });
  }
}

class OpenAIRealtimeConversationSession {
  ws = null;
  connected = false;
  closed = false;
  reconnectAttempts = 0;
  config;
  responding = false;

  constructor(config) {
    this.config = config;
  }

  async connect() {
    this.closed = false;
    this.reconnectAttempts = 0;
    return this.doConnect();
  }

  async doConnect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.config.model}`;
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      this.ws.on("open", () => {
        console.log(`${LOG} WebSocket connected (model: ${this.config.model})`);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.configureSession();
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event);
        } catch (e) {
          console.error(`${LOG} Failed to parse event:`, e);
        }
      });

      this.ws.on("error", (error) => {
        console.error(`${LOG} WebSocket error:`, error);
        if (!this.connected) reject(error);
      });

      this.ws.on("close", (code, reason) => {
        console.log(
          `${LOG} WebSocket closed (code: ${code}, reason: ${reason?.toString() || "none"})`,
        );
        this.connected = false;
        if (!this.closed) this.attemptReconnect();
      });

      setTimeout(() => {
        if (!this.connected) reject(new Error("Realtime conversation connection timeout"));
      }, 15000);
    });
  }

  /** Configure the session for bidirectional audio conversation. */
  configureSession() {
    this.sendEvent({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: this.config.instructions,
        voice: this.config.voice,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
        },
        turn_detection: {
          type: "server_vad",
          threshold: this.config.vadThreshold,
          prefix_padding_ms: 300,
          silence_duration_ms: this.config.silenceDurationMs,
        },
      },
    });
  }

  handleEvent(event) {
    switch (event.type) {
      case "session.created":
        console.log(`${LOG} Session created`);
        break;

      case "session.updated":
        console.log(`${LOG} Session configured (voice: ${this.config.voice}, bidirectional audio)`);
        break;

      case "input_audio_buffer.speech_started":
        console.log(`${LOG} User speaking`);
        this.config.onSpeechStart?.();
        if (this.responding) {
          this.responding = false;
          this.config.onInterrupted?.();
        }
        break;

      case "input_audio_buffer.speech_stopped":
        console.log(`${LOG} User stopped speaking`);
        break;

      case "input_audio_buffer.committed":
        break;

      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          console.log(`${LOG} User said: "${event.transcript}"`);
          this.config.onInputTranscript?.(event.transcript);
        }
        break;

      case "response.created":
        this.responding = true;
        this.config.onResponseStart?.();
        break;

      case "response.audio.delta":
        if (event.delta) {
          this.config.onAudioDelta?.(event.delta);
        }
        break;

      case "response.audio_transcript.delta":
        if (event.delta) {
          this.config.onTranscriptDelta?.(event.delta);
        }
        break;

      case "response.audio_transcript.done":
        if (event.transcript) {
          console.log(`${LOG} Nyx said: "${event.transcript}"`);
          this.config.onTranscriptDone?.(event.transcript);
        }
        break;

      case "response.done":
        this.responding = false;
        this.config.onResponseDone?.();
        break;

      case "error":
        console.error(`${LOG} Error:`, event.error);
        break;

      default:
        break;
    }
  }

  /** Send raw mulaw audio from Twilio to OpenAI. */
  sendAudio(muLawData) {
    if (!this.connected) return;
    this.sendEvent({
      type: "input_audio_buffer.append",
      audio: typeof muLawData === "string" ? muLawData : muLawData.toString("base64"),
    });
  }

  /** Manually trigger a response (e.g. for initial greeting). */
  triggerResponse(text) {
    if (!this.connected) return;
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.sendEvent({ type: "response.create" });
  }

  /** Add context to the conversation without triggering a response. */
  addSystemContext(text) {
    if (!this.connected) return;
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text }],
      },
    });
  }

  sendEvent(event) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  async attemptReconnect() {
    if (this.closed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT) {
      console.error(`${LOG} Max reconnect attempts reached`);
      return;
    }
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    console.log(`${LOG} Reconnecting ${this.reconnectAttempts}/${MAX_RECONNECT} in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
    if (this.closed) return;
    try {
      await this.doConnect();
      console.log(`${LOG} Reconnected`);
    } catch (err) {
      console.error(`${LOG} Reconnect failed:`, err);
    }
  }

  close() {
    this.closed = true;
    this.responding = false;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }
}
