let parseTtsCommand = function (normalized) {
    if (normalized === "/tts") {
      return { action: "status", args: "" };
    }
    if (!normalized.startsWith("/tts ")) {
      return null;
    }
    const rest = normalized.slice(5).trim();
    if (!rest) {
      return { action: "status", args: "" };
    }
    const [action, ...tail] = rest.split(/\s+/);
    return { action: action.toLowerCase(), args: tail.join(" ").trim() };
  },
  ttsUsage = function () {
    return {
      text: `\uD83D\uDD0A **TTS (Text-to-Speech) Help**

**Commands:**\n\u2022 /tts on \u2014 Enable automatic TTS for replies
\u2022 /tts off \u2014 Disable TTS
\u2022 /tts status \u2014 Show current settings
\u2022 /tts provider [name] \u2014 View/change provider
\u2022 /tts limit [number] \u2014 View/change text limit
\u2022 /tts summary [on|off] \u2014 View/change auto-summary
\u2022 /tts audio <text> \u2014 Generate audio from text

**Providers:**\n\u2022 kokoro \u2014 Local, fast, no cloud (requires Kokoro-FastAPI)
\u2022 edge \u2014 Free, fast (default)
\u2022 openai \u2014 High quality (requires API key)
\u2022 elevenlabs \u2014 Premium voices (requires API key)

**Text Limit (default: 1500, max: 4096):**\nWhen text exceeds the limit:\n\u2022 Summary ON: AI summarizes, then generates audio
\u2022 Summary OFF: Truncates text, then generates audio

**Examples:**\n/tts provider edge\n/tts limit 2000\n/tts audio Hello, this is a test!`,
    };
  };
