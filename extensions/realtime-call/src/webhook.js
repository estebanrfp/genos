let runTailscaleCommand = function (args, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const proc = spawn("tailscale", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    proc.stdout.on("data", (data) => {
      stdout += data;
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ code: -1, stdout: "" });
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout });
    });
  });
};
import { spawn } from "node:child_process";
import http from "node:http";
import { URL } from "node:url";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "genosos/plugin-sdk";
import { RealtimeMediaStreamHandler } from "./media-stream-realtime.js";
import { MediaStreamHandler } from "./media-stream.js";
import { OpenAIRealtimeSTTProvider } from "./providers/stt-openai-realtime.js";
const MAX_WEBHOOK_BODY_BYTES = 1048576;

export class VoiceCallWebhookServer {
  server = null;
  config;
  manager;
  provider;
  coreConfig;
  staleCallReaperInterval = null;
  mediaStreamHandler = null;
  constructor(config, manager, provider, coreConfig) {
    this.config = config;
    this.manager = manager;
    this.provider = provider;
    this.coreConfig = coreConfig ?? null;
    if (config.streaming?.enabled) {
      this.initializeMediaStreaming();
    }
  }
  getMediaStreamHandler() {
    return this.mediaStreamHandler;
  }
  initializeMediaStreaming() {
    const apiKey = this.config.streaming?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("[voice-call] Streaming enabled but no OpenAI API key found");
      return;
    }
    const streamMode = this.config.streaming?.mode ?? "realtime-conversation";
    const shouldAcceptStream = ({ callId, token }) => {
      const call = this.manager.getCallByProviderCallId(callId);
      if (!call) return false;
      if (this.provider.name === "twilio") {
        const twilio = this.provider;
        if (!twilio.isValidStreamToken(callId, token)) {
          console.warn(`[voice-call] Rejecting media stream: invalid token for ${callId}`);
          return false;
        }
      }
      return true;
    };
    const onDisconnect = (callId) => {
      console.log(`[voice-call] Media stream disconnected: ${callId}`);
      const disconnectedCall = this.manager.getCallByProviderCallId(callId);
      if (disconnectedCall) {
        console.log(
          `[voice-call] Auto-ending call ${disconnectedCall.callId} on stream disconnect`,
        );
        this.manager.endCall(disconnectedCall.callId).catch((err) => {
          console.warn(`[voice-call] Failed to auto-end call ${disconnectedCall.callId}:`, err);
        });
      }
      if (this.provider.name === "twilio") {
        this.provider.unregisterCallStream(callId);
      }
    };
    const onConnect = (callId, streamSid) => {
      console.log(`[voice-call] Media stream connected: ${callId} -> ${streamSid}`);
      if (this.provider.name === "twilio") {
        this.provider.registerCallStream(callId, streamSid);
      }
    };

