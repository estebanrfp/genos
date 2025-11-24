import WebSocket from "ws";

export class OpenAIRealtimeSTTProvider {
  name = "openai-realtime";
  apiKey;
  model;
  silenceDurationMs;
  vadThreshold;
  constructor(config) {
    if (!config.apiKey) {
      throw new Error("OpenAI API key required for Realtime STT");
    }
    this.apiKey = config.apiKey;
    this.model = config.model || "gpt-4o-transcribe";
    this.silenceDurationMs = config.silenceDurationMs || 800;
    this.vadThreshold = config.vadThreshold || 0.5;
  }
  createSession() {
    return new OpenAIRealtimeSTTSession(
      this.apiKey,
      this.model,
      this.silenceDurationMs,
      this.vadThreshold,
    );
  }
}

class OpenAIRealtimeSTTSession {
  apiKey;
  model;
  silenceDurationMs;
  vadThreshold;
  static MAX_RECONNECT_ATTEMPTS = 5;
  static RECONNECT_DELAY_MS = 1000;
  ws = null;
  connected = false;
  closed = false;
  reconnectAttempts = 0;
  pendingTranscript = "";
  onTranscriptCallback = null;
  onPartialCallback = null;
  onSpeechStartCallback = null;
  constructor(apiKey, model, silenceDurationMs, vadThreshold) {
    this.apiKey = apiKey;
    this.model = model;
    this.silenceDurationMs = silenceDurationMs;
    this.vadThreshold = vadThreshold;
  }
  async connect() {
    this.closed = false;
    this.reconnectAttempts = 0;
    return this.doConnect();
  }
  async doConnect() {
    return new Promise((resolve, reject) => {
      const url = "wss://api.openai.com/v1/realtime?intent=transcription";
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
      this.ws.on("open", () => {
        console.log("[RealtimeSTT] WebSocket connected");
        this.connected = true;
        this.reconnectAttempts = 0;
        this.sendEvent({
          type: "transcription_session.update",
          session: {
            input_audio_format: "g711_ulaw",
            input_audio_transcription: {
              model: this.model,
            },
            turn_detection: {
              type: "server_vad",
              threshold: this.vadThreshold,
              prefix_padding_ms: 300,
              silence_duration_ms: this.silenceDurationMs,
            },
          },
        });
        resolve();
      });
      this.ws.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event);
        } catch (e) {
          console.error("[RealtimeSTT] Failed to parse event:", e);
        }
      });
      this.ws.on("error", (error) => {
        console.error("[RealtimeSTT] WebSocket error:", error);
        if (!this.connected) {
          reject(error);
        }
      });
      this.ws.on("close", (code, reason) => {
        console.log(
          `[RealtimeSTT] WebSocket closed (code: ${code}, reason: ${reason?.toString() || "none"})`,
        );
        this.connected = false;
        if (!this.closed) {
          this.attemptReconnect();
        }
      });
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("Realtime STT connection timeout"));
        }
      }, 1e4);
    });
  }
  async attemptReconnect() {
    if (this.closed) {
      return;
    }
    if (this.reconnectAttempts >= OpenAIRealtimeSTTSession.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[RealtimeSTT] Max reconnect attempts (${OpenAIRealtimeSTTSession.MAX_RECONNECT_ATTEMPTS}) reached`,
      );
      return;
    }
    this.reconnectAttempts++;
    const delay = OpenAIRealtimeSTTSession.RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    console.log(
      `[RealtimeSTT] Reconnecting ${this.reconnectAttempts}/${OpenAIRealtimeSTTSession.MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.closed) {
      return;
    }
    try {
      await this.doConnect();
      console.log("[RealtimeSTT] Reconnected successfully");
    } catch (error) {
      console.error("[RealtimeSTT] Reconnect failed:", error);
    }
  }
  handleEvent(event) {
    switch (event.type) {
      case "transcription_session.created":
      case "transcription_session.updated":
      case "input_audio_buffer.speech_stopped":
      case "input_audio_buffer.committed":
        console.log(`[RealtimeSTT] ${event.type}`);
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) {
          this.pendingTranscript += event.delta;
          this.onPartialCallback?.(this.pendingTranscript);
        }
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          console.log(`[RealtimeSTT] Transcript: ${event.transcript}`);
          this.onTranscriptCallback?.(event.transcript);
        }
        this.pendingTranscript = "";
        break;
      case "input_audio_buffer.speech_started":
        console.log("[RealtimeSTT] Speech started");
        this.pendingTranscript = "";
        this.onSpeechStartCallback?.();
        break;
      case "error":
        console.error("[RealtimeSTT] Error:", event.error);
        break;
    }
  }
  sendEvent(event) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
  sendAudio(muLawData) {
    if (!this.connected) {
      return;
    }
    this.sendEvent({
      type: "input_audio_buffer.append",
      audio: muLawData.toString("base64"),
    });
  }
  onPartial(callback) {
    this.onPartialCallback = callback;
  }
  onTranscript(callback) {
    this.onTranscriptCallback = callback;
  }
  onSpeechStart(callback) {
    this.onSpeechStartCallback = callback;
  }
  async waitForTranscript(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.onTranscriptCallback = null;
        reject(new Error("Transcript timeout"));
      }, timeoutMs);
      this.onTranscriptCallback = (transcript) => {
        clearTimeout(timeout);
        this.onTranscriptCallback = null;
        resolve(transcript);
      };
    });
  }
  close() {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
  isConnected() {
    return this.connected;
  }
}
