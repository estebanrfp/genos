let applyTtsOverride = function (coreConfig, override) {
    if (!override) {
      return coreConfig;
    }
    const base = coreConfig.messages?.tts;
    const merged = mergeTtsConfig(base, override);
    if (!merged) {
      return coreConfig;
    }
    return {
      ...coreConfig,
      messages: {
        ...coreConfig.messages,
        tts: merged,
      },
    };
  },
  mergeTtsConfig = function (base, override) {
    if (!base && !override) {
      return;
    }
    if (!override) {
      return base;
    }
    if (!base) {
      return override;
    }
    return deepMerge(base, override);
  },
  deepMerge = function (base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return override;
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) {
        continue;
      }
      const existing = base[key];
      if (isPlainObject(existing) && isPlainObject(value)) {
        result[key] = deepMerge(existing, value);
      } else {
        result[key] = value;
      }
    }
    return result;
  },
  isPlainObject = function (value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  };
import { convertPcmToMulaw8k } from "./telephony-audio.js";
export function createTelephonyTtsProvider(params) {
  const { coreConfig, ttsOverride, runtime } = params;
  const mergedConfig = applyTtsOverride(coreConfig, ttsOverride);
  return {
    synthesizeForTelephony: async (text) => {
      const result = await runtime.textToSpeechTelephony({
        text,
        cfg: mergedConfig,
      });
      if (!result.success || !result.audioBuffer || !result.sampleRate) {
        throw new Error(result.error ?? "TTS conversion failed");
      }
      return convertPcmToMulaw8k(result.audioBuffer, result.sampleRate);
    },
  };
}
