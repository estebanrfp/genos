let resample24kTo8k = function (input) {
    const inputSamples = input.length / 2;
    const outputSamples = Math.floor(inputSamples / 3);
    const output = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
      const srcPos = i * 3;
      const srcIdx = srcPos * 2;
      if (srcIdx + 3 < input.length) {
        const s0 = input.readInt16LE(srcIdx);
        const s1 = input.readInt16LE(srcIdx + 2);
        const frac = srcPos % 1 || 0;
        const sample = Math.round(s0 + frac * (s1 - s0));
        output.writeInt16LE(clamp16(sample), i * 2);
      } else {
        output.writeInt16LE(input.readInt16LE(srcIdx), i * 2);
      }
    }
    return output;
  },
  clamp16 = function (value) {
    return Math.max(-32768, Math.min(32767, value));
  },
  pcmToMulaw = function (pcm) {
    const samples = pcm.length / 2;
    const mulaw = Buffer.alloc(samples);
    for (let i = 0; i < samples; i++) {
      const sample = pcm.readInt16LE(i * 2);
      mulaw[i] = linearToMulaw(sample);
    }
    return mulaw;
  },
  linearToMulaw = function (sample) {
    const BIAS = 132;
    const CLIP = 32635;
    const sign = sample < 0 ? 128 : 0;
    if (sample < 0) {
      sample = -sample;
    }
    if (sample > CLIP) {
      sample = CLIP;
    }
    sample += BIAS;
    let exponent = 7;
    for (
      let expMask = 16384;
      (sample & expMask) === 0 && exponent > 0;
      exponent--, expMask >>= 1
    ) {}
    const mantissa = (sample >> (exponent + 3)) & 15;
    return ~(sign | (exponent << 4) | mantissa) & 255;
  };
export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];

export class OpenAITTSProvider {
  apiKey;
  model;
  voice;
  speed;
  instructions;
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.model = config.model || "gpt-4o-mini-tts";
    this.voice = config.voice || "coral";
    this.speed = config.speed || 1;
    this.instructions = config.instructions;
    if (!this.apiKey) {
      throw new Error("OpenAI API key required (set OPENAI_API_KEY or pass apiKey)");
    }
  }
  async synthesize(text, instructions) {
    const body = {
      model: this.model,
      input: text,
      voice: this.voice,
      response_format: "pcm",
      speed: this.speed,
    };
    const effectiveInstructions = instructions || this.instructions;
    if (effectiveInstructions && this.model.includes("gpt-4o-mini-tts")) {
      body.instructions = effectiveInstructions;
    }
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS failed: ${response.status} - ${error}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  async synthesizeForTwilio(text) {
    const pcm24k = await this.synthesize(text);
    const pcm8k = resample24kTo8k(pcm24k);
    return pcmToMulaw(pcm8k);
  }
}
export function mulawToLinear(mulaw) {
  mulaw = ~mulaw & 255;
  const sign = mulaw & 128;
  const exponent = (mulaw >> 4) & 7;
  const mantissa = mulaw & 15;
  let sample = ((mantissa << 3) + 132) << exponent;
  sample -= 132;
  return sign ? -sample : sample;
}
export function chunkAudio(audio, chunkSize = 160) {
  return (function* () {
    for (let i = 0; i < audio.length; i += chunkSize) {
      yield audio.subarray(i, Math.min(i + chunkSize, audio.length));
    }
  })();
}
