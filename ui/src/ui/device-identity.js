let base64UrlEncode = function (bytes) {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  },
  base64UrlDecode = function (input) {
    const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  },
  bytesToHex = function (bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
const STORAGE_KEY = "genosos-device-identity-v1";
async function fingerprintPublicKey(publicKey) {
  const hash = await crypto.subtle.digest("SHA-256", publicKey.slice().buffer);
  return bytesToHex(new Uint8Array(hash));
}
async function generateIdentity() {
  const privateKey = utils.randomSecretKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);
  return {
    deviceId,
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
  };
}
export async function loadOrCreateDeviceIdentity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKey === "string" &&
        typeof parsed.privateKey === "string"
      ) {
        const derivedId = await fingerprintPublicKey(base64UrlDecode(parsed.publicKey));
        if (derivedId !== parsed.deviceId) {
          const updated = {
            ...parsed,
            deviceId: derivedId,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return {
            deviceId: derivedId,
            publicKey: parsed.publicKey,
            privateKey: parsed.privateKey,
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
        };
      }
    }
  } catch {}
  const identity = await generateIdentity();
  const stored = {
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    createdAtMs: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return identity;
}
export async function signDevicePayload(privateKeyBase64Url, payload) {
  const key = base64UrlDecode(privateKeyBase64Url);
  const data = new TextEncoder().encode(payload);
  const sig = await signAsync(data, key);
  return base64UrlEncode(sig);
}
