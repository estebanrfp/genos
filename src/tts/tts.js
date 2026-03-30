let resolveModelOverridePolicy = function (overrides) {
    const enabled = overrides?.enabled ?? true;
    if (!enabled) {
      return {
        enabled: false,
        allowText: false,
        allowProvider: false,
        allowVoice: false,
        allowModelId: false,
        allowVoiceSettings: false,
        allowNormalization: false,
        allowSeed: false,
      };
    }
    const allow = (value) => value ?? true;
    return {
      enabled: true,
      allowText: allow(overrides?.allowText),
      allowProvider: allow(overrides?.allowProvider),
      allowVoice: allow(overrides?.allowVoice),
      allowModelId: allow(overrides?.allowModelId),
      allowVoiceSettings: allow(overrides?.allowVoiceSettings),
      allowNormalization: allow(overrides?.allowNormalization),
      allowSeed: allow(overrides?.allowSeed),
    };
  },
  resolveTtsAutoModeFromPrefs = function (prefs) {
    const auto = normalizeTtsAutoMode(prefs.tts?.auto);
    if (auto) {
      return auto;
    }
    if (typeof prefs.tts?.enabled === "boolean") {
      return prefs.tts.enabled ? "always" : "off";
    }
    return;
  },
  readPrefs = function (prefsPath) {
    try {
      if (!existsSync(prefsPath)) {
        return {};
      }
      return JSON.parse(secureReadFileSync(prefsPath));
    } catch {
      return {};
    }
  },
  updatePrefs = function (prefsPath, update) {
    const prefs = readPrefs(prefsPath);
    update(prefs);
    mkdirSync(path.dirname(prefsPath), { recursive: true, mode: 0o700 });
    secureWriteFileSync(prefsPath, JSON.stringify(prefs, null, 2));
  },
  resolveOutputFormat = function (channelId) {
    if (channelId === "telegram") {
      return TELEGRAM_OUTPUT;
    }
    return DEFAULT_OUTPUT;
  },
  resolveChannelId = function (channel) {
    return channel ? normalizeChannelId(channel) : null;
  },
  resolveEdgeOutputFormat = function (config) {
    return config.edge.outputFormat;
  },
  formatTtsProviderError = function (provider, err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.name === "AbortError") {
      return `${provider}: request timed out`;
    }
    return `${provider}: ${error.message}`;
  };
import { copyFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeChannelId } from "../channels/plugins/index.js";
import { logVerbose } from "../globals.js";
import { secureReadFileSync, secureWriteFileSync } from "../infra/secure-io.js";
import { stripMarkdown } from "../line/markdown-to-line.js";
import { isVoiceCompatibleAudio } from "../media/audio.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import {
  edgeTTS,
  elevenLabsTTS,
  inferEdgeExtension,
  isValidOpenAIModel,
  isValidOpenAIVoice,
  isValidVoiceId,
  KOKORO_DEFAULT_BASE_URL,
  KOKORO_DEFAULT_MODEL,
  KOKORO_DEFAULT_VOICE,
  KOKORO_VOICES,
  kokoroTTS,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  openaiTTS,
  parseTtsDirectives,
  scheduleCleanup,
  summarizeText,
} from "./tts-core.js";
export { OPENAI_TTS_MODELS, OPENAI_TTS_VOICES, KOKORO_VOICES } from "./tts-core.js";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_TTS_MAX_LENGTH = 1500;
const DEFAULT_TTS_SUMMARIZE = true;
const DEFAULT_MAX_TEXT_LENGTH = 4096;
const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_ELEVENLABS_VOICE_ID = "pMsXgVXv3BLzUgSXRplE";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
const DEFAULT_OPENAI_VOICE = "alloy";
const DEFAULT_EDGE_VOICE = "en-US-MichelleNeural";
const DEFAULT_EDGE_LANG = "en-US";
const DEFAULT_EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_ELEVENLABS_VOICE_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
  speed: 1,
};
const TELEGRAM_OUTPUT = {
  openai: "opus",
  elevenlabs: "opus_48000_64",
  kokoro: "opus",
  extension: ".opus",
  voiceCompatible: true,
};
const DEFAULT_OUTPUT = {
  openai: "mp3",
  elevenlabs: "mp3_44100_128",
  kokoro: "mp3",
  extension: ".mp3",
  voiceCompatible: false,
};
const TELEPHONY_OUTPUT = {
  openai: { format: "pcm", sampleRate: 24000 },
  elevenlabs: { format: "pcm_22050", sampleRate: 22050 },
  kokoro: { format: "pcm", sampleRate: 24000 },
};
const TTS_AUTO_MODES = new Set(["off", "always", "inbound", "tagged"]);
const MEDIA_DIR = path.join(CONFIG_DIR, "media");
/**
 * Copy audio file to persistent media directory (~/.genosv1/media/).
 * @param {string} audioPath - Source audio file path
 * @returns {string} Persistent media file path
 */
