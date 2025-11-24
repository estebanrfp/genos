import {
  TtsAutoSchema,
  TtsConfigSchema,
  TtsModeSchema,
  TtsProviderSchema,
} from "genosos/plugin-sdk";
import { z } from "zod";
export const E164Schema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Expected E.164 format, e.g. +15550001234");
export const InboundPolicySchema = z.enum(["disabled", "allowlist", "pairing", "open"]);
export const TelnyxConfigSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    publicKey: z.string().min(1).optional(),
  })
  .strict();
export const TwilioConfigSchema = z
  .object({
    accountSid: z.string().min(1).optional(),
    authToken: z.string().min(1).optional(),
  })
  .strict();
export const PlivoConfigSchema = z
  .object({
    authId: z.string().min(1).optional(),
    authToken: z.string().min(1).optional(),
  })
  .strict();
export const SttConfigSchema = z
  .object({
    provider: z.literal("openai").default("openai"),
    model: z.string().min(1).default("whisper-1"),
  })
  .strict()
  .default({ provider: "openai", model: "whisper-1" });

export { TtsAutoSchema, TtsConfigSchema, TtsModeSchema, TtsProviderSchema };
export const VoiceCallServeConfigSchema = z
  .object({
    port: z.number().int().positive().default(3334),
    bind: z.string().default("127.0.0.1"),
    path: z.string().min(1).default("/voice/webhook"),
  })
  .strict()
  .default({ port: 3334, bind: "127.0.0.1", path: "/voice/webhook" });
export const VoiceCallTailscaleConfigSchema = z
  .object({
    mode: z.enum(["off", "serve", "funnel"]).default("off"),
    path: z.string().min(1).default("/voice/webhook"),
  })
  .strict()
  .default({ mode: "off", path: "/voice/webhook" });
export const VoiceCallTunnelConfigSchema = z
  .object({
    provider: z
      .enum(["none", "ngrok", "cloudflare", "tailscale-serve", "tailscale-funnel"])
      .default("none"),
    ngrokAuthToken: z.string().min(1).optional(),
    ngrokDomain: z.string().min(1).optional(),
    allowNgrokFreeTierLoopbackBypass: z.boolean().default(false),
    cloudflareToken: z.string().min(1).optional(),
    cloudflareHostname: z.string().min(1).optional(),
  })
  .strict()
  .default({ provider: "none", allowNgrokFreeTierLoopbackBypass: false });
export const VoiceCallWebhookSecurityConfigSchema = z
  .object({
    allowedHosts: z.array(z.string().min(1)).default([]),
    trustForwardingHeaders: z.boolean().default(false),
    trustedProxyIPs: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({ allowedHosts: [], trustForwardingHeaders: false, trustedProxyIPs: [] });
export const CallModeSchema = z.enum(["notify", "conversation"]);
export const OutboundConfigSchema = z
  .object({
    defaultMode: CallModeSchema.default("notify"),
    notifyHangupDelaySec: z.number().int().nonnegative().default(3),
  })
  .strict()
  .default({ defaultMode: "notify", notifyHangupDelaySec: 3 });
export const VoiceCallStreamingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["stt-only", "realtime-conversation"]).default("realtime-conversation"),
    sttProvider: z.enum(["openai-realtime"]).default("openai-realtime"),
    openaiApiKey: z.string().min(1).optional(),
    sttModel: z.string().min(1).default("gpt-4o-transcribe"),
    realtimeModel: z.string().min(1).default("gpt-4o-realtime-preview"),
    realtimeVoice: z.string().min(1).default("sage"),
    realtimeInstructions: z.string().optional(),
    silenceDurationMs: z.number().int().positive().default(600),
    vadThreshold: z.number().min(0).max(1).default(0.5),
    streamPath: z.string().min(1).default("/voice/stream"),
  })
  .strict()
  .default({
    enabled: false,
    mode: "realtime-conversation",
    sttProvider: "openai-realtime",
    sttModel: "gpt-4o-transcribe",
    realtimeModel: "gpt-4o-realtime-preview",
    realtimeVoice: "sage",
    silenceDurationMs: 600,
    vadThreshold: 0.5,
    streamPath: "/voice/stream",
  });
export const VoiceCallConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    provider: z.enum(["telnyx", "twilio", "plivo", "mock"]).optional(),
    telnyx: TelnyxConfigSchema.optional(),
    twilio: TwilioConfigSchema.optional(),
    plivo: PlivoConfigSchema.optional(),
    fromNumber: E164Schema.optional(),
    toNumber: E164Schema.optional(),
    inboundPolicy: InboundPolicySchema.default("disabled"),
    allowFrom: z.array(E164Schema).default([]),
    inboundGreeting: z.string().optional(),
    outbound: OutboundConfigSchema,
    maxDurationSeconds: z.number().int().positive().default(300),
    staleCallReaperSeconds: z.number().int().nonnegative().default(0),
    silenceTimeoutMs: z.number().int().positive().default(800),
    transcriptTimeoutMs: z.number().int().positive().default(180000),
    ringTimeoutMs: z.number().int().positive().default(30000),
    maxConcurrentCalls: z.number().int().positive().default(5),
    serve: VoiceCallServeConfigSchema,
    tailscale: VoiceCallTailscaleConfigSchema,
    tunnel: VoiceCallTunnelConfigSchema,
    webhookSecurity: VoiceCallWebhookSecurityConfigSchema,
    streaming: VoiceCallStreamingConfigSchema,
    publicUrl: z.string().url().optional(),
    skipSignatureVerification: z.boolean().default(false),
    stt: SttConfigSchema,
    tts: TtsConfigSchema,
    store: z.string().optional(),
    responseModel: z.string().default("openai/gpt-4o-mini"),
    responseSystemPrompt: z.string().optional(),
    responseTimeoutMs: z.number().int().positive().default(30000),
  })
  .strict();