    if (streamMode === "realtime-conversation") {
      this.initializeRealtimeConversation(apiKey, shouldAcceptStream, onConnect, onDisconnect);
    } else {
      this.initializeSttOnlyStreaming(apiKey, shouldAcceptStream, onConnect, onDisconnect);
    }
  }
  initializeRealtimeConversation(apiKey, shouldAcceptStream, onConnect, onDisconnect) {
    const greeting = this.config.inboundGreeting ?? "Hola, soy Nyx. ¿En qué puedo ayudarte?";
    const instructions =
      this.config.streaming?.realtimeInstructions ??
      this.config.responseSystemPrompt ??
      "You are Nyx, a helpful voice assistant on a phone call. Respond in Spanish. Keep responses brief and conversational (1-3 sentences). Be natural, warm, and friendly.";
    const getCallInstructions = (providerCallId) => {
      const call = this.manager.getCallByProviderCallId(providerCallId);
      return call?.metadata?.initialMessage ?? null;
    };
    const streamConfig = {
      openaiApiKey: apiKey,
      realtimeModel: this.config.streaming?.realtimeModel ?? "gpt-4o-realtime-preview",
      realtimeVoice: this.config.streaming?.realtimeVoice ?? "sage",
      realtimeInstructions: instructions,
      vadThreshold: this.config.streaming?.vadThreshold ?? 0.5,
      silenceDurationMs: this.config.streaming?.silenceDurationMs ?? 600,
      initialGreeting: greeting,
      getCallInstructions,
      shouldAcceptStream,
      onUserTranscript: (providerCallId, transcript) => {
        console.log(`[voice-call] User said: ${transcript}`);
        const call = this.manager.getCallByProviderCallId(providerCallId);
        if (call) {
          this.manager.processEvent({
            id: `rt-user-${Date.now()}`,
            type: "call.speech",
            callId: call.callId,
            providerCallId,
            timestamp: Date.now(),
            transcript,
            isFinal: true,
          });
        }
      },
      onResponseTranscript: (providerCallId, transcript) => {
        console.log(`[voice-call] Nyx said: ${transcript}`);
        const call = this.manager.getCallByProviderCallId(providerCallId);
        if (call) {
          this.manager.processEvent({
            id: `rt-bot-${Date.now()}`,
            type: "call.speaking",
            callId: call.callId,
            providerCallId,
            timestamp: Date.now(),
            transcript,
          });
        }
      },
      onSpeechStart: (providerCallId) => {
        console.log(`[voice-call] User speaking (call: ${providerCallId})`);
      },
      onResponseStart: (providerCallId) => {
        console.log(`[voice-call] Nyx responding (call: ${providerCallId})`);
      },
      onResponseDone: (providerCallId) => {
        console.log(`[voice-call] Nyx finished (call: ${providerCallId})`);
      },
      onConnect,
      onDisconnect,
    };
    this.mediaStreamHandler = new RealtimeMediaStreamHandler(streamConfig);
    console.log("[voice-call] Realtime bidirectional conversation initialized");
  }
  initializeSttOnlyStreaming(apiKey, shouldAcceptStream, onConnect, onDisconnect) {
    const sttProvider = new OpenAIRealtimeSTTProvider({
      apiKey,
      model: this.config.streaming?.sttModel,
      silenceDurationMs: this.config.streaming?.silenceDurationMs,
      vadThreshold: this.config.streaming?.vadThreshold,
    });
    const streamConfig = {
      sttProvider,
      shouldAcceptStream,
      onTranscript: (providerCallId, transcript) => {
        console.log(`[voice-call] Transcript for ${providerCallId}: ${transcript}`);
        if (this.provider.name === "twilio") {
          this.provider.clearTtsQueue(providerCallId);
        }
        const call = this.manager.getCallByProviderCallId(providerCallId);
        if (!call) {
          console.warn(`[voice-call] No active call found for provider ID: ${providerCallId}`);
          return;
        }
        this.manager.processEvent({
          id: `stream-transcript-${Date.now()}`,
          type: "call.speech",
          callId: call.callId,
          providerCallId,
          timestamp: Date.now(),
          transcript,
          isFinal: true,
        });
        const callMode = call.metadata?.mode;
        const shouldRespond = call.direction === "inbound" || callMode === "conversation";
        if (shouldRespond) {
          this.handleInboundResponse(call.callId, transcript).catch((err) => {
            console.warn(`[voice-call] Failed to auto-respond:`, err);
          });
        }
      },
      onSpeechStart: (providerCallId) => {
        if (this.provider.name === "twilio") {
          this.provider.clearTtsQueue(providerCallId);
        }
      },
      onPartialTranscript: (callId, partial) => {
        console.log(`[voice-call] Partial for ${callId}: ${partial}`);
      },
      onConnect: (callId, streamSid) => {
        onConnect(callId, streamSid);
        setTimeout(() => {
          this.manager.speakInitialMessage(callId).catch((err) => {
            console.warn(`[voice-call] Failed to speak initial message:`, err);
          });
        }, 500);
      },
      onDisconnect,
    };
    this.mediaStreamHandler = new MediaStreamHandler(streamConfig);
    console.log("[voice-call] STT-only streaming initialized");
  }
  async start() {
    const { port, bind, path: webhookPath } = this.config.serve;
    const streamPath = this.config.streaming?.streamPath || "/voice/stream";
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res, webhookPath).catch((err) => {
          console.error("[voice-call] Webhook error:", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        });
      });
      if (this.mediaStreamHandler) {
        this.server.on("upgrade", (request, socket, head) => {
          const url = new URL(request.url || "/", `http://${request.headers.host}`);
          if (url.pathname === streamPath) {
            console.log("[voice-call] WebSocket upgrade for media stream");
            this.mediaStreamHandler?.handleUpgrade(request, socket, head);
          } else {
            socket.destroy();
          }
        });
      }
      this.server.on("error", reject);
      this.server.listen(port, bind, () => {
        const url = `http://${bind}:${port}${webhookPath}`;
        console.log(`[voice-call] Webhook server listening on ${url}`);
        if (this.mediaStreamHandler) {
          console.log(`[voice-call] Media stream WebSocket on ws://${bind}:${port}${streamPath}`);
        }
        resolve(url);
        this.startStaleCallReaper();
      });
    });
  }
  startStaleCallReaper() {
    const maxAgeSeconds = this.config.staleCallReaperSeconds;
    if (!maxAgeSeconds || maxAgeSeconds <= 0) {
      return;
    }
    const CHECK_INTERVAL_MS = 30000;
    const maxAgeMs = maxAgeSeconds * 1000;
    this.staleCallReaperInterval = setInterval(() => {
      const now = Date.now();
      for (const call of this.manager.getActiveCalls()) {
        const age = now - call.startedAt;
        if (age > maxAgeMs) {
          console.log(
            `[voice-call] Reaping stale call ${call.callId} (age: ${Math.round(age / 1000)}s, state: ${call.state})`,
          );
          this.manager.endCall(call.callId).catch((err) => {
            console.warn(`[voice-call] Reaper failed to end call ${call.callId}:`, err);
          });
        }
      }
    }, CHECK_INTERVAL_MS);
  }
  async stop() {
    if (this.staleCallReaperInterval) {
      clearInterval(this.staleCallReaperInterval);
      this.staleCallReaperInterval = null;
    }
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  async handleRequest(req, res, webhookPath) {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (!url.pathname.startsWith(webhookPath)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }
    let body = "";
    try {
      body = await this.readBody(req, MAX_WEBHOOK_BODY_BYTES);
    } catch (err) {
      if (isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE")) {
        res.statusCode = 413;
        res.end("Payload Too Large");
        return;
      }
      if (isRequestBodyLimitError(err, "REQUEST_BODY_TIMEOUT")) {
        res.statusCode = 408;
        res.end(requestBodyErrorToText("REQUEST_BODY_TIMEOUT"));
        return;
      }
      throw err;
    }
    const ctx = {
      headers: req.headers,
      rawBody: body,
      url: `http://${req.headers.host}${req.url}`,
      method: "POST",
      query: Object.fromEntries(url.searchParams),
      remoteAddress: req.socket.remoteAddress ?? undefined,
    };
    const verification = this.provider.verifyWebhook(ctx);
    if (!verification.ok) {
      console.warn(`[voice-call] Webhook verification failed: ${verification.reason}`);
      res.statusCode = 401;
      res.end("Unauthorized");
      return;
    }
    const result = this.provider.parseWebhookEvent(ctx);
    for (const event of result.events) {
      try {
        this.manager.processEvent(event);
      } catch (err) {
        console.error(`[voice-call] Error processing event ${event.type}:`, err);
      }
    }
    res.statusCode = result.statusCode || 200;
    if (result.providerResponseHeaders) {
      for (const [key, value] of Object.entries(result.providerResponseHeaders)) {
        res.setHeader(key, value);
      }
    }
    res.end(result.providerResponseBody || "OK");
  }
  readBody(req, maxBytes, timeoutMs = 30000) {
    return readRequestBodyWithLimit(req, { maxBytes, timeoutMs });
  }
  async handleInboundResponse(callId, userMessage) {
    console.log(`[voice-call] Auto-responding to inbound call ${callId}: "${userMessage}"`);
    const call = this.manager.getCall(callId);
    if (!call) {
      console.warn(`[voice-call] Call ${callId} not found for auto-response`);
      return;
    }
    if (!this.coreConfig) {
      console.warn("[voice-call] Core config missing; skipping auto-response");
      return;
    }
    try {
      const { generateVoiceResponse } = await import("./response-generator.js");
      const result = await generateVoiceResponse({
        voiceConfig: this.config,
        coreConfig: this.coreConfig,
        callId,
        from: call.from,
        transcript: call.transcript,
        userMessage,
      });
      if (result.error) {
        console.error(`[voice-call] Response generation error: ${result.error}`);
        return;
      }
      if (result.text) {
        console.log(`[voice-call] AI response: "${result.text}"`);
        await this.manager.speak(callId, result.text);
      }
    } catch (err) {
      console.error(`[voice-call] Auto-response error:`, err);
    }
  }
}
export async function getTailscaleSelfInfo() {
  const { code, stdout } = await runTailscaleCommand(["status", "--json"]);
  if (code !== 0) {
    return null;
  }
  try {
    const status = JSON.parse(stdout);
    return {
      dnsName: status.Self?.DNSName?.replace(/\.$/, "") || null,
      nodeId: status.Self?.ID || null,
    };
  } catch {
    return null;
  }
}
export async function getTailscaleDnsName() {
  const info = await getTailscaleSelfInfo();
  return info?.dnsName ?? null;
}
export async function setupTailscaleExposureRoute(opts) {
  const dnsName = await getTailscaleDnsName();
  if (!dnsName) {
    console.warn("[voice-call] Could not get Tailscale DNS name");
    return null;
  }
  const { code } = await runTailscaleCommand([
    opts.mode,
    "--bg",
    "--yes",
    "--set-path",
    opts.path,
    opts.localUrl,
  ]);
  if (code === 0) {
    const publicUrl = `https://${dnsName}${opts.path}`;
    console.log(`[voice-call] Tailscale ${opts.mode} active: ${publicUrl}`);
    return publicUrl;
  }
  console.warn(`[voice-call] Tailscale ${opts.mode} failed`);
  return null;
}
export async function cleanupTailscaleExposureRoute(opts) {
  await runTailscaleCommand([opts.mode, "off", opts.path]);
}
export async function setupTailscaleExposure(config) {
  if (config.tailscale.mode === "off") {
    return null;
  }
  const mode = config.tailscale.mode === "funnel" ? "funnel" : "serve";
  const localUrl = `http://127.0.0.1:${config.serve.port}${config.serve.path}`;
  return setupTailscaleExposureRoute({
    mode,
    path: config.tailscale.path,
    localUrl,
  });
}
export async function cleanupTailscaleExposure(config) {
  if (config.tailscale.mode === "off") {
    return;
  }
  const mode = config.tailscale.mode === "funnel" ? "funnel" : "serve";
  await cleanupTailscaleExposureRoute({ mode, path: config.tailscale.path });
}