const persistAudioToMedia = (audioPath) => {
  try {
    mkdirSync(MEDIA_DIR, { recursive: true });
    const dest = path.join(MEDIA_DIR, path.basename(audioPath));
    copyFileSync(audioPath, dest);
    return dest;
  } catch {
    return audioPath;
  }
};
let lastTtsAttempt;
export function normalizeTtsAutoMode(value) {
  if (typeof value !== "string") {
    return;
  }
  const normalized = value.trim().toLowerCase();
  if (TTS_AUTO_MODES.has(normalized)) {
    return normalized;
  }
  return;
}
export function resolveTtsConfig(cfg) {
  const raw = cfg.messages?.tts ?? {};
  const providerSource = raw.provider ? "config" : "default";
  const edgeOutputFormat = raw.edge?.outputFormat?.trim();
  const auto = normalizeTtsAutoMode(raw.auto) ?? (raw.enabled ? "always" : "off");
  return {
    auto,
    mode: raw.mode ?? "final",
    provider: raw.provider ?? "edge",
    providerSource,
    summaryModel: raw.summaryModel?.trim() || undefined,
    modelOverrides: resolveModelOverridePolicy(raw.modelOverrides),
    elevenlabs: {
      apiKey: raw.elevenlabs?.apiKey,
      baseUrl: raw.elevenlabs?.baseUrl?.trim() || DEFAULT_ELEVENLABS_BASE_URL,
      voiceId: raw.elevenlabs?.voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID,
      modelId: raw.elevenlabs?.modelId ?? DEFAULT_ELEVENLABS_MODEL_ID,
      seed: raw.elevenlabs?.seed,
      applyTextNormalization: raw.elevenlabs?.applyTextNormalization,
      languageCode: raw.elevenlabs?.languageCode,
      voiceSettings: {
        stability:
          raw.elevenlabs?.voiceSettings?.stability ?? DEFAULT_ELEVENLABS_VOICE_SETTINGS.stability,
        similarityBoost:
          raw.elevenlabs?.voiceSettings?.similarityBoost ??
          DEFAULT_ELEVENLABS_VOICE_SETTINGS.similarityBoost,
        style: raw.elevenlabs?.voiceSettings?.style ?? DEFAULT_ELEVENLABS_VOICE_SETTINGS.style,
        useSpeakerBoost:
          raw.elevenlabs?.voiceSettings?.useSpeakerBoost ??
          DEFAULT_ELEVENLABS_VOICE_SETTINGS.useSpeakerBoost,
        speed: raw.elevenlabs?.voiceSettings?.speed ?? DEFAULT_ELEVENLABS_VOICE_SETTINGS.speed,
      },
    },
    openai: {
      apiKey: raw.openai?.apiKey,
      model: raw.openai?.model ?? DEFAULT_OPENAI_MODEL,
      voice: raw.openai?.voice ?? DEFAULT_OPENAI_VOICE,
    },
    kokoro: {
      enabled: raw.kokoro?.enabled ?? false,
      baseUrl: raw.kokoro?.baseUrl?.trim() || KOKORO_DEFAULT_BASE_URL,
      model: raw.kokoro?.model?.trim() || KOKORO_DEFAULT_MODEL,
      voice: raw.kokoro?.voice?.trim() || KOKORO_DEFAULT_VOICE,
      speed: raw.kokoro?.speed,
      language: raw.kokoro?.language?.trim() || undefined,
    },
    edge: {
      enabled: raw.edge?.enabled ?? true,
      voice: raw.edge?.voice?.trim() || DEFAULT_EDGE_VOICE,
      lang: raw.edge?.lang?.trim() || DEFAULT_EDGE_LANG,
      outputFormat: edgeOutputFormat || DEFAULT_EDGE_OUTPUT_FORMAT,
      outputFormatConfigured: Boolean(edgeOutputFormat),
      pitch: raw.edge?.pitch?.trim() || undefined,
      rate: raw.edge?.rate?.trim() || undefined,
      volume: raw.edge?.volume?.trim() || undefined,
      saveSubtitles: raw.edge?.saveSubtitles ?? false,
      proxy: raw.edge?.proxy?.trim() || undefined,
      timeoutMs: raw.edge?.timeoutMs,
    },
    prefsPath: raw.prefsPath,
    maxTextLength: raw.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
    timeoutMs: raw.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}
export function resolveTtsPrefsPath(config) {
  if (config.prefsPath?.trim()) {
    return resolveUserPath(config.prefsPath.trim());
  }
  const envPath = process.env.GENOS_TTS_PREFS?.trim();
  if (envPath) {
    return resolveUserPath(envPath);
  }
  return path.join(CONFIG_DIR, "settings", "tts.json");
}
export function resolveTtsAutoMode(params) {
  const sessionAuto = normalizeTtsAutoMode(params.sessionAuto);
  if (sessionAuto) {
    return sessionAuto;
  }
  const prefsAuto = resolveTtsAutoModeFromPrefs(readPrefs(params.prefsPath));
  if (prefsAuto) {
    return prefsAuto;
  }
  return params.config.auto;
}
export function buildTtsSystemPromptHint(cfg) {
  const config = resolveTtsConfig(cfg);
  const prefsPath = resolveTtsPrefsPath(config);
  const autoMode = resolveTtsAutoMode({ config, prefsPath });
  if (autoMode === "off") {
    return;
  }
  const maxLength = getTtsMaxLength(prefsPath);
  const summarize = isSummarizationEnabled(prefsPath) ? "on" : "off";
  const autoHint =
    autoMode === "inbound"
      ? "Only use TTS when the user's last message includes audio/voice."
      : autoMode === "tagged"
        ? "Only use TTS when you include [[tts]] or [[tts:text]] tags."
        : undefined;
  return [
    "Voice (TTS) is enabled.",
    autoHint,
    `Keep spoken text \u2264${maxLength} chars to avoid auto-summary (summary ${summarize}).`,
    "Use [[tts:...]] and optional [[tts:text]]...[[/tts:text]] to control voice/expressiveness.",
  ]
    .filter(Boolean)
    .join("\n");
}
export function isTtsEnabled(config, prefsPath, sessionAuto) {
  return resolveTtsAutoMode({ config, prefsPath, sessionAuto }) !== "off";
}
export function setTtsAutoMode(prefsPath, mode) {
  updatePrefs(prefsPath, (prefs) => {
    const next = { ...prefs.tts };
    delete next.enabled;
    next.auto = mode;
    prefs.tts = next;
  });
}
export function setTtsEnabled(prefsPath, enabled) {
  setTtsAutoMode(prefsPath, enabled ? "always" : "off");
}
export function getTtsProvider(config, prefsPath) {
  const prefs = readPrefs(prefsPath);
  if (prefs.tts?.provider) {
    return prefs.tts.provider;
  }
  if (config.providerSource === "config") {
    return config.provider;
  }
  if (config.kokoro.enabled) {
    return "kokoro";
  }
  if (resolveTtsApiKey(config, "openai")) {
    return "openai";
  }
  if (resolveTtsApiKey(config, "elevenlabs")) {
    return "elevenlabs";
  }
  return "edge";
}
export function setTtsProvider(prefsPath, provider) {
  updatePrefs(prefsPath, (prefs) => {
    prefs.tts = { ...prefs.tts, provider };
  });
}
export function getTtsMaxLength(prefsPath) {
  const prefs = readPrefs(prefsPath);
  return prefs.tts?.maxLength ?? DEFAULT_TTS_MAX_LENGTH;
}
export function setTtsMaxLength(prefsPath, maxLength) {
  updatePrefs(prefsPath, (prefs) => {
    prefs.tts = { ...prefs.tts, maxLength };
  });
}
export function isSummarizationEnabled(prefsPath) {
  const prefs = readPrefs(prefsPath);
  return prefs.tts?.summarize ?? DEFAULT_TTS_SUMMARIZE;
}
export function setSummarizationEnabled(prefsPath, enabled) {
  updatePrefs(prefsPath, (prefs) => {
    prefs.tts = { ...prefs.tts, summarize: enabled };
  });
}
export function getLastTtsAttempt() {
  return lastTtsAttempt;
}
export function setLastTtsAttempt(entry) {
  lastTtsAttempt = entry;
}
export function resolveTtsApiKey(config, provider) {
  if (provider === "elevenlabs") {
    return config.elevenlabs.apiKey || process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  }
  if (provider === "openai") {
    return config.openai.apiKey || process.env.OPENAI_API_KEY;
  }
  return;
}
export const TTS_PROVIDERS = ["kokoro", "openai", "elevenlabs", "edge"];
export function resolveTtsProviderOrder(primary) {
  return [primary, ...TTS_PROVIDERS.filter((provider) => provider !== primary)];
}
export function isTtsProviderConfigured(config, provider) {
  if (provider === "kokoro") {
    return config.kokoro.enabled;
  }
  if (provider === "edge") {
    return config.edge.enabled;
  }
  return Boolean(resolveTtsApiKey(config, provider));
}
export async function textToSpeech(params) {
  const config = resolveTtsConfig(params.cfg);
  const prefsPath = params.prefsPath ?? resolveTtsPrefsPath(config);
  const channelId = resolveChannelId(params.channel);
  const output = resolveOutputFormat(channelId);
  if (params.text.length > config.maxTextLength) {
    return {
      success: false,
      error: `Text too long (${params.text.length} chars, max ${config.maxTextLength})`,
    };
  }
  const userProvider = getTtsProvider(config, prefsPath);
  const overrideProvider = params.overrides?.provider;
  const provider = overrideProvider ?? userProvider;
  const providers = resolveTtsProviderOrder(provider);
  const errors = [];
  for (const provider of providers) {
    const providerStart = Date.now();
    try {
      if (provider === "edge") {
        if (!config.edge.enabled) {
          errors.push("edge: disabled");
          continue;
        }
        const tempDir = mkdtempSync(path.join(tmpdir(), "tts-"));
        let edgeOutputFormat = resolveEdgeOutputFormat(config);
        const fallbackEdgeOutputFormat =
          edgeOutputFormat !== DEFAULT_EDGE_OUTPUT_FORMAT ? DEFAULT_EDGE_OUTPUT_FORMAT : undefined;
        const attemptEdgeTts = async (outputFormat) => {
          const extension = inferEdgeExtension(outputFormat);
          const audioPath = path.join(tempDir, `voice-${Date.now()}${extension}`);
          await edgeTTS({
            text: params.text,
            outputPath: audioPath,
            config: {
              ...config.edge,
              outputFormat,
            },
            timeoutMs: config.timeoutMs,
          });
          return { audioPath, outputFormat };
        };
        let edgeResult;
        try {
          edgeResult = await attemptEdgeTts(edgeOutputFormat);
        } catch (err) {
          if (fallbackEdgeOutputFormat && fallbackEdgeOutputFormat !== edgeOutputFormat) {
            logVerbose(
              `TTS: Edge output ${edgeOutputFormat} failed; retrying with ${fallbackEdgeOutputFormat}.`,
            );
            edgeOutputFormat = fallbackEdgeOutputFormat;
            try {
              edgeResult = await attemptEdgeTts(edgeOutputFormat);
            } catch (fallbackErr) {
              try {
                rmSync(tempDir, { recursive: true, force: true });
              } catch {}
              throw fallbackErr;
            }
          } else {
            try {
              rmSync(tempDir, { recursive: true, force: true });
            } catch {}
            throw err;
          }
        }
        persistAudioToMedia(edgeResult.audioPath);
        scheduleCleanup(tempDir);
        const voiceCompatible = isVoiceCompatibleAudio({ fileName: edgeResult.audioPath });
        return {
          success: true,
          audioPath: edgeResult.audioPath,
          latencyMs: Date.now() - providerStart,
          provider,
          outputFormat: edgeResult.outputFormat,
          voiceCompatible,
        };
      }
      if (provider === "kokoro") {
        if (!config.kokoro.enabled) {
          errors.push("kokoro: disabled");
          continue;
        }
        const voiceOverride = params.overrides?.kokoro?.voice;
        const audioBuffer = await kokoroTTS({
          text: params.text,
          baseUrl: config.kokoro.baseUrl,
          model: config.kokoro.model,
          voice: voiceOverride ?? config.kokoro.voice,
          responseFormat: output.kokoro ?? output.openai,
          speed: config.kokoro.speed,
          language: config.kokoro.language,
          timeoutMs: config.timeoutMs,
        });
        const latencyMs = Date.now() - providerStart;
        const tempDir = mkdtempSync(path.join(tmpdir(), "tts-"));
        const audioPath = path.join(tempDir, `voice-${Date.now()}${output.extension}`);
        writeFileSync(audioPath, audioBuffer);
        persistAudioToMedia(audioPath);
        scheduleCleanup(tempDir);
        return {
          success: true,
          audioPath,
          latencyMs,
          provider,
          outputFormat: output.kokoro ?? output.openai,
          voiceCompatible: output.voiceCompatible,
        };
      }
      const apiKey = resolveTtsApiKey(config, provider);
      if (!apiKey) {
        errors.push(`${provider}: no API key`);
        continue;
      }
      let audioBuffer;
      if (provider === "elevenlabs") {
        const voiceIdOverride = params.overrides?.elevenlabs?.voiceId;
        const modelIdOverride = params.overrides?.elevenlabs?.modelId;
        const voiceSettings = {
          ...config.elevenlabs.voiceSettings,
          ...params.overrides?.elevenlabs?.voiceSettings,
        };
        const seedOverride = params.overrides?.elevenlabs?.seed;
        const normalizationOverride = params.overrides?.elevenlabs?.applyTextNormalization;
        const languageOverride = params.overrides?.elevenlabs?.languageCode;
        audioBuffer = await elevenLabsTTS({
          text: params.text,
          apiKey,
          baseUrl: config.elevenlabs.baseUrl,
          voiceId: voiceIdOverride ?? config.elevenlabs.voiceId,
          modelId: modelIdOverride ?? config.elevenlabs.modelId,
          outputFormat: output.elevenlabs,
          seed: seedOverride ?? config.elevenlabs.seed,
          applyTextNormalization: normalizationOverride ?? config.elevenlabs.applyTextNormalization,
          languageCode: languageOverride ?? config.elevenlabs.languageCode,
          voiceSettings,
          timeoutMs: config.timeoutMs,
        });
      } else {
        const openaiModelOverride = params.overrides?.openai?.model;
        const openaiVoiceOverride = params.overrides?.openai?.voice;
        audioBuffer = await openaiTTS({
          text: params.text,
          apiKey,
          model: openaiModelOverride ?? config.openai.model,
          voice: openaiVoiceOverride ?? config.openai.voice,
          responseFormat: output.openai,
          timeoutMs: config.timeoutMs,
        });
      }
      const latencyMs = Date.now() - providerStart;
      const tempDir = mkdtempSync(path.join(tmpdir(), "tts-"));
      const audioPath = path.join(tempDir, `voice-${Date.now()}${output.extension}`);
      writeFileSync(audioPath, audioBuffer);
      persistAudioToMedia(audioPath);
      scheduleCleanup(tempDir);
      return {
        success: true,
        audioPath,
        latencyMs,
        provider,
        outputFormat: provider === "openai" ? output.openai : output.elevenlabs,
        voiceCompatible: output.voiceCompatible,
      };
    } catch (err) {
      errors.push(formatTtsProviderError(provider, err));
    }
  }
  return {
    success: false,
    error: `TTS conversion failed: ${errors.join("; ") || "no providers available"}`,
  };
}
export async function textToSpeechTelephony(params) {
  const config = resolveTtsConfig(params.cfg);
  const prefsPath = params.prefsPath ?? resolveTtsPrefsPath(config);
  if (params.text.length > config.maxTextLength) {
    return {
      success: false,
      error: `Text too long (${params.text.length} chars, max ${config.maxTextLength})`,
    };
  }
  const userProvider = getTtsProvider(config, prefsPath);
  const providers = resolveTtsProviderOrder(userProvider);
  const errors = [];
  for (const provider of providers) {
    const providerStart = Date.now();
    try {
      if (provider === "edge") {
        errors.push("edge: unsupported for telephony");
        continue;
      }
      if (provider === "kokoro") {
        if (!config.kokoro.enabled) {
          errors.push("kokoro: disabled");
          continue;
        }
        const output = TELEPHONY_OUTPUT.kokoro;
        const audioBuffer = await kokoroTTS({
          text: params.text,
          baseUrl: config.kokoro.baseUrl,
          model: config.kokoro.model,
          voice: config.kokoro.voice,
          responseFormat: output.format,
          speed: config.kokoro.speed,
          language: config.kokoro.language,
          timeoutMs: config.timeoutMs,
        });
        return {
          success: true,
          audioBuffer,
          latencyMs: Date.now() - providerStart,
          provider,
          outputFormat: output.format,
          sampleRate: output.sampleRate,
        };
      }
      const apiKey = resolveTtsApiKey(config, provider);
      if (!apiKey) {
        errors.push(`${provider}: no API key`);
        continue;
      }
      if (provider === "elevenlabs") {
        const output = TELEPHONY_OUTPUT.elevenlabs;
        const audioBuffer = await elevenLabsTTS({
          text: params.text,
          apiKey,
          baseUrl: config.elevenlabs.baseUrl,
          voiceId: config.elevenlabs.voiceId,
          modelId: config.elevenlabs.modelId,
          outputFormat: output.format,
          seed: config.elevenlabs.seed,
          applyTextNormalization: config.elevenlabs.applyTextNormalization,
          languageCode: config.elevenlabs.languageCode,
          voiceSettings: config.elevenlabs.voiceSettings,
          timeoutMs: config.timeoutMs,
        });
        return {
          success: true,
          audioBuffer,
          latencyMs: Date.now() - providerStart,
          provider,
          outputFormat: output.format,
          sampleRate: output.sampleRate,
        };
      }
      const output = TELEPHONY_OUTPUT.openai;
      const audioBuffer = await openaiTTS({
        text: params.text,
        apiKey,
        model: config.openai.model,
        voice: config.openai.voice,
        responseFormat: output.format,
        timeoutMs: config.timeoutMs,
      });
      return {
        success: true,
        audioBuffer,
        latencyMs: Date.now() - providerStart,
        provider,
        outputFormat: output.format,
        sampleRate: output.sampleRate,
      };
    } catch (err) {
      errors.push(formatTtsProviderError(provider, err));
    }
  }
  return {
    success: false,
    error: `TTS conversion failed: ${errors.join("; ") || "no providers available"}`,
  };
}
export async function maybeApplyTtsToPayload(params) {
  const config = resolveTtsConfig(params.cfg);
  const prefsPath = resolveTtsPrefsPath(config);
  const autoMode = resolveTtsAutoMode({
    config,
    prefsPath,
    sessionAuto: params.ttsAuto,
  });
  if (autoMode === "off") {
    return params.payload;
  }
  const text = params.payload.text ?? "";
  const directives = parseTtsDirectives(text, config.modelOverrides);
  if (directives.warnings.length > 0) {
    logVerbose(`TTS: ignored directive overrides (${directives.warnings.join("; ")})`);
  }
  const cleanedText = directives.cleanedText;
  const trimmedCleaned = cleanedText.trim();
  const visibleText = trimmedCleaned.length > 0 ? trimmedCleaned : "";
  const ttsText = directives.ttsText?.trim() || visibleText;
  const nextPayload =
    visibleText === text.trim()
      ? params.payload
      : {
          ...params.payload,
          text: visibleText.length > 0 ? visibleText : undefined,
        };
  if (autoMode === "tagged" && !directives.hasDirective) {
    return nextPayload;
  }
  if (autoMode === "inbound" && params.inboundAudio !== true) {
    return nextPayload;
  }
  const mode = config.mode ?? "final";
  if (mode === "final" && params.kind && params.kind !== "final") {
    return nextPayload;
  }
  if (!ttsText.trim()) {
    return nextPayload;
  }
  if (params.payload.mediaUrl || (params.payload.mediaUrls?.length ?? 0) > 0) {
    return nextPayload;
  }
  if (text.includes("MEDIA:")) {
    return nextPayload;
  }
  if (ttsText.trim().length < 10) {
    return nextPayload;
  }
  const maxLength = getTtsMaxLength(prefsPath);
  let textForAudio = ttsText.trim();
  let wasSummarized = false;
  if (textForAudio.length > maxLength) {
    if (!isSummarizationEnabled(prefsPath)) {
      logVerbose(
        `TTS: truncating long text (${textForAudio.length} > ${maxLength}), summarization disabled.`,
      );
      textForAudio = `${textForAudio.slice(0, maxLength - 3)}...`;
    } else {
      try {
        const summary = await summarizeText({
          text: textForAudio,
          targetLength: maxLength,
          cfg: params.cfg,
          config,
          timeoutMs: config.timeoutMs,
        });
        textForAudio = summary.summary;
        wasSummarized = true;
        if (textForAudio.length > config.maxTextLength) {
          logVerbose(
            `TTS: summary exceeded hard limit (${textForAudio.length} > ${config.maxTextLength}); truncating.`,
          );
          textForAudio = `${textForAudio.slice(0, config.maxTextLength - 3)}...`;
        }
      } catch (err) {
        const error = err;
        logVerbose(`TTS: summarization failed, truncating instead: ${error.message}`);
        textForAudio = `${textForAudio.slice(0, maxLength - 3)}...`;
      }
    }
  }
  textForAudio = stripMarkdown(textForAudio).trim();
  if (textForAudio.length < 10) {
    return nextPayload;
  }
  const ttsStart = Date.now();
  const result = await textToSpeech({
    text: textForAudio,
    cfg: params.cfg,
    prefsPath,
    channel: params.channel,
    overrides: directives.overrides,
  });
  if (result.success && result.audioPath) {
    lastTtsAttempt = {
      timestamp: Date.now(),
      success: true,
      textLength: text.length,
      summarized: wasSummarized,
      provider: result.provider,
      latencyMs: result.latencyMs,
    };
    const channelId = resolveChannelId(params.channel);
    const shouldVoice = channelId === "telegram" && result.voiceCompatible === true;
    const finalPayload = {
      ...nextPayload,
      mediaUrl: result.audioPath,
      audioAsVoice: shouldVoice || params.payload.audioAsVoice,
    };
    return finalPayload;
  }
  lastTtsAttempt = {
    timestamp: Date.now(),
    success: false,
    textLength: text.length,
    summarized: wasSummarized,
    error: result.error,
  };
  const latency = Date.now() - ttsStart;
  logVerbose(`TTS: conversion failed after ${latency}ms (${result.error ?? "unknown"}).`);
  return nextPayload;
}
export const _test = {
  isValidVoiceId,
  isValidOpenAIVoice,
  isValidOpenAIModel,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  parseTtsDirectives,
  resolveModelOverridePolicy,
  summarizeText,
  resolveOutputFormat,
  resolveEdgeOutputFormat,
};
