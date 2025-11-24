import crypto from "node:crypto";
import { chunkAudio } from "../telephony-audio.js";
import { escapeXml, mapVoiceToPolly } from "../voice-mapping.js";
import { twilioApiRequest } from "./twilio/api.js";
import { verifyTwilioProviderWebhook } from "./twilio/webhook.js";

export class TwilioProvider {
  name = "twilio";
  accountSid;
  authToken;
  baseUrl;
  callWebhookUrls = new Map();
  options;
  currentPublicUrl = null;
  ttsProvider = null;
  mediaStreamHandler = null;
  callStreamMap = new Map();
  streamAuthTokens = new Map();
  twimlStorage = new Map();
  notifyCalls = new Set();
  deleteStoredTwiml(callId) {
    this.twimlStorage.delete(callId);
    this.notifyCalls.delete(callId);
  }
  deleteStoredTwimlForProviderCall(providerCallId) {
    const webhookUrl = this.callWebhookUrls.get(providerCallId);
    if (!webhookUrl) {
      return;
    }
    const callIdMatch = webhookUrl.match(/callId=([^&]+)/);
    if (!callIdMatch) {
      return;
    }
    this.deleteStoredTwiml(callIdMatch[1]);
    this.streamAuthTokens.delete(providerCallId);
  }
  constructor(config, options = {}) {
    if (!config.accountSid) {
      throw new Error("Twilio Account SID is required");
    }
    if (!config.authToken) {
      throw new Error("Twilio Auth Token is required");
    }
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    this.defaultLocale = config.locale ?? "es-ES";
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`;
    this.options = options;
    if (options.publicUrl) {
      this.currentPublicUrl = options.publicUrl;
    }
  }
  setPublicUrl(url) {
    this.currentPublicUrl = url;
  }
  getPublicUrl() {
    return this.currentPublicUrl;
  }
  setTTSProvider(provider) {
    this.ttsProvider = provider;
  }
  setMediaStreamHandler(handler) {
    this.mediaStreamHandler = handler;
  }
  registerCallStream(callSid, streamSid) {
    this.callStreamMap.set(callSid, streamSid);
  }
  unregisterCallStream(callSid) {
    this.callStreamMap.delete(callSid);
  }
  isValidStreamToken(callSid, token) {
    const expected = this.streamAuthTokens.get(callSid);
    if (!expected || !token) {
      return false;
    }
    if (expected.length !== token.length) {
      const dummy = Buffer.from(expected);
      crypto.timingSafeEqual(dummy, dummy);
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }
  clearTtsQueue(callSid) {
    const streamSid = this.callStreamMap.get(callSid);
    if (streamSid && this.mediaStreamHandler) {
      this.mediaStreamHandler.clearTtsQueue(streamSid);
    }
  }
  async apiRequest(endpoint, params, options) {
    return await twilioApiRequest({
      baseUrl: this.baseUrl,
      accountSid: this.accountSid,
      authToken: this.authToken,
      endpoint,
      body: params,
      allowNotFound: options?.allowNotFound,
    });
  }
  verifyWebhook(ctx) {
    return verifyTwilioProviderWebhook({
      ctx,
      authToken: this.authToken,
      currentPublicUrl: this.currentPublicUrl,
      options: this.options,
    });
  }
  parseWebhookEvent(ctx) {
    try {
      const params = new URLSearchParams(ctx.rawBody);
      const callIdFromQuery =
        typeof ctx.query?.callId === "string" && ctx.query.callId.trim()
          ? ctx.query.callId.trim()
          : undefined;
      const event = this.normalizeEvent(params, callIdFromQuery);
      const twiml = this.generateTwimlResponse(ctx);
      return {
        events: event ? [event] : [],
        providerResponseBody: twiml,
        providerResponseHeaders: { "Content-Type": "application/xml" },
        statusCode: 200,
      };
    } catch {
      return { events: [], statusCode: 400 };
    }
  }
  static parseDirection(direction) {
    if (direction === "inbound") {
      return "inbound";
    }
    if (direction === "outbound-api" || direction === "outbound-dial") {
      return "outbound";
    }
    return;
  }
  normalizeEvent(params, callIdOverride) {
    const callSid = params.get("CallSid") || "";
    const baseEvent = {
      id: crypto.randomUUID(),
      callId: callIdOverride || callSid,
      providerCallId: callSid,
      timestamp: Date.now(),
      direction: TwilioProvider.parseDirection(params.get("Direction")),
      from: params.get("From") || undefined,
      to: params.get("To") || undefined,
    };
    const speechResult = params.get("SpeechResult");
    if (speechResult) {
      return {
        ...baseEvent,
        type: "call.speech",
        transcript: speechResult,
        isFinal: true,
        confidence: parseFloat(params.get("Confidence") || "0.9"),
      };
    }
    const digits = params.get("Digits");
    if (digits) {
      return { ...baseEvent, type: "call.dtmf", digits };
    }
    const callStatus = params.get("CallStatus");
    switch (callStatus) {
      case "initiated":
        return { ...baseEvent, type: "call.initiated" };
      case "ringing":
        return { ...baseEvent, type: "call.ringing" };
      case "in-progress":
        return { ...baseEvent, type: "call.answered" };
      case "completed":
      case "busy":
      case "no-answer":
      case "failed":
        this.streamAuthTokens.delete(callSid);
        if (callIdOverride) {
          this.deleteStoredTwiml(callIdOverride);
        }
        return { ...baseEvent, type: "call.ended", reason: callStatus };
      case "canceled":
        this.streamAuthTokens.delete(callSid);
        if (callIdOverride) {
          this.deleteStoredTwiml(callIdOverride);
        }
        return { ...baseEvent, type: "call.ended", reason: "hangup-bot" };
      default:
        return null;
    }
  }
  static EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  static PAUSE_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="30"/>
</Response>`;
  generateTwimlResponse(ctx) {
    if (!ctx) {
      return TwilioProvider.EMPTY_TWIML;
    }
    const params = new URLSearchParams(ctx.rawBody);
    const type = typeof ctx.query?.type === "string" ? ctx.query.type.trim() : undefined;
    const isStatusCallback = type === "status";
    const callStatus = params.get("CallStatus");
    const direction = params.get("Direction");
    const isOutbound = direction?.startsWith("outbound") ?? false;
    const callSid = params.get("CallSid") || undefined;
    const callIdFromQuery =
      typeof ctx.query?.callId === "string" && ctx.query.callId.trim()
        ? ctx.query.callId.trim()
        : undefined;
    if (callIdFromQuery && !isStatusCallback) {
      const storedTwiml = this.twimlStorage.get(callIdFromQuery);
      if (storedTwiml) {
        this.deleteStoredTwiml(callIdFromQuery);
        return storedTwiml;
      }
      if (this.notifyCalls.has(callIdFromQuery)) {
        return TwilioProvider.EMPTY_TWIML;
      }
      if (isOutbound) {
        const streamUrl = callSid ? this.getStreamUrlForCall(callSid) : null;
        return streamUrl ? this.getStreamConnectXml(streamUrl) : TwilioProvider.PAUSE_TWIML;
      }
    }
    if (isStatusCallback) {
      return TwilioProvider.EMPTY_TWIML;
    }
    if (direction === "inbound") {
      const streamUrl = callSid ? this.getStreamUrlForCall(callSid) : null;
      return streamUrl ? this.getStreamConnectXml(streamUrl) : TwilioProvider.PAUSE_TWIML;
    }
    if (callStatus !== "in-progress") {
      return TwilioProvider.EMPTY_TWIML;
    }
    const streamUrl = callSid ? this.getStreamUrlForCall(callSid) : null;
    return streamUrl ? this.getStreamConnectXml(streamUrl) : TwilioProvider.PAUSE_TWIML;
  }
  getStreamUrl() {
    if (!this.currentPublicUrl || !this.options.streamPath) {
      return null;
    }
    const url = new URL(this.currentPublicUrl);
    const origin = url.origin;
    const wsOrigin = origin.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
    const path = this.options.streamPath.startsWith("/")
      ? this.options.streamPath
      : `/${this.options.streamPath}`;
    return `${wsOrigin}${path}`;
  }
  getStreamAuthToken(callSid) {
    const existing = this.streamAuthTokens.get(callSid);
    if (existing) {
      return existing;
    }
    const token = crypto.randomBytes(16).toString("base64url");
    this.streamAuthTokens.set(callSid, token);
    return token;
  }
  getStreamUrlForCall(callSid) {
    const baseUrl = this.getStreamUrl();
    if (!baseUrl) {
      return null;
    }
    const token = this.getStreamAuthToken(callSid);
    const url = new URL(baseUrl);
    url.searchParams.set("token", token);
    return url.toString();
  }
  getStreamConnectXml(streamUrl) {
    const parsed = new URL(streamUrl);
    const token = parsed.searchParams.get("token");
    parsed.searchParams.delete("token");
    const cleanUrl = parsed.toString();
    const paramXml = token ? `\n      <Parameter name="token" value="${escapeXml(token)}" />` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(cleanUrl)}">${paramXml}
    </Stream>
  </Connect>
</Response>`;
  }
  async initiateCall(input) {
    const url = new URL(input.webhookUrl);
    url.searchParams.set("callId", input.callId);
    const statusUrl = new URL(input.webhookUrl);
    statusUrl.searchParams.set("callId", input.callId);
    statusUrl.searchParams.set("type", "status");
    if (input.inlineTwiml) {
      this.twimlStorage.set(input.callId, input.inlineTwiml);
      this.notifyCalls.add(input.callId);
    }
    const params = {
      To: input.to,
      From: input.from,
      Url: url.toString(),
      StatusCallback: statusUrl.toString(),
      StatusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      Timeout: "30",
    };
    const result = await this.apiRequest("/Calls.json", params);
    this.callWebhookUrls.set(result.sid, url.toString());
    return {
      providerCallId: result.sid,
      status: result.status === "queued" ? "queued" : "initiated",
    };
  }
  async hangupCall(input) {
    this.deleteStoredTwimlForProviderCall(input.providerCallId);
    this.callWebhookUrls.delete(input.providerCallId);
    this.streamAuthTokens.delete(input.providerCallId);
    await this.apiRequest(
      `/Calls/${input.providerCallId}.json`,
      { Status: "completed" },
      { allowNotFound: true },
    );
  }
  async playTts(input) {
    const streamSid = this.callStreamMap.get(input.providerCallId);
    if (this.ttsProvider && this.mediaStreamHandler && streamSid) {
      try {
        await this.playTtsViaStream(input.text, streamSid);
        return;
      } catch (err) {
        console.warn(
          `[voice-call] Telephony TTS failed, falling back to Twilio <Say>:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    const webhookUrl = this.callWebhookUrls.get(input.providerCallId);
    if (!webhookUrl) {
      throw new Error("Missing webhook URL for this call (provider state not initialized)");
    }
    console.warn(
      "[voice-call] Using TwiML <Say> fallback - telephony TTS not configured or media stream not active",
    );
    const pollyVoice = mapVoiceToPolly(input.voice);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${pollyVoice}" language="${input.locale || this.defaultLocale}">${escapeXml(input.text)}</Say>
  <Gather input="speech" speechTimeout="auto" action="${escapeXml(webhookUrl)}" method="POST">
    <Say>.</Say>
  </Gather>
</Response>`;
    await this.apiRequest(`/Calls/${input.providerCallId}.json`, {
      Twiml: twiml,
    });
  }
  async playTtsViaStream(text, streamSid) {
    if (!this.ttsProvider || !this.mediaStreamHandler) {
      throw new Error("TTS provider and media stream handler required");
    }
    const CHUNK_SIZE = 160;
    const CHUNK_DELAY_MS = 20;
    const handler = this.mediaStreamHandler;
    const ttsProvider = this.ttsProvider;
    await handler.queueTts(streamSid, async (signal) => {
      const muLawAudio = await ttsProvider.synthesizeForTelephony(text);
      for (const chunk of chunkAudio(muLawAudio, CHUNK_SIZE)) {
        if (signal.aborted) {
          break;
        }
        handler.sendAudio(streamSid, chunk);
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        if (signal.aborted) {
          break;
        }
      }
      if (!signal.aborted) {
        handler.sendMark(streamSid, `tts-${Date.now()}`);
      }
    });
  }
  async startListening(input) {
    const webhookUrl = this.callWebhookUrls.get(input.providerCallId);
    if (!webhookUrl) {
      throw new Error("Missing webhook URL for this call (provider state not initialized)");
    }
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" language="${input.language || "en-US"}" action="${escapeXml(webhookUrl)}" method="POST">
  </Gather>
</Response>`;
    await this.apiRequest(`/Calls/${input.providerCallId}.json`, {
      Twiml: twiml,
    });
  }
  async stopListening(_input) {}
}
