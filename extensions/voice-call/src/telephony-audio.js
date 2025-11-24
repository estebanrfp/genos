let clamp16 = function (value) {
    return Math.max(-32768, Math.min(32767, value));
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
    for (let expMask = 16384; (sample & expMask) === 0 && exponent > 0; exponent--) {
      expMask >>= 1;
    }
    const mantissa = (sample >> (exponent + 3)) & 15;
    return ~(sign | (exponent << 4) | mantissa) & 255;
  };
const TELEPHONY_SAMPLE_RATE = 8000;
export function resamplePcmTo8k(input, inputSampleRate) {
  if (inputSampleRate === TELEPHONY_SAMPLE_RATE) {
    return input;
  }
  const inputSamples = Math.floor(input.length / 2);
  if (inputSamples === 0) {
    return Buffer.alloc(0);
  }
  const ratio = inputSampleRate / TELEPHONY_SAMPLE_RATE;
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = Buffer.alloc(outputSamples * 2);
  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;
    const s0 = input.readInt16LE(srcIndex * 2);
    const s1Index = Math.min(srcIndex + 1, inputSamples - 1);
    const s1 = input.readInt16LE(s1Index * 2);
    const sample = Math.round(s0 + frac * (s1 - s0));
    output.writeInt16LE(clamp16(sample), i * 2);
  }
  return output;
}
export function pcmToMulaw(pcm) {
  const samples = Math.floor(pcm.length / 2);
  const mulaw = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    const sample = pcm.readInt16LE(i * 2);
    mulaw[i] = linearToMulaw(sample);
  }
  return mulaw;
}
export function convertPcmToMulaw8k(pcm, inputSampleRate) {
  const pcm8k = resamplePcmTo8k(pcm, inputSampleRate);
  return pcmToMulaw(pcm8k);
}
export function chunkAudio(audio, chunkSize = 160) {
  return (function* () {
    for (let i = 0; i < audio.length; i += chunkSize) {
      yield audio.subarray(i, Math.min(i + chunkSize, audio.length));
    }
  })();
}
