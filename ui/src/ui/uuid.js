let uuidFromBytes = function (bytes) {
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
  weakRandomBytes = function () {
    const bytes = new Uint8Array(16);
    const now = Date.now();
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[0] ^= now & 255;
    bytes[1] ^= (now >>> 8) & 255;
    bytes[2] ^= (now >>> 16) & 255;
    bytes[3] ^= (now >>> 24) & 255;
    return bytes;
  },
  warnWeakCryptoOnce = function () {
    if (warnedWeakCrypto) {
      return;
    }
    warnedWeakCrypto = true;
    console.warn("[uuid] crypto API missing; falling back to weak randomness");
  };
let warnedWeakCrypto = false;
export function generateUUID(cryptoLike = globalThis.crypto) {
  if (cryptoLike && typeof cryptoLike.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }
  if (cryptoLike && typeof cryptoLike.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoLike.getRandomValues(bytes);
    return uuidFromBytes(bytes);
  }
  warnWeakCryptoOnce();
  return uuidFromBytes(weakRandomBytes());
}