import { logVerbose } from "../../globals.js";
import {
  getLastTtsAttempt,
  getTtsMaxLength,
  getTtsProvider,
  isSummarizationEnabled,
  isTtsEnabled,
  isTtsProviderConfigured,
  resolveTtsApiKey,
  resolveTtsConfig,
  resolveTtsPrefsPath,
  setLastTtsAttempt,
  setSummarizationEnabled,
  setTtsEnabled,
  setTtsMaxLength,
  setTtsProvider,
  textToSpeech,
} from "../../tts/tts.js";
export const handleTtsCommands = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const parsed = parseTtsCommand(params.command.commandBodyNormalized);
  if (!parsed) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring TTS command from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const config = resolveTtsConfig(params.cfg);
  const prefsPath = resolveTtsPrefsPath(config);
  const action = parsed.action;
  const args = parsed.args;
  if (action === "help") {
    return { shouldContinue: false, reply: ttsUsage() };
  }
  if (action === "on") {
    setTtsEnabled(prefsPath, true);
    return { shouldContinue: false, reply: { text: "\uD83D\uDD0A TTS enabled." } };
  }
  if (action === "off") {
    setTtsEnabled(prefsPath, false);
    return { shouldContinue: false, reply: { text: "\uD83D\uDD07 TTS disabled." } };
  }
  if (action === "audio") {
    if (!args.trim()) {
      return {
        shouldContinue: false,
        reply: {
          text: `\uD83C\uDFA4 Generate audio from text.

Usage: /tts audio <text>\nExample: /tts audio Hello, this is a test!`,
        },
      };
    }
    const start = Date.now();
    const result = await textToSpeech({
      text: args,
      cfg: params.cfg,
      channel: params.command.channel,
      prefsPath,
    });
    if (result.success && result.audioPath) {
      setLastTtsAttempt({
        timestamp: Date.now(),
        success: true,
        textLength: args.length,
        summarized: false,
        provider: result.provider,
        latencyMs: result.latencyMs,
      });
      const payload = {
        mediaUrl: result.audioPath,
        audioAsVoice: result.voiceCompatible === true,
      };
      return { shouldContinue: false, reply: payload };
    }
    setLastTtsAttempt({
      timestamp: Date.now(),
      success: false,
      textLength: args.length,
      summarized: false,
      error: result.error,
      latencyMs: Date.now() - start,
    });
    return {
      shouldContinue: false,
      reply: { text: `\u274C Error generating audio: ${result.error ?? "unknown error"}` },
    };
  }
  if (action === "provider") {
    const currentProvider = getTtsProvider(config, prefsPath);
    if (!args.trim()) {
      const hasKokoro = isTtsProviderConfigured(config, "kokoro");
      const hasOpenAI = Boolean(resolveTtsApiKey(config, "openai"));
      const hasElevenLabs = Boolean(resolveTtsApiKey(config, "elevenlabs"));
      const hasEdge = isTtsProviderConfigured(config, "edge");
      return {
        shouldContinue: false,
        reply: {
          text: `\uD83C\uDF99\uFE0F TTS provider
Primary: ${currentProvider}\nKokoro enabled: ${hasKokoro ? "\u2705" : "\u274C"}\nOpenAI key: ${hasOpenAI ? "\u2705" : "\u274C"}\nElevenLabs key: ${hasElevenLabs ? "\u2705" : "\u274C"}\nEdge enabled: ${hasEdge ? "\u2705" : "\u274C"}\nUsage: /tts provider kokoro | openai | elevenlabs | edge`,
        },
      };
    }
    const requested = args.trim().toLowerCase();
    if (
      requested !== "kokoro" &&
      requested !== "openai" &&
      requested !== "elevenlabs" &&
      requested !== "edge"
    ) {
      return { shouldContinue: false, reply: ttsUsage() };
    }
    setTtsProvider(prefsPath, requested);
    return {
      shouldContinue: false,
      reply: { text: `\u2705 TTS provider set to ${requested}.` },
    };
  }
  if (action === "limit") {
    if (!args.trim()) {
      const currentLimit = getTtsMaxLength(prefsPath);
      return {
        shouldContinue: false,
        reply: {
          text: `\uD83D\uDCCF TTS limit: ${currentLimit} characters.\n\nText longer than this triggers summary (if enabled).\nRange: 100-4096 chars (Telegram max).\n\nTo change: /tts limit <number>\nExample: /tts limit 2000`,
        },
      };
    }
    const next = Number.parseInt(args.trim(), 10);
    if (!Number.isFinite(next) || next < 100 || next > 4096) {
      return {
        shouldContinue: false,
        reply: { text: "\u274C Limit must be between 100 and 4096 characters." },
      };
    }
    setTtsMaxLength(prefsPath, next);
    return {
      shouldContinue: false,
      reply: { text: `\u2705 TTS limit set to ${next} characters.` },
    };
  }
  if (action === "summary") {
    if (!args.trim()) {
      const enabled = isSummarizationEnabled(prefsPath);
      const maxLen = getTtsMaxLength(prefsPath);
      return {
        shouldContinue: false,
        reply: {
          text: `\uD83D\uDCDD TTS auto-summary: ${enabled ? "on" : "off"}.\n\nWhen text exceeds ${maxLen} chars:\n\u2022 ON: summarizes text, then generates audio
\u2022 OFF: truncates text, then generates audio

To change: /tts summary on | off`,
        },
      };
    }
    const requested = args.trim().toLowerCase();
    if (requested !== "on" && requested !== "off") {
      return { shouldContinue: false, reply: ttsUsage() };
    }
    setSummarizationEnabled(prefsPath, requested === "on");
    return {
      shouldContinue: false,
      reply: {
        text:
          requested === "on"
            ? "\u2705 TTS auto-summary enabled."
            : "\u274C TTS auto-summary disabled.",
      },
    };
  }
  if (action === "status") {
    const enabled = isTtsEnabled(config, prefsPath);
    const provider = getTtsProvider(config, prefsPath);
    const hasKey = isTtsProviderConfigured(config, provider);
    const maxLength = getTtsMaxLength(prefsPath);
    const summarize = isSummarizationEnabled(prefsPath);
    const last = getLastTtsAttempt();
    const lines = [
      "\uD83D\uDCCA TTS status",
      `State: ${enabled ? "\u2705 enabled" : "\u274C disabled"}`,
      `Provider: ${provider} (${hasKey ? "\u2705 configured" : "\u274C not configured"})`,
      `Text limit: ${maxLength} chars`,
      `Auto-summary: ${summarize ? "on" : "off"}`,
    ];
    if (last) {
      const timeAgo = Math.round((Date.now() - last.timestamp) / 1000);
      lines.push("");
      lines.push(`Last attempt (${timeAgo}s ago): ${last.success ? "\u2705" : "\u274C"}`);
      lines.push(`Text: ${last.textLength} chars${last.summarized ? " (summarized)" : ""}`);
      if (last.success) {
        lines.push(`Provider: ${last.provider ?? "unknown"}`);
        lines.push(`Latency: ${last.latencyMs ?? 0}ms`);
      } else if (last.error) {
        lines.push(`Error: ${last.error}`);
      }
    }
    return { shouldContinue: false, reply: { text: lines.join("\n") } };
  }
  return { shouldContinue: false, reply: ttsUsage() };
};