export function resolveVoiceCallConfig(config) {
  const resolved = JSON.parse(JSON.stringify(config));
  if (resolved.provider === "telnyx") {
    resolved.telnyx = resolved.telnyx ?? {};
    resolved.telnyx.apiKey = resolved.telnyx.apiKey ?? process.env.TELNYX_API_KEY;
    resolved.telnyx.connectionId = resolved.telnyx.connectionId ?? process.env.TELNYX_CONNECTION_ID;
    resolved.telnyx.publicKey = resolved.telnyx.publicKey ?? process.env.TELNYX_PUBLIC_KEY;
  }
  if (resolved.provider === "twilio") {
    resolved.twilio = resolved.twilio ?? {};
    resolved.twilio.accountSid = resolved.twilio.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
    resolved.twilio.authToken = resolved.twilio.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  }
  if (resolved.provider === "plivo") {
    resolved.plivo = resolved.plivo ?? {};
    resolved.plivo.authId = resolved.plivo.authId ?? process.env.PLIVO_AUTH_ID;
    resolved.plivo.authToken = resolved.plivo.authToken ?? process.env.PLIVO_AUTH_TOKEN;
  }
  resolved.tunnel = resolved.tunnel ?? {
    provider: "none",
    allowNgrokFreeTierLoopbackBypass: false,
  };
  resolved.tunnel.allowNgrokFreeTierLoopbackBypass =
    resolved.tunnel.allowNgrokFreeTierLoopbackBypass ?? false;
  resolved.tunnel.ngrokAuthToken = resolved.tunnel.ngrokAuthToken ?? process.env.NGROK_AUTHTOKEN;
  resolved.tunnel.ngrokDomain = resolved.tunnel.ngrokDomain ?? process.env.NGROK_DOMAIN;
  resolved.tunnel.cloudflareToken =
    resolved.tunnel.cloudflareToken ?? process.env.CLOUDFLARE_TUNNEL_TOKEN;
  resolved.tunnel.cloudflareHostname =
    resolved.tunnel.cloudflareHostname ?? process.env.CLOUDFLARE_TUNNEL_HOSTNAME;
  resolved.webhookSecurity = resolved.webhookSecurity ?? {
    allowedHosts: [],
    trustForwardingHeaders: false,
    trustedProxyIPs: [],
  };
  resolved.webhookSecurity.allowedHosts = resolved.webhookSecurity.allowedHosts ?? [];
  resolved.webhookSecurity.trustForwardingHeaders =
    resolved.webhookSecurity.trustForwardingHeaders ?? false;
  resolved.webhookSecurity.trustedProxyIPs = resolved.webhookSecurity.trustedProxyIPs ?? [];
  return resolved;
}
export function validateProviderConfig(config) {
  const errors = [];
  if (!config.enabled) {
    return { valid: true, errors: [] };
  }
  if (!config.provider) {
    errors.push("plugins.entries.voice-call.config.provider is required");
  }
  if (!config.fromNumber && config.provider !== "mock") {
    errors.push("plugins.entries.voice-call.config.fromNumber is required");
  }
  if (config.provider === "telnyx") {
    if (!config.telnyx?.apiKey) {
      errors.push(
        "plugins.entries.voice-call.config.telnyx.apiKey is required (or set TELNYX_API_KEY env)",
      );
    }
    if (!config.telnyx?.connectionId) {
      errors.push(
        "plugins.entries.voice-call.config.telnyx.connectionId is required (or set TELNYX_CONNECTION_ID env)",
      );
    }
    if (!config.skipSignatureVerification && !config.telnyx?.publicKey) {
      errors.push(
        "plugins.entries.voice-call.config.telnyx.publicKey is required (or set TELNYX_PUBLIC_KEY env)",
      );
    }
  }
  if (config.provider === "twilio") {
    if (!config.twilio?.accountSid) {
      errors.push(
        "plugins.entries.voice-call.config.twilio.accountSid is required (or set TWILIO_ACCOUNT_SID env)",
      );
    }
    if (!config.twilio?.authToken) {
      errors.push(
        "plugins.entries.voice-call.config.twilio.authToken is required (or set TWILIO_AUTH_TOKEN env)",
      );
    }
  }
  if (config.provider === "plivo") {
    if (!config.plivo?.authId) {
      errors.push(
        "plugins.entries.voice-call.config.plivo.authId is required (or set PLIVO_AUTH_ID env)",
      );
    }
    if (!config.plivo?.authToken) {
      errors.push(
        "plugins.entries.voice-call.config.plivo.authToken is required (or set PLIVO_AUTH_TOKEN env)",
      );
    }
  }
  return { valid: errors.length === 0, errors };
}
